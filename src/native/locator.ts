import { BitMatrix } from './matrix.js';

export interface Point { x: number; y: number }
export interface QRLocation {
  topLeft: Point;
  topRight: Point;
  bottomLeft: Point;
  alignmentPattern: Point;
  dimension: number;
}

interface Candidate extends Point { size: number; hits: number }

function matchesFinder(first: number, second: number, middle: number, fourth: number, last: number, unit: number): boolean {
  const tolerance = unit * 0.8;
  return unit >= 0.7 &&
    Math.abs(middle - unit * 3) <= unit * 1.65 &&
    Math.abs(first - unit) <= tolerance && Math.abs(second - unit) <= tolerance &&
    Math.abs(fourth - unit) <= tolerance && Math.abs(last - unit) <= tolerance;
}

// Cross-check a possible finder center against the 1:1:3:1:1 pattern on another axis.
function crossCheck(image: BitMatrix, x: number, y: number, vertical: boolean, limit: number): { center: number; size: number } | null {
  const fixed = Math.floor(vertical ? x : y);
  const center = Math.floor(vertical ? y : x);
  const length = vertical ? image.height : image.width;
  const pixel = (n: number) => n >= 0 && n < length && image.get(vertical ? fixed : n, vertical ? n : fixed);
  if (!pixel(center)) return null;
  let a = center, b = center;
  while (a >= 0 && pixel(a) && center - a <= limit * 4) a--;
  while (b < length && pixel(b) && b - center <= limit * 4) b++;
  const middle = b - a - 1;
  let left = a; while (left >= 0 && !pixel(left) && a - left <= limit * 2) left--;
  let farLeft = left; while (farLeft >= 0 && pixel(farLeft) && left - farLeft <= limit * 2) farLeft--;
  let right = b; while (right < length && !pixel(right) && right - b <= limit * 2) right++;
  let farRight = right; while (farRight < length && pixel(farRight) && farRight - right <= limit * 2) farRight++;
  const size = (farRight - farLeft - 1) / 7;
  if (!matchesFinder(left - farLeft, a - left, middle, right - b, farRight - right, size)) return null;
  return { center: (a + b) / 2, size };
}

function findPatterns(image: BitMatrix): Candidate[] {
  const candidates: Candidate[] = [];
  for (let y = 0; y < image.height; y++) {
    const row = image.row(y);
    let first = 0, second = 0, middle = 0, fourth = 0, last = 0;
    let start = 0;
    let color = row[0];
    for (let x = 1; x <= image.width; x++) {
      const current = x < image.width ? row[x] : 1 - color;
      if (current === color) continue;
      first = second;
      second = middle;
      middle = fourth;
      fourth = last;
      last = x - start;
      const unit = (first + second + middle + fourth + last) / 7;
      if (color === 1 && first > 0 && matchesFinder(first, second, middle, fourth, last, unit)) {
        const cx = x - last - fourth - middle / 2;
        const vertical = crossCheck(image, cx, y, true, unit);
        const horizontal = vertical && crossCheck(image, cx, vertical.center, false, unit);
        if (vertical && horizontal && Math.max(vertical.size, horizontal.size) < Math.min(vertical.size, horizontal.size) * 2.5) {
          const size = (vertical.size + horizontal.size) / 2;
          const existing = candidates.find(p => Math.hypot(p.x - horizontal.center, p.y - vertical.center) < Math.max(p.size, size) * 2 && Math.abs(p.size - size) < size);
          if (existing) {
            const n = ++existing.hits;
            existing.x += (horizontal.center - existing.x) / n;
            existing.y += (vertical.center - existing.y) / n;
            existing.size += (size - existing.size) / n;
          } else candidates.push({ x: horizontal.center, y: vertical.center, size, hits: 1 });
        }
      }
      start = x; color = current;
    }
  }
  return candidates.filter(p => p.hits >= Math.max(1, Math.floor(p.size / 2))).sort((a, b) => b.hits - a.hits).slice(0, 24);
}

