/** QR error-correction levels in the two-bit order used by the format field. */
export type ErrorCorrectionLevel = 'M' | 'L' | 'H' | 'Q';
export interface FormatInformation {
  errorCorrection: ErrorCorrectionLevel;
  mask: number;
  distance: number;
}

const LEVELS: ErrorCorrectionLevel[] = ['M', 'L', 'H', 'Q'];

function formatCode(data: number): number {
  let remainder = data << 10;
  for (let bit = 14; bit >= 10; bit--) {
    if ((remainder & (1 << bit)) !== 0) remainder ^= 0x537 << (bit - 10);
  }
  return ((data << 10) | remainder) ^ 0x5412;
}

function distance(a: number, b: number): number {
  let bits = a ^ b;
  let count = 0;
  while (bits !== 0) {
    bits &= bits - 1;
    count++;
  }
  return count;
}

/** Decode either of the two BCH-protected format copies, correcting up to three bits. */
export function decodeFormat(first: number, second: number): FormatInformation | null {
  let best: FormatInformation | null = null;
  for (let value = 0; value < 32; value++) {
    const encoded = formatCode(value);
    const errors = Math.min(distance(first & 0x7fff, encoded), distance(second & 0x7fff, encoded));
    if (errors <= 3 && (best === null || errors < best.distance)) {
      best = { errorCorrection: LEVELS[value >> 3], mask: value & 7, distance: errors };
    }
  }
  return best;
}
