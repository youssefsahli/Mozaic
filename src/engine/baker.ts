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

/**
 * Marching Squares look-up table for edge midpoints (simplified 2D).
 * Each cell in the grid is 1 if the alpha of its top-left pixel > threshold.
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
 * Extremely simplified Marching Squares: trace the boundary of each
 * connected alpha region into a polygon.
 *
 * This implementation uses a basic edge-walk and is intentionally
 * minimal for the skeleton — a production version would use the full
 * look-up table approach.
 */
export function marchingSquares(
  imageData: ImageData,
  threshold = 128
): Point[][] {
  const { data, width, height } = imageData;
  const grid = buildAlphaGrid(data, width, height, threshold);
  const visited = new Uint8Array(width * height);
  const polygons: Point[][] = [];

  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      if (visited[y * width + x]) continue;

      // Check the 2x2 cell
      const tl = grid[y * width + x];
      const tr = grid[y * width + (x + 1)];
      const bl = grid[(y + 1) * width + x];
      const br = grid[(y + 1) * width + (x + 1)];
      const idx = (tl << 3) | (tr << 2) | (br << 1) | bl;

      // Only start a polygon on a boundary cell (some but not all corners filled)
      if (idx === 0 || idx === 15) continue;

      visited[y * width + x] = 1;
      polygons.push(tracePolygon(grid, visited, width, height, x, y));
    }
  }

  return polygons;
}

/** Simple boundary trace from a starting cell. */
function tracePolygon(
  grid: Uint8Array,
  visited: Uint8Array,
  width: number,
  height: number,
  startX: number,
  startY: number
): Point[] {
  const polygon: Point[] = [];
  let x = startX;
  let y = startY;
  // Walk right until we leave the grid or revisit
  for (let step = 0; step < width * height; step++) {
    if (x < 0 || x >= width || y < 0 || y >= height) break;
    if (visited[y * width + x]) break;
    visited[y * width + x] = 1;
    polygon.push({ x, y });
    // Move to next boundary cell (simple right-then-down walk)
    if (x + 1 < width && grid[y * width + (x + 1)]) {
      x++;
    } else if (y + 1 < height && grid[(y + 1) * width + x]) {
      y++;
    } else {
      break;
    }
  }
  return polygon;
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
  const polygons = marchingSquares(imageData);
  const bezierPaths = polygons.map((poly) => pixelsToBezier(poly));
  const sequencerGrids = detectSequencerGrids(imageData);

  return {
    width: imageData.width,
    height: imageData.height,
    collisionPolygons: polygons,
    bezierPaths,
    sequencerGrids,
  };
}