function findAlignment(image: BitMatrix, expected: Point, size: number, radius: number): Point {
  let best: Point = expected;
  let bestScore = Infinity;
  const minX = Math.max(1, Math.floor(expected.x - radius)), maxX = Math.min(image.width - 2, Math.ceil(expected.x + radius));
  const minY = Math.max(1, Math.floor(expected.y - radius)), maxY = Math.min(image.height - 2, Math.ceil(expected.y + radius));
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    if (!image.get(x, y)) continue;
    const line = (vertical: boolean) => {
      const origin = vertical ? y : x, limit = vertical ? image.height : image.width;
      const pixel = (n: number) => n >= 0 && n < limit && image.get(vertical ? x : n, vertical ? n : y);
      let left = origin, right = origin;
      while (left >= 0 && pixel(left) && origin - left < size * 2) left--;
      while (right < limit && pixel(right) && right - origin < size * 2) right++;
      let leftWhite = left, rightWhite = right;
      while (leftWhite >= 0 && !pixel(leftWhite) && left - leftWhite < size * 2) leftWhite--;
      while (rightWhite < limit && !pixel(rightWhite) && rightWhite - right < size * 2) rightWhite++;
      const runs = [left - leftWhite, right - left - 1, rightWhite - right];
      return { center: (left + right) / 2, error: runs.reduce((sum, run) => sum + Math.abs(run - size) / size, 0) };
    };
    const horizontal = line(false);
    if (horizontal.error >= bestScore) continue;
    const vertical = line(true);
    const score = horizontal.error + vertical.error + Math.hypot(x - expected.x, y - expected.y) / Math.max(size, 1) * 0.08;
    if (score < bestScore) { bestScore = score; best = { x: horizontal.center, y: vertical.center }; }
  }
  return bestScore <= 2.5 ? best : expected;
}

/** Find candidate QR finder triples and estimate their module dimensions. */
export function* locate(image: BitMatrix): IterableIterator<QRLocation> {
  const patterns = findPatterns(image);
  const choices: Array<{ location: QRLocation; score: number; size: number; radius: number }> = [];
  for (let i = 0; i < patterns.length; i++) for (let j = i + 1; j < patterns.length; j++) for (let k = j + 1; k < patterns.length; k++) {
    const triple = [patterns[i], patterns[j], patterns[k]];
    for (let pivot = 0; pivot < 3; pivot++) {
      const tl = triple[pivot], a = triple[(pivot + 1) % 3], b = triple[(pivot + 2) % 3];
      const ax = a.x - tl.x, ay = a.y - tl.y, bx = b.x - tl.x, by = b.y - tl.y;
      const da = Math.hypot(ax, ay), db = Math.hypot(bx, by);
      const dot = Math.abs(ax * bx + ay * by) / (da * db);
      if (!Number.isFinite(dot) || dot > 0.55 || Math.min(da, db) < 8 * Math.min(tl.size, a.size, b.size) || Math.max(da, db) / Math.min(da, db) > 2.5) continue;
      const topRight = ax * by - ay * bx > 0 ? a : b;
      const bottomLeft = topRight === a ? b : a;
      const size = (tl.size * 2 + a.size + b.size) / 4;
      const estimated = (da + db) / (2 * size) + 7;
      const dimension = 21 + 4 * Math.round((estimated - 21) / 4);
      if (dimension < 21 || dimension > 177) continue;
      const geometry = dot * 4 + Math.abs(Math.log(da / db)) * 2 + Math.abs(estimated - dimension) / 8;
      const support = Math.log(1 + Math.min(tl.hits, a.hits, b.hits));
      for (const candidateDimension of [dimension, dimension - 4, dimension + 4]) {
        if (candidateDimension < 21 || candidateDimension > 177) continue;
        const factor = (candidateDimension - 10) / (candidateDimension - 7);
        const expected = { x: tl.x + (topRight.x + bottomLeft.x - 2 * tl.x) * factor, y: tl.y + (topRight.y + bottomLeft.y - 2 * tl.y) * factor };
        choices.push({ location: { topLeft: tl, topRight, bottomLeft, alignmentPattern: expected, dimension: candidateDimension }, score: geometry - support + Math.abs(candidateDimension - dimension) / 16, size, radius: Math.min(4 * size, Math.min(da, db) * 0.2) });
      }
    }
  }
  choices.sort((a, b) => a.score - b.score);
  for (const { location, size, radius } of choices.slice(0, 24)) {
    if (location.dimension !== 21) {
      location.alignmentPattern = findAlignment(image, location.alignmentPattern, size, radius);
    }
    yield location;
  }
}
