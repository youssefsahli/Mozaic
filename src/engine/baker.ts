/**
 * Baker — Bake-on-Load Phase
 *
 * Performs expensive one-time analysis when an asset is first loaded:
 *   1. Applies Marching Squares to extract collision polygons from alpha data.
 *   2. Converts pixel-drawn paths into Bezier spline arrays.
 *   3. Identifies audio sequencer grids (16x16 or 32x32).
 */

export interface Point {
  x: number;
  y: number;
}

export interface BakedAsset {
  width: number;
  height: number;
  /** Collision polygons extracted via Marching Squares. */
  collisionPolygons: Point[][];
  /** Bezier control-point arrays for path entities. */
  bezierPaths: Point[][];
  /** Audio sequencer grid data (pitch x time steps). */
  sequencerGrids: SequencerGrid[];
}

export interface SequencerGrid {
  size: 16 | 32;
  /** Flattened RGBA pixel data for the grid region. */
  data: Uint8ClampedArray;
}

const DEFAULT_PATH_COLORS = ["#ff00ff", "#00ffff", "#ffff00"];

/**
 * Build a binary alpha grid: 1 if pixel alpha >= threshold, 0 otherwise.
 */
function buildAlphaGrid(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 128
): Uint8Array {
  const grid = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      grid[y * width + x] = alpha >= threshold ? 1 : 0;
    }
  }
  return grid;
}

/**
 * Full 16-case Marching Squares look-up table.
 *
 * Cell index: idx = (tl << 3) | (tr << 2) | (br << 1) | bl
 *
 * Edge indices: 0 = top, 1 = right, 2 = bottom, 3 = left
 * Midpoint positions for cell at (x, y):
 *   top    → { x + 0.5,   y       }
 *   right  → { x + 1,     y + 0.5 }
 *   bottom → { x + 0.5,   y + 1   }
 *   left   → { x,         y + 0.5 }
 *
 * Saddle cases (5 = TR+BL, 10 = TL+BR) are each resolved as two segments.
 */
const MS_LOOKUP: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [],                    // 0  all outside
  [[3, 2]],              // 1  BL → left-bottom
  [[2, 1]],              // 2  BR → bottom-right
  [[3, 1]],              // 3  BL+BR → left-right
  [[0, 1]],              // 4  TR → top-right
  [[0, 1], [2, 3]],      // 5  TR+BL saddle → top-right, bottom-left
  [[0, 2]],              // 6  TR+BR → top-bottom
  [[0, 3]],              // 7  TR+BR+BL → top-left
  [[0, 3]],              // 8  TL → top-left
  [[0, 2]],              // 9  TL+BL → top-bottom
  [[0, 3], [2, 1]],      // 10 TL+BR saddle → top-left, bottom-right
  [[0, 1]],              // 11 TL+BL+BR → top-right
  [[3, 1]],              // 12 TL+TR → left-right
  [[1, 2]],              // 13 TL+TR+BL → right-bottom
  [[2, 3]],              // 14 TL+TR+BR → bottom-left
  [],                    // 15 all inside
];

/** Return the pixel-space midpoint of an edge in cell (x, y). */
function edgeMidpoint(cellX: number, cellY: number, edge: number): Point {
  switch (edge) {
    case 0: return { x: cellX + 0.5, y: cellY };
    case 1: return { x: cellX + 1,   y: cellY + 0.5 };
    case 2: return { x: cellX + 0.5, y: cellY + 1 };
    default: return { x: cellX,      y: cellY + 0.5 };
  }
}

/**
 * Stitch a flat list of line segments into polylines.
 * Uses a free-list chain so each segment is visited at most once.
 */
