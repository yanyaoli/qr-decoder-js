import { BitMatrix } from './matrix.js';

/** Convert RGBA pixels to a locally thresholded QR matrix and, optionally, its inverse. */
export function binarize(data: Uint8ClampedArray, width: number, height: number, returnInverted: boolean) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || data.length !== width * height * 4) {
    throw new Error('Malformed image data');
  }
  const gray = new Uint8Array(width * height);
  const histogram = new Uint32Array(256);
  const tile = 16, columns = Math.ceil(width / tile), rows = Math.ceil(height / tile);
  const minimum = new Uint8Array(columns * rows).fill(255), maximum = new Uint8Array(columns * rows);
  for (let y = 0; y < height; y++) {
    const tileRow = Math.floor(y / tile) * columns;
    for (let x = 0, i = y * width; x < width; x++, i++) {
      const offset = i * 4;
      const luma = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
      const alpha = data[offset + 3] / 255;
      const value = Math.round(alpha === 1 ? luma : luma * alpha + 255 * (1 - alpha));
      gray[i] = value;
      histogram[value]++;
      const index = tileRow + Math.floor(x / tile);
      if (value < minimum[index]) minimum[index] = value;
      if (value > maximum[index]) maximum[index] = value;
    }
  }
  let total = 0;
  for (let i = 0; i < 256; i++) total += i * histogram[i];
  let leftCount = 0, leftSum = 0, best = -1, globalThreshold = 127;
  for (let i = 0; i < 255; i++) {
    leftCount += histogram[i]; leftSum += i * histogram[i];
    const rightCount = gray.length - leftCount;
    if (!leftCount || !rightCount) continue;
    const difference = leftSum / leftCount - (total - leftSum) / rightCount;
    const variance = leftCount * rightCount * difference * difference;
    if (variance > best) { best = variance; globalThreshold = i; }
  }
  const thresholds = new Uint8Array(columns * rows);
  for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < columns; tx++) {
    let low = 255, high = 0;
    for (let y = Math.max(0, ty - 1); y <= Math.min(rows - 1, ty + 1); y++) for (let x = Math.max(0, tx - 1); x <= Math.min(columns - 1, tx + 1); x++) {
      const index = y * columns + x;
      low = Math.min(low, minimum[index]); high = Math.max(high, maximum[index]);
    }
    thresholds[ty * columns + tx] = high - low >= 24 ? Math.floor((low + high) / 2) : globalThreshold;
  }
  const binarized = BitMatrix.createEmpty(width, height);
  const inverted = returnInverted ? BitMatrix.createEmpty(width, height) : null;
  for (let y = 0; y < height; y++) {
    const row = binarized.row(y), inverse = inverted?.row(y);
    const tileRow = Math.floor(y / tile) * columns;
    for (let tx = 0; tx < columns; tx++) {
      const threshold = thresholds[tileRow + tx];
      const end = Math.min((tx + 1) * tile, width);
      for (let x = tx * tile; x < end; x++) {
        const bit = gray[y * width + x] <= threshold ? 1 : 0;
        row[x] = bit;
        if (inverse) inverse[x] = 1 - bit;
      }
    }
  }
  return { binarized, inverted };
}
