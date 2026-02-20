/**
 * WebGL Renderer
 *
 * Pushes the state buffer (Uint8ClampedArray) to a WebGL texture and
 * renders it as a full-screen quad each frame.
 */

/**
 * Camera globals layout (in the engine state buffer):
 *   Byte 64–65 (Int16): camera X offset in pixels
 *   Byte 66–67 (Int16): camera Y offset in pixels
 *
 * A zero camera produces the identity view.
 */
export const GLOBALS_CAMERA_X_BYTE = 64;
export const GLOBALS_CAMERA_Y_BYTE = 66;

const VERTEX_SHADER_SRC = `
attribute vec2 a_position;
attribute vec2 a_texCoord;
uniform vec2 u_camOffset;
varying vec2 v_texCoord;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord + u_camOffset;
}
`;

const FRAGMENT_SHADER_SRC = `
precision mediump float;
uniform sampler2D u_texture;
varying vec2 v_texCoord;
void main() {
  gl_FragColor = texture2D(u_texture, v_texCoord);
}
`;

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

export class Renderer {
  private readonly gl: WebGLRenderingContext;
  private readonly program: WebGLProgram;
  private readonly texture: WebGLTexture;
  private readonly positionBuffer: WebGLBuffer;
  private readonly texCoordBuffer: WebGLBuffer;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl");
    if (!gl) throw new Error("WebGL not supported");
    this.gl = gl;

    this.program = createProgram(gl, VERTEX_SHADER_SRC, FRAGMENT_SHADER_SRC);

    // Full-screen quad
    this.positionBuffer = this.createBuffer(
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])
    );
    this.texCoordBuffer = this.createBuffer(
      new Float32Array([0, 1, 1, 1, 0, 0, 1, 0])
    );

    const tex = gl.createTexture();
    if (!tex) throw new Error("Failed to create texture");
    this.texture = tex;

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  }

  private createBuffer(data: Float32Array): WebGLBuffer {
    const { gl } = this;
    const buf = gl.createBuffer();
    if (!buf) throw new Error("Failed to create buffer");
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return buf;
  }

  /**
   * Upload a new state buffer and render it.
   * @param state RGBA Uint8ClampedArray (width × height × 4)
   * @param width  State buffer width in pixels
   * @param height State buffer height in pixels
   */
  render(state: Uint8ClampedArray, width: number, height: number): void {
    const { gl, program, texture, positionBuffer, texCoordBuffer } = this;

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

    gl.useProgram(program);

    // Read camera offset from globals block (bytes 64–67) and convert to
    // normalised UV units so the viewport scrolls through the pixel world.
    const camXRaw = state.length > GLOBALS_CAMERA_Y_BYTE + 1
      ? ((state[GLOBALS_CAMERA_X_BYTE] << 8) | state[GLOBALS_CAMERA_X_BYTE + 1])
      : 0;
    const camYRaw = state.length > GLOBALS_CAMERA_Y_BYTE + 1
      ? ((state[GLOBALS_CAMERA_Y_BYTE] << 8) | state[GLOBALS_CAMERA_Y_BYTE + 1])
      : 0;
    const offsetU = camXRaw / width;
    const offsetV = camYRaw / height;

    const camOffsetLoc = gl.getUniformLocation(program, "u_camOffset");
    gl.uniform2f(camOffsetLoc, offsetU, offsetV);

    const posLoc = gl.getAttribLocation(program, "a_position");
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const texLoc = gl.getAttribLocation(program, "a_texCoord");
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.enableVertexAttribArray(texLoc);
    gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0);

    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
