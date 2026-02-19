/**
 * Kinetic Pathfinding — Bezier Tracing
 *
 * During the Bake Phase the engine scans the image for colour-coded
 * paths (Start / Path / Node colours) and converts the pixel chain into
 * a smooth Catmull-Rom or Cubic Bezier spline for entities to follow.
 */

import type { Point } from "./baker.js";

export interface PathScan {
  startColor: string;
  pathColor: string;
  nodeColor: string;
}

/** Compare an RGBA pixel at `idx*4` against a hex color. */
function pixelIs(
  data: Uint8ClampedArray,
  idx: number,
  r: number,
  g: number,
  b: number
): boolean {
  const base = idx * 4;
  return data[base] === r && data[base + 1] === g && data[base + 2] === b;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const full = clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/**
 * Walk a pixel path from a start pixel to the first node pixel,
 * following adjacent path-color pixels (4-connected).
 */
export function tracePixelPath(
  imageData: ImageData,
  scan: PathScan
): Point[] {
  const { data, width, height } = imageData;
  const [sr, sg, sb] = hexToRgb(scan.startColor);
  const [pr, pg, pb] = hexToRgb(scan.pathColor);
  const [nr, ng, nb] = hexToRgb(scan.nodeColor);

  const pixelCount = width * height;

  // Find start pixel
  let startIdx = -1;
  for (let i = 0; i < pixelCount; i++) {
    if (pixelIs(data, i, sr, sg, sb)) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) return [];

  const visited = new Set<number>();
  const path: Point[] = [];
  let current = startIdx;

  while (current !== -1) {
    visited.add(current);
    const x = current % width;
    const y = Math.floor(current / width);
    path.push({ x, y });

    // Check if we reached a node
    if (path.length > 1 && pixelIs(data, current, nr, ng, nb)) break;

    let next = -1;
    for (const [dx, dy] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const ni = ny * width + nx;
      if (visited.has(ni)) continue;
      if (
        pixelIs(data, ni, pr, pg, pb) ||
        pixelIs(data, ni, nr, ng, nb)
      ) {
        next = ni;
        break;
      }
    }
    current = next;
  }

  return path;
}

/**
 * Convert a chain of pixel points to a Catmull-Rom spline sampled at
 * `steps` uniform intervals along the parameterised curve.
 */
export function catmullRomSpline(points: Point[], steps = 20): Point[] {
  if (points.length < 2) return points.slice();

  const result: Point[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;

      const x =
        0.5 *
        (2 * p1.x +
          (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);

      const y =
        0.5 *
        (2 * p1.y +
          (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);

      result.push({ x, y });
    }
  }

  return result;
}