function connectSegments(segments: Array<readonly [Point, Point]>): Point[][] {
  if (segments.length === 0) return [];

  const ptKey = (p: Point) => `${p.x},${p.y}`;

  // Build adjacency: point-key → list of { other-endpoint, segment-index }
  const adj = new Map<string, Array<{ pt: Point; si: number }>>();
  for (let i = 0; i < segments.length; i++) {
    const [a, b] = segments[i];
    const ka = ptKey(a);
    const kb = ptKey(b);
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka)!.push({ pt: b, si: i });
    adj.get(kb)!.push({ pt: a, si: i });
  }

  const usedSeg = new Uint8Array(segments.length);
  const polygons: Point[][] = [];

  for (let i = 0; i < segments.length; i++) {
    if (usedSeg[i]) continue;

    const chain: Point[] = [segments[i][0], segments[i][1]];
    usedSeg[i] = 1;

    // Grow forward from the tail
    let growing = true;
    while (growing) {
      growing = false;
      const tail = chain[chain.length - 1];
      for (const { pt, si } of adj.get(ptKey(tail)) ?? []) {
        if (usedSeg[si]) continue;
        usedSeg[si] = 1;
        chain.push(pt);
        growing = true;
        break;
      }
    }

    // Grow backward from the head
    growing = true;
    while (growing) {
      growing = false;
      const head = chain[0];
      for (const { pt, si } of adj.get(ptKey(head)) ?? []) {
        if (usedSeg[si]) continue;
        usedSeg[si] = 1;
        chain.unshift(pt);
        growing = true;
        break;
      }
    }

    if (chain.length >= 2) polygons.push(chain);
  }

  return polygons;
}

/**
 * Full Marching Squares using the 16-case look-up table.
 *
 * Each 2×2 cell is classified by its corner alpha values into one of the
 * 16 cases, the corresponding edge midpoints are computed, and the resulting
 * line segments are stitched into contiguous polygons.
 */
export function marchingSquares(
  imageData: ImageData,
  threshold = 128
): Point[][] {
  const { data, width, height } = imageData;
  const grid = buildAlphaGrid(data, width, height, threshold);

  const segments: Array<readonly [Point, Point]> = [];

  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const tl = grid[y * width + x];
      const tr = grid[y * width + (x + 1)];
      const br = grid[(y + 1) * width + (x + 1)];
      const bl = grid[(y + 1) * width + x];
      const idx = (tl << 3) | (tr << 2) | (br << 1) | bl;

      for (const [e1, e2] of MS_LOOKUP[idx]) {
        segments.push([edgeMidpoint(x, y, e1), edgeMidpoint(x, y, e2)]);
      }
    }
  }

  return connectSegments(segments);
}

/**
 * Convert an array of pixel points to a simple cubic Bezier control array.
 * Every 3rd point becomes a control point.
 */
export function pixelsToBezier(points: Point[]): Point[] {
  if (points.length < 2) return points.slice();
  const result: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i += 3) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[Math.min(points.length - 1, i + 1)];
    // Catmull-Rom control point approximation
    result.push({
      x: p1.x + (p2.x - p0.x) / 6,
      y: p1.y + (p2.y - p0.y) / 6,
    });
    result.push(p1);
  }
  result.push(points[points.length - 1]);
  return result;
}

export function simplifyPolygon(points: Point[], epsilon = 1.2): Point[] {
  if (points.length <= 2) return points.slice();
  return rdp(points, epsilon);
}

function rdp(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2) return points.slice();

  const first = points[0];
  const last = points[points.length - 1];
  let maxDistance = 0;
  let index = 0;

  for (let i = 1; i < points.length - 1; i++) {
    const distance = perpendicularDistance(points[i], first, last);
    if (distance > maxDistance) {
      maxDistance = distance;
      index = i;
    }
  }

  if (maxDistance <= epsilon) {
    return [first, last];
  }

  const left = rdp(points.slice(0, index + 1), epsilon);
  const right = rdp(points.slice(index), epsilon);
  return left.slice(0, -1).concat(right);
}

