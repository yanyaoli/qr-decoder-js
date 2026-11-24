import { BitMatrix } from './matrix.js';
import { isVersionValid } from './matrix-decoder.js';
import type { Point, QRLocation } from './locator.js';

// Solve a projective mapping from four module coordinates to four image coordinates.
function projection(from: Point[], to: Point[]): (x: number, y: number) => Point {
  const rows: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let row = col + 1; row < 8; row++) {
      if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
    }
    if (Math.abs(rows[pivot][col]) < 1e-10) throw new Error('Degenerate QR geometry');
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    const divisor = rows[col][col];
    for (let j = col; j <= 8; j++) rows[col][j] /= divisor;
    for (let row = 0; row < 8; row++) {
      if (row === col) continue;
      const factor = rows[row][col];
      for (let j = col; j <= 8; j++) rows[row][j] -= factor * rows[col][j];
    }
  }
  const h = rows.map(row => row[8]);
  return (x, y) => {
    const scale = h[6] * x + h[7] * y + 1;
    return { x: (h[0] * x + h[1] * y + h[2]) / scale, y: (h[3] * x + h[4] * y + h[5]) / scale };
  };
}

export function extract(image: BitMatrix, location: QRLocation, soft = false, checkVersion = false) {
  const n = location.dimension;
  const mappingFunction = projection(
    [{ x: 3.5, y: 3.5 }, { x: n - 3.5, y: 3.5 }, { x: n - 6.5, y: n - 6.5 }, { x: 3.5, y: n - 3.5 }],
    [location.topLeft, location.topRight, location.alignmentPattern, location.bottomLeft],
  );
  // The two version fields swap when mirrored, so one check covers both orientations.
  if (checkVersion && !soft && !isVersionValid(n, (x, y) => {
    const point = mappingFunction(x + 0.5, y + 0.5);
    return image.get(Math.floor(point.x), Math.floor(point.y));
  })) return null;

  const matrix = BitMatrix.createEmpty(n, n);
  const confidence = soft ? new Uint8Array(n * n) : undefined;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const point = mappingFunction(x + 0.5, y + 0.5);
    if (point.x < 0 || point.x >= image.width || point.y < 0 || point.y >= image.height) {
      if (confidence) confidence[y * n + x] = 0;
      continue;
    }
    const sample = (dx: number, dy: number) => image.get(Math.floor(point.x + dx), Math.floor(point.y + dy));
    const center = sample(0, 0);
    if (!confidence) { matrix.set(x, y, center); continue; }
    const votes = Number(center) * 2 + Number(sample(-0.25, 0)) + Number(sample(0.25, 0)) + Number(sample(0, -0.25)) + Number(sample(0, 0.25));
    matrix.set(x, y, votes >= 3);
    confidence[y * n + x] = votes === 0 || votes === 6 ? 210 : 40 + Math.abs(2 * votes - 6) * 20;
  }
  return { matrix, mappingFunction, confidence };
}
