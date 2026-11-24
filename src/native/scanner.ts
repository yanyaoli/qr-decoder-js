import { binarize } from './binarize.js';
import { BitMatrix } from './matrix.js';
import { locate, type QRLocation } from './locator.js';
import { extract } from './sampling.js';
import { decode } from './matrix-decoder.js';
import type { Payload } from './bitstream.js';

function scanMatrix(image: BitMatrix, soft: boolean): Payload | null {
  const retryLocations: QRLocation[] = [];
  for (const location of locate(image)) {
    if (soft && retryLocations.length < 6) retryLocations.push(location);
    try {
      const sampled = extract(image, location, false, true);
      if (!sampled) continue;
      const result = decode(sampled.matrix);
      if (result) return result;
    } catch {
      // A degenerate candidate does not prevent trying other finder triples.
    }
  }
  if (soft) {
    // Small, blurred symbols can shift a finder center by a fraction of a module.
    // Only accept a soft-corrected payload when two nearby samples agree.
    for (const location of retryLocations) {
      const moduleSize = (Math.hypot(location.topRight.x - location.topLeft.x, location.topRight.y - location.topLeft.y) +
        Math.hypot(location.bottomLeft.x - location.topLeft.x, location.bottomLeft.y - location.topLeft.y)) / (2 * (location.dimension - 7));
      for (const point of ['bottomLeft', 'topRight', 'topLeft', 'alignmentPattern'] as const) {
        for (const axis of ['x', 'y'] as const) for (const direction of [-1, 1]) {
          let previous: Payload | null = null;
          for (const offset of [0.08, 0.14]) {
            const adjusted = { ...location, [point]: { ...location[point], [axis]: location[point][axis] + direction * offset * moduleSize } };
            try {
              const sampled = extract(image, adjusted, true);
              const result = decode(sampled.matrix, sampled.confidence);
              if (result && previous && result.version === previous.version && result.bytes.length === previous.bytes.length &&
                  result.bytes.every((byte, i) => byte === previous.bytes[i]) && JSON.stringify(result.chunks) === JSON.stringify(previous.chunks)) return result;
              previous = result;
            } catch { previous = null; }
            if (!previous) break;
          }
        }
      }
    }
  }
  return null;
}

export function scanQR(data: Uint8ClampedArray, width: number, height: number, tryInvert = true, soft = false): Payload | null {
  const { binarized, inverted } = binarize(data, width, height, tryInvert);
  return scanMatrix(binarized, soft) || (inverted ? scanMatrix(inverted, soft) : null);
}
