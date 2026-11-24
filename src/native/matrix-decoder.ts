import { BitMatrix } from './matrix.js';
import { decodeFormat } from './format.js';
import { decodePayload, Payload } from './bitstream.js';
import { correctCodewords } from './reed-solomon.js';
import { VERSIONS, VersionSpec } from './versions.js';

function hamming(value: number): number {
  let count = 0;
  while (value) { value &= value - 1; count++; }
  return count;
}

function versionBits(version: number): number {
  let remainder = version << 12;
  for (let bit = 17; bit >= 12; bit--) if (remainder & (1 << bit)) remainder ^= 0x1f25 << (bit - 12);
  return (version << 12) | remainder;
}

export function isVersionValid(n: number, get: (x: number, y: number) => boolean): boolean {
  const version = (n - 17) / 4;
  if (version < 7) return true;
  let first = 0, second = 0;
  for (let i = 0; i < 18; i++) {
    const x = n - 11 + i % 3, y = Math.floor(i / 3);
    if (get(x, y)) first |= 1 << i;
    if (get(y, x)) second |= 1 << i;
  }
  const expected = versionBits(version);
  return Math.min(hamming(first ^ expected), hamming(second ^ expected)) <= 3;
}

function functionMask(dimension: number, spec: VersionSpec, version: number): BitMatrix {
  const reserved = BitMatrix.createEmpty(dimension, dimension);
  reserved.setRegion(0, 0, 9, 9, true);
  reserved.setRegion(dimension - 8, 0, 8, 9, true);
  reserved.setRegion(0, dimension - 8, 9, 8, true);
  for (const y of spec.alignment) for (const x of spec.alignment) {
    if ((x === 6 && (y === 6 || y === dimension - 7)) || (y === 6 && x === dimension - 7)) continue;
    reserved.setRegion(x - 2, y - 2, 5, 5, true);
  }
  reserved.setRegion(6, 9, 1, dimension - 17, true);
  reserved.setRegion(9, 6, dimension - 17, 1, true);
  if (version >= 7) {
    reserved.setRegion(dimension - 11, 0, 3, 6, true);
    reserved.setRegion(0, dimension - 11, 6, 3, true);
  }
  return reserved;
}

function maskBit(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
    case 5: return (x * y) % 2 + (x * y) % 3 === 0;
    case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
    default: return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
  }
}

function decodeOrientation(matrix: BitMatrix, mirrored: boolean, confidence?: Uint8Array): Payload | null {
  const dimension = matrix.width;
  if (dimension !== matrix.height || dimension < 21 || dimension > 177 || dimension % 4 !== 1) return null;
  const version = (dimension - 17) / 4, spec = VERSIONS[version - 1];
  const get = (x: number, y: number) => mirrored ? matrix.get(y, x) : matrix.get(x, y);
  if (!isVersionValid(dimension, get)) return null;
  let first = 0, second = 0;
  const add = (value: number, x: number, y: number) => (value << 1) | Number(get(x, y));
  for (let x = 0; x <= 8; x++) if (x !== 6) first = add(first, x, 8);
  for (let y = 7; y >= 0; y--) if (y !== 6) first = add(first, 8, y);
  for (let y = dimension - 1; y >= dimension - 7; y--) second = add(second, 8, y);
  for (let x = dimension - 8; x < dimension; x++) second = add(second, x, 8);
  const format = decodeFormat(first, second);
  if (!format) return null;
  const reserved = functionMask(dimension, spec, version);
  const words: number[] = [], wordConfidence: number[] = [];
  let byte = 0, count = 0, minimumConfidence = 255, upwards = true;
  for (let right = dimension - 1; right > 0; right -= 2) {
    if (right === 6) right--;
    for (let step = 0; step < dimension; step++) {
      const y = upwards ? dimension - 1 - step : step;
      for (let offset = 0; offset < 2; offset++) {
        const x = right - offset;
        if (reserved.get(x, y)) continue;
        byte = (byte << 1) | Number(get(x, y) !== maskBit(format.mask, x, y));
        if (confidence) minimumConfidence = Math.min(minimumConfidence, confidence[mirrored ? x * dimension + y : y * dimension + x]);
        if (++count === 8) { words.push(byte); wordConfidence.push(minimumConfidence); byte = 0; count = 0; minimumConfidence = 255; }
      }
    }
    upwards = !upwards;
  }
  const ec = spec.blocks[format.errorCorrection];
  const blocks: Array<{ length: number; bytes: number[]; confidence: number[] }> = [];
  for (const [number, length] of ec.groups) for (let i = 0; i < number; i++) blocks.push({ length, bytes: [], confidence: [] });
  const required = blocks.reduce((sum, block) => sum + block.length + ec.parity, 0);
  if (words.length < required) return null;
  let pos = 0;
  const maxData = Math.max(...blocks.map(block => block.length));
  const append = (block: typeof blocks[number]) => { block.bytes.push(words[pos]); block.confidence.push(wordConfidence[pos++]); };
  for (let i = 0; i < maxData; i++) for (const block of blocks) if (i < block.length) append(block);
  for (let i = 0; i < ec.parity; i++) for (const block of blocks) append(block);
  const payload: number[] = [];
  for (const block of blocks) {
    const input = Uint8Array.from(block.bytes);
    let corrected = correctCodewords(input, ec.parity);
    if (!corrected && confidence && Math.min(...block.confidence) < Math.max(...block.confidence)) {
      const indices = block.confidence.map((_, i) => i).sort((a, b) => block.confidence[a] - block.confidence[b] || a - b);
      // Retain six parity symbols for verification after each erasure attempt.
      for (let count = 2; !corrected && count <= ec.parity - 6; count += 2) {
        corrected = correctCodewords(input, ec.parity, indices.slice(0, count));
      }
    }
    if (!corrected) return null;
    for (let i = 0; i < block.length; i++) payload.push(corrected[i]);
  }
  try { return decodePayload(Uint8Array.from(payload), version); } catch { return null; }
}

/** Decode both normal and mirrored orientations of a sampled QR module grid. */
export function decode(matrix: BitMatrix, confidence?: Uint8Array): Payload | null {
  if (confidence && confidence.length !== matrix.width * matrix.height) throw new RangeError('Invalid module confidence');
  return decodeOrientation(matrix, false, confidence) || decodeOrientation(matrix, true, confidence);
}