function perpendicularDistance(point: Point, lineStart: Point, lineEnd: Point): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;

  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - lineStart.x, point.y - lineStart.y);
  }

  const numerator = Math.abs(
    dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x
  );
  const denominator = Math.hypot(dx, dy);
  return numerator / denominator;
}

export function extractColorPaths(
  imageData: ImageData,
  colors = DEFAULT_PATH_COLORS
): Point[][] {
  const colorSet = new Set(colors.map((c) => normalizeHex(c)));
  const { data, width, height } = imageData;
  const visited = new Uint8Array(width * height);
  const paths: Point[][] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (visited[idx]) continue;

      const rgbaIdx = idx * 4;
      const alpha = data[rgbaIdx + 3];
      if (alpha < 16) continue;

      const colorHex = rgbToHex(data[rgbaIdx], data[rgbaIdx + 1], data[rgbaIdx + 2]);
      if (!colorSet.has(colorHex)) continue;

      const component = floodFillColor(imageData, x, y, colorHex, visited);
      if (component.length >= 2) {
        paths.push(component);
      }
    }
  }

  return paths.map((path) => simplifyPolygon(path, 0.9));
}

function floodFillColor(
  imageData: ImageData,
  startX: number,
  startY: number,
  hexColor: string,
  visited: Uint8Array
): Point[] {
  const { data, width, height } = imageData;
  const points: Point[] = [];
  const queue: Point[] = [{ x: startX, y: startY }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const idx = current.y * width + current.x;
    if (visited[idx]) continue;
    visited[idx] = 1;

    const base = idx * 4;
    const color = rgbToHex(data[base], data[base + 1], data[base + 2]);
    if (color !== hexColor || data[base + 3] < 16) continue;

    points.push({ x: current.x, y: current.y });

    if (current.x > 0) queue.push({ x: current.x - 1, y: current.y });
    if (current.x < width - 1) queue.push({ x: current.x + 1, y: current.y });
    if (current.y > 0) queue.push({ x: current.x, y: current.y - 1 });
    if (current.y < height - 1) queue.push({ x: current.x, y: current.y + 1 });
  }

  return points;
}

function normalizeHex(hex: string): string {
  const clean = hex.toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(clean)) return clean;
  return "#000000";
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${r.toString(16).padStart(2, "0")}${g
    .toString(16)
    .padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/**
 * Detect sequencer grids inside an ImageData.
 * Looks for 16x16 and 32x32 regions in the image.
 */
export function detectSequencerGrids(imageData: ImageData): SequencerGrid[] {
  const { data, width, height } = imageData;
  const grids: SequencerGrid[] = [];

  for (const size of [16, 32] as const) {
    if (width >= size && height >= size) {
      // Take the top-left region as the sequencer grid
      const gridData = new Uint8ClampedArray(size * size * 4);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const srcIdx = (y * width + x) * 4;
          const dstIdx = (y * size + x) * 4;
          gridData[dstIdx] = data[srcIdx];
          gridData[dstIdx + 1] = data[srcIdx + 1];
          gridData[dstIdx + 2] = data[srcIdx + 2];
          gridData[dstIdx + 3] = data[srcIdx + 3];
        }
      }
      grids.push({ size, data: gridData });
    }
  }

  return grids;
}

/**
 * Run the full bake phase on a loaded ImageData.
 */
export function bake(imageData: ImageData): BakedAsset {
  const polygons = marchingSquares(imageData).map((poly) => simplifyPolygon(poly, 1.2));
  const extractedPaths = extractColorPaths(imageData);
  const sourcePaths = extractedPaths.length > 0 ? extractedPaths : polygons;
  const bezierPaths = sourcePaths.map((poly) => pixelsToBezier(poly));
  const sequencerGrids = detectSequencerGrids(imageData);

  return {
    width: imageData.width,
    height: imageData.height,
    collisionPolygons: polygons,
    bezierPaths,
    sequencerGrids,
  };
}
