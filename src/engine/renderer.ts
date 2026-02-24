/**
 * Two-Pass Batch Renderer
 *
 * Pass 1: Background — full-screen quad with camera-scrolled UVs.
 * Pass 2: Entities   — batched textured quads from the entity pool,
 *                      positioned via camera offset, UVs unmodified.
 */

import {
  readInt8,
  readInt16,
  ENTITY_SLOT_SIZE,
  ENTITY_ACTIVE,
  ENTITY_TYPE_ID,
  ENTITY_POS_X,
  ENTITY_POS_Y,
  MEMORY_BLOCKS,
} from "./memory.js";
import type { MscSpriteDef } from "../parser/ast.js";

// ── Camera Globals ────────────────────────────────────────────

/**
 * Camera globals layout (in the engine state buffer):
 *   Byte 64–65 (Int16): camera X offset in pixels
 *   Byte 66–67 (Int16): camera Y offset in pixels
 *
 * A zero camera produces the identity view.
 */
export const GLOBALS_CAMERA_X_BYTE = 64;
export const GLOBALS_CAMERA_Y_BYTE = 66;

// ── Sprite Atlas ──────────────────────────────────────────────

export interface BakedSprite {
  /** UV left   (0.0–1.0) */
  u0: number;
  /** UV top    (0.0–1.0) */
  v0: number;
  /** UV right  (0.0–1.0) */
  u1: number;
  /** UV bottom (0.0–1.0) */
  v1: number;
  /** Pixel width */
  w: number;
  /** Pixel height */
  h: number;
  /** Origin X offset in pixels */
  ox: number;
  /** Origin Y offset in pixels */
  oy: number;
}

/**
 * Compile the string-keyed sprites map into a flat array indexed by TypeID.
 *
 * TypeID 1 → first sprite parsed, TypeID 2 → second, etc.
 * Index 0 is left as `null` (no entity should have TypeID 0).
 *
 * Grid sprites with multiple frames are expanded into consecutive entries
 * so the SpriteAnimator can cycle TypeIDs sequentially.
 */
export function compileSpriteAtlas(
  sprites: Map<string, MscSpriteDef>,
  gridSize: number,
  atlasWidth: number,
  atlasHeight: number
): (BakedSprite | null)[] {
  const atlas: (BakedSprite | null)[] = [null]; // index 0 unused

  for (const [, def] of sprites) {
    if (def.kind === "grid") {
      for (let f = 0; f < def.frames; f++) {
        const x = (def.col + f) * gridSize;
        const y = def.row * gridSize;
        atlas.push({
          u0: x / atlasWidth,
          v0: y / atlasHeight,
          u1: (x + gridSize) / atlasWidth,
          v1: (y + gridSize) / atlasHeight,
          w: gridSize,
          h: gridSize,
          ox: 0,
          oy: 0,
        });
      }
    } else {
      atlas.push({
        u0: def.x / atlasWidth,
        v0: def.y / atlasHeight,
        u1: (def.x + def.w) / atlasWidth,
        v1: (def.y + def.h) / atlasHeight,
        w: def.w,
        h: def.h,
        ox: def.ox,
        oy: def.oy,
      });
    }
  }

  return atlas;
}

// ── Shaders ───────────────────────────────────────────────────

// --- Background program: scrolls UVs based on u_camOffset ---
const BG_VERTEX_SRC = `
attribute vec2 a_position;
attribute vec2 a_texCoord;
uniform vec2 u_camOffset;
varying vec2 v_texCoord;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord + u_camOffset;
}
`;

const BG_FRAGMENT_SRC = `
precision mediump float;
uniform sampler2D u_texture;
varying vec2 v_texCoord;
void main() {
  gl_FragColor = texture2D(u_texture, v_texCoord);
}
`;

// --- Entity program: camera affects screen position, not UVs ---
const ENT_VERTEX_SRC = `
attribute vec2 a_position;
attribute vec2 a_texCoord;
uniform vec2 u_resolution;
varying vec2 v_texCoord;
void main() {
  vec2 clip = (a_position / u_resolution) * 2.0 - 1.0;
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);
  v_texCoord = a_texCoord;
}
`;

const ENT_FRAGMENT_SRC = `
precision mediump float;
uniform sampler2D u_texture;
varying vec2 v_texCoord;
void main() {
  vec4 color = texture2D(u_texture, v_texCoord);
  if (color.a < 0.01) discard;
  gl_FragColor = color;
}
`;

// ── Helpers ───────────────────────────────────────────────────

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  src: string
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Failed to create shader");
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${info}`);
  }
  return shader;
}

function createProgram(
  gl: WebGLRenderingContext,
  vertSrc: string,
  fragSrc: string
): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error("Failed to create program");
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, vertSrc));
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, fragSrc));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Program link error: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

// ── Constants ─────────────────────────────────────────────────

const MAX_ENTITIES = 1024;
const FLOATS_PER_VERTEX = 4; // x, y, u, v
const VERTS_PER_QUAD = 4;
const INDICES_PER_QUAD = 6;

// ── Renderer ──────────────────────────────────────────────────

export class Renderer {
  private readonly gl: WebGLRenderingContext;
  private readonly bgProgram: WebGLProgram;
  private readonly entProgram: WebGLProgram;
  private readonly texture: WebGLTexture;

  // Background buffers
  private readonly bgPosBuffer: WebGLBuffer;
  private readonly bgTexBuffer: WebGLBuffer;

  // Entity buffers
  private readonly entVertexBuffer: WebGLBuffer;
  private readonly entIndexBuffer: WebGLBuffer;
  private readonly entVertices: Float32Array;

  // Sprite atlas (set via setSpriteAtlas)
  private spriteAtlas: (BakedSprite | null)[] = [];

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl");
    if (!gl) throw new Error("WebGL not supported");
    this.gl = gl;

    // --- Compile both programs ---
    this.bgProgram = createProgram(gl, BG_VERTEX_SRC, BG_FRAGMENT_SRC);
    this.entProgram = createProgram(gl, ENT_VERTEX_SRC, ENT_FRAGMENT_SRC);

    // --- Background full-screen quad ---
    this.bgPosBuffer = this.createStaticBuffer(
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])
    );
    this.bgTexBuffer = this.createStaticBuffer(
      new Float32Array([0, 1, 1, 1, 0, 0, 1, 0])
    );

    // --- Entity batch buffers ---
    this.entVertices = new Float32Array(
      MAX_ENTITIES * VERTS_PER_QUAD * FLOATS_PER_VERTEX
    );

    const vertBuf = gl.createBuffer();
    if (!vertBuf) throw new Error("Failed to create entity vertex buffer");
    this.entVertexBuffer = vertBuf;
    gl.bindBuffer(gl.ARRAY_BUFFER, vertBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      this.entVertices.byteLength,
      gl.DYNAMIC_DRAW
    );

    // Pre-fill index buffer (static pattern for up to 1024 quads)
    const indices = new Uint16Array(MAX_ENTITIES * INDICES_PER_QUAD);
    for (let i = 0; i < MAX_ENTITIES; i++) {
      const vBase = i * 4;
      const iOff = i * 6;
      indices[iOff] = vBase;
      indices[iOff + 1] = vBase + 1;
      indices[iOff + 2] = vBase + 2;
      indices[iOff + 3] = vBase + 2;
      indices[iOff + 4] = vBase + 1;
      indices[iOff + 5] = vBase + 3;
    }
    const idxBuf = gl.createBuffer();
    if (!idxBuf) throw new Error("Failed to create entity index buffer");
    this.entIndexBuffer = idxBuf;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    // --- Shared texture (pixel-art filtering) ---
    const tex = gl.createTexture();
    if (!tex) throw new Error("Failed to create texture");
    this.texture = tex;

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  }

  /** Set the compiled sprite atlas for entity rendering. */
  setSpriteAtlas(atlas: (BakedSprite | null)[]): void {
    this.spriteAtlas = atlas;
  }

  private createStaticBuffer(data: Float32Array): WebGLBuffer {
    const { gl } = this;
    const buf = gl.createBuffer();
    if (!buf) throw new Error("Failed to create buffer");
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return buf;
  }

  /**
   * Two-pass render: background quad then entity batch.
   * @param state  RGBA Uint8ClampedArray (width × height × 4)
   * @param width  State buffer width in pixels
   * @param height State buffer height in pixels
   */
  render(state: Uint8ClampedArray, width: number, height: number): void {
    const { gl, texture } = this;

    // Upload state buffer as texture
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      state
    );

    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    // Read camera offset (pixels) from globals block (bytes 64–67)
    const camX =
      state.length > GLOBALS_CAMERA_Y_BYTE + 1
        ? (state[GLOBALS_CAMERA_X_BYTE] << 8) | state[GLOBALS_CAMERA_X_BYTE + 1]
        : 0;
    const camY =
      state.length > GLOBALS_CAMERA_Y_BYTE + 1
        ? (state[GLOBALS_CAMERA_Y_BYTE] << 8) | state[GLOBALS_CAMERA_Y_BYTE + 1]
        : 0;

    // ── Pass 1: Background ────────────────────────────────────
    this.renderBackground(camX / width, camY / height);

    // ── Pass 2: Entities ──────────────────────────────────────
    this.renderEntities(state, width, height, camX, camY);
  }

  private renderBackground(offsetU: number, offsetV: number): void {
    const { gl, bgProgram, bgPosBuffer, bgTexBuffer } = this;

    gl.useProgram(bgProgram);

    const camLoc = gl.getUniformLocation(bgProgram, "u_camOffset");
    gl.uniform2f(camLoc, offsetU, offsetV);

    const posLoc = gl.getAttribLocation(bgProgram, "a_position");
    gl.bindBuffer(gl.ARRAY_BUFFER, bgPosBuffer);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const texLoc = gl.getAttribLocation(bgProgram, "a_texCoord");
    gl.bindBuffer(gl.ARRAY_BUFFER, bgTexBuffer);
    gl.enableVertexAttribArray(texLoc);
    gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private renderEntities(
    state: Uint8ClampedArray,
    width: number,
    height: number,
    camX: number,
    camY: number
  ): void {
    const { gl, entProgram, entVertexBuffer, entIndexBuffer, entVertices, spriteAtlas } = this;

    if (spriteAtlas.length <= 1) return; // no sprites loaded

    const poolStart = MEMORY_BLOCKS.entityPool.startByte;
    const poolEnd = MEMORY_BLOCKS.entityPool.endByte;

    let quadCount = 0;
    let vOff = 0;

    for (
      let ptr = poolStart;
      ptr + ENTITY_SLOT_SIZE - 1 <= poolEnd && quadCount < MAX_ENTITIES;
      ptr += ENTITY_SLOT_SIZE
    ) {
      const active = readInt8(state, ptr + ENTITY_ACTIVE);
      if (active === 0) continue;

      const typeId = readInt8(state, ptr + ENTITY_TYPE_ID);
      if (typeId === 0 || typeId >= spriteAtlas.length) continue;

      const sprite = spriteAtlas[typeId];
      if (!sprite) continue;

      const posX = readInt16(state, ptr + ENTITY_POS_X);
      const posY = readInt16(state, ptr + ENTITY_POS_Y);

      // Screen-space corners (camera offset applied to position)
      const x0 = posX - sprite.ox - camX;
      const y0 = posY - sprite.oy - camY;
      const x1 = x0 + sprite.w;
      const y1 = y0 + sprite.h;

      // top-left
      entVertices[vOff++] = x0;
      entVertices[vOff++] = y0;
      entVertices[vOff++] = sprite.u0;
      entVertices[vOff++] = sprite.v0;
      // top-right
      entVertices[vOff++] = x1;
      entVertices[vOff++] = y0;
      entVertices[vOff++] = sprite.u1;
      entVertices[vOff++] = sprite.v0;
      // bottom-left
      entVertices[vOff++] = x0;
      entVertices[vOff++] = y1;
      entVertices[vOff++] = sprite.u0;
      entVertices[vOff++] = sprite.v1;
      // bottom-right
      entVertices[vOff++] = x1;
      entVertices[vOff++] = y1;
      entVertices[vOff++] = sprite.u1;
      entVertices[vOff++] = sprite.v1;

      quadCount++;
    }

    if (quadCount === 0) return;

    gl.useProgram(entProgram);

    // Enable alpha blending for transparent sprite pixels
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const resLoc = gl.getUniformLocation(entProgram, "u_resolution");
    gl.uniform2f(resLoc, width, height);

    const stride = FLOATS_PER_VERTEX * Float32Array.BYTES_PER_ELEMENT;

    gl.bindBuffer(gl.ARRAY_BUFFER, entVertexBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, entVertices.subarray(0, vOff));

    const posLoc = gl.getAttribLocation(entProgram, "a_position");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, stride, 0);

    const texLoc = gl.getAttribLocation(entProgram, "a_texCoord");
    gl.enableVertexAttribArray(texLoc);
    gl.vertexAttribPointer(
      texLoc,
      2,
      gl.FLOAT,
      false,
      stride,
      2 * Float32Array.BYTES_PER_ELEMENT
    );

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, entIndexBuffer);
    gl.drawElements(
      gl.TRIANGLES,
      quadCount * INDICES_PER_QUAD,
      gl.UNSIGNED_SHORT,
      0
    );

    gl.disable(gl.BLEND);
  }
}
