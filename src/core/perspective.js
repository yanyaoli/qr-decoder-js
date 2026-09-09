// Perspective-aware rescue: locate the QR code as a convex quadrilateral and warp
// it back to a front-facing square before decoding. Ported conceptually from the
// Python reference (qr_image_parser_v1_2.py):
//   - multi-channel + multi-threshold dark masks with morphological close;
//   - convex-quadrant detection & geometric scoring (find_qr_quads / quad_candidate_score);
//   - homography warp to a canonical size with a white quiet-zone border (warp_quad).
//
// Pure pixel math (no WebGL): works wherever the rest of the library runs.

import { toGray, grayToImageData, toCLAHE, otsuThreshold } from './preprocess';

// ---------------------------------------------------------------------------
// Small pixel kernels (reusable typed helpers)
// ---------------------------------------------------------------------------

/** 3x3 morphological close on a 0/255 dark mask (dark=0 handled as low value). */
function closeDark(mask, width, height) {
  const size = width * height;
  const dilated = new Uint8ClampedArray(size);
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      let min = 255;
      min = Math.min(min, mask[row + x]);
      min = Math.min(min, mask[row + x - 1]);
      min = Math.min(min, mask[row + x + 1]);
      min = Math.min(min, mask[row - width + x]);
      min = Math.min(min, mask[row - width + x - 1]);
      min = Math.min(min, mask[row - width + x + 1]);
      min = Math.min(min, mask[row + width + x]);
      min = Math.min(min, mask[row + width + x - 1]);
      min = Math.min(min, mask[row + width + x + 1]);
      dilated[row + x] = min;
    }
  }
  // Border kept as-is (dilated array already zeroed there -> copy source).
  for (let x = 0; x < width; x++) {
    dilated[x] = mask[x];
    dilated[(height - 1) * width + x] = mask[(height - 1) * width + x];
  }
  for (let y = 0; y < height; y++) {
    dilated[y * width] = mask[y * width];
    dilated[y * width + width - 1] = mask[y * width + width - 1];
  }

  const closed = new Uint8ClampedArray(size);
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      let max = 0;
      max = Math.max(max, dilated[row + x]);
      max = Math.max(max, dilated[row + x - 1]);
      max = Math.max(max, dilated[row + x + 1]);
      max = Math.max(max, dilated[row - width + x]);
      max = Math.max(max, dilated[row - width + x - 1]);
      max = Math.max(max, dilated[row - width + x + 1]);
      max = Math.max(max, dilated[row + width + x]);
      max = Math.max(max, dilated[row + width + x - 1]);
      max = Math.max(max, dilated[row + width + x + 1]);
      closed[row + x] = max;
    }
  }
  for (let x = 0; x < width; x++) {
    closed[x] = mask[x];
    closed[(height - 1) * width + x] = mask[(height - 1) * width + x];
  }
  for (let y = 0; y < height; y++) {
    closed[y * width] = mask[y * width];
    closed[y * width + width - 1] = mask[y * width + width - 1];
  }
  return closed;
}

/** Connected components (4-way) over a 0/255 mask; returns per-component point lists. */
function connectedComponents(mask, width, height) {
  const size = width * height;
  const visited = new Uint8Array(size);
  const components = [];
  for (let start = 0; start < size; start++) {
    if (visited[start] || mask[start] === 0) continue;
    // BFS.
    const stack = [start];
    visited[start] = 1;
    const points = [];
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    while (stack.length) {
      const idx = stack.pop();
      const x = idx % width;
      const y = (idx / width) | 0;
      points.push(idx);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      const neighbors = [];
      if (x > 0) neighbors.push(idx - 1);
      if (x < width - 1) neighbors.push(idx + 1);
      if (y > 0) neighbors.push(idx - width);
      if (y < height - 1) neighbors.push(idx + width);
      for (const nb of neighbors) {
        if (!visited[nb] && mask[nb] !== 0) {
          visited[nb] = 1;
          stack.push(nb);
        }
      }
    }
    components.push({ points, minX, maxX, minY, maxY });
  }
  return components;
}

/** Convex hull of a set of points (Andrew monotone chain). Returns [x,y] pairs. */
function convexHull(points, width) {
  const pts = [];
  for (const idx of points) pts.push([idx % width, (idx / width) | 0]);
  pts.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  if (pts.length <= 3) return pts;
  const cross = (o, a, b) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Reorder 4 corners as TL, TR, BR, BL (same convention as order_quad in Python). */
function orderQuad(quad) {
  const pts = quad.map(([x, y]) => [x, y]);
  // Python: total = x + y, diff = y - x (np.diff on axis 1).
  const sum = pts.map(([x, y]) => x + y);
  const diff = pts.map(([x, y]) => y - x);
  const sumSorted = sum.map((v, i) => [i, v]).sort((a, b) => a[1] - b[1]);
  const diffSorted = diff.map((v, i) => [i, v]).sort((a, b) => a[1] - b[1]);
  const tl = pts[sumSorted[0][0]];
  const tr = pts[diffSorted[0][0]];
  const br = pts[sumSorted[3][0]];
  const bl = pts[diffSorted[3][0]];
  return [tl, tr, br, bl];
}

function polygonArea(quad) {
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = quad[i];
    const [x2, y2] = quad[(i + 1) % 4];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

/**
 * Fit a convex quadrilateral to a set of points (from a connected component) by
 * computing the convex hull and then trying each edge as a candidate base for a
 * minimum-area bounding rectangle. Returns ordered corners or null if not enough
 * points.
 *
 * @param {number[]} points Array of linear indices into a width x height image.
 * @param {number} width Width of the image (for converting linear indices to [x,y]).
 * @returns {number[][] | null} Ordered corners [TL, TR, BR, BL] or null if not enough points.
 */
function fitQuad(points, width) {
  const hull = convexHull(points, width);
  if (hull.length < 3) return null;

  let bestArea = Infinity;
  let bestCorners = null;
  const n = hull.length;
  for (let i = 0; i < n; i++) {
    const ax = hull[i][0];
    const ay = hull[i][1];
    const bx = hull[(i + 1) % n][0];
    const by = hull[(i + 1) % n][1];
    let ex = bx - ax;
    let ey = by - ay;
    const len = Math.hypot(ex, ey);
    if (len < 1e-9) continue;
    ex /= len;
    ey /= len;
    const nx = -ey;
    const ny = ex;

    let e0 = Infinity;
    let e1 = -Infinity;
    let n0 = Infinity;
    let n1 = -Infinity;
    for (let j = 0; j < n; j++) {
      const dx = hull[j][0] - ax;
      const dy = hull[j][1] - ay;
      const ep = dx * ex + dy * ey;
      const np = dx * nx + dy * ny;
      if (ep < e0) e0 = ep;
      if (ep > e1) e1 = ep;
      if (np < n0) n0 = np;
      if (np > n1) n1 = np;
    }
    const area = (e1 - e0) * (n1 - n0);
    if (area < bestArea) {
      bestArea = area;
      bestCorners = [
        [ax + e0 * ex + n0 * nx, ay + e0 * ey + n0 * ny],
        [ax + e1 * ex + n0 * nx, ay + e1 * ey + n0 * ny],
        [ax + e1 * ex + n1 * nx, ay + e1 * ey + n1 * ny],
        [ax + e0 * ex + n1 * nx, ay + e0 * ey + n1 * ny],
      ];
    }
  }
  return bestCorners ? orderQuad(bestCorners) : null;
}

/**
 * Score a candidate quadrilateral for QR-likeness based on area, side lengths,
 * aspect ratio, and proximity to the image edges. Returns a positive score or -1
 * if the quad is rejected.
 *
 * @param {number[][]} quad Ordered corners [TL, TR, BR, BL].
 * @param {number} imgW Image width.
 * @param {number} imgH Image height.
 * @returns {number} Positive score or -1 if rejected.
 */
function quadCandidateScore(quad, imgW, imgH) {
  const total = imgW * imgH;
  const area = polygonArea(quad);
  if (area < total * 0.004 || area > total * 0.8) return -1;
  const lens = [0, 1, 2, 3].map((i) => {
    const [x1, y1] = quad[i];
    const [x2, y2] = quad[(i + 1) % 4];
    return Math.hypot(x2 - x1, y2 - y1);
  });
  if (Math.min(...lens) < Math.max(24, Math.min(imgW, imgH) * 0.02)) return -1;
  const sideRatio = Math.max(...lens) / Math.max(Math.min(...lens), 1);
  if (sideRatio > 2.1) return -1;

  const xs = quad.map((p) => p[0]);
  const ys = quad.map((p) => p[1]);
  const bw = Math.max(...xs) - Math.min(...xs);
  const bh = Math.max(...ys) - Math.min(...ys);
  const aspect = bw / Math.max(bh, 1);
  if (aspect < 0.5 || aspect > 2.0) return -1;

  const margin = Math.max(4, Math.round(Math.min(imgW, imgH) * 0.012));
  const touches =
    (Math.min(...xs) <= margin ? 1 : 0) +
    (Math.min(...ys) <= margin ? 1 : 0) +
    (Math.max(...xs) >= imgW - margin ? 1 : 0) +
    (Math.max(...ys) >= imgH - margin ? 1 : 0);
  const edgePenalty = touches >= 2 ? 0.12 : touches === 1 ? 0.4 : 1.0;
  const areaRatio = area / total;
  const largePenalty = areaRatio > 0.48 ? 0.18 : areaRatio > 0.32 ? 0.55 : 1.0;
  const squareFactor = 1 / sideRatio;
  const aspectFactor = Math.max(0.25, 1 - Math.abs(aspect - 1) * 0.45);
  return area * squareFactor * aspectFactor * edgePenalty * largePenalty;
}

function dedupeQuads(candidates) {
  const out = [];
  for (const [score, quad] of [...candidates].sort((a, b) => b[0] - a[0])) {
    const cx = quad.reduce((s, p) => s + p[0], 0) / 4;
    const cy = quad.reduce((s, p) => s + p[1], 0) / 4;
    const area = polygonArea(quad);
    let dup = false;
    for (const [_s, oq] of out) {
      const ocx = oq.reduce((s, p) => s + p[0], 0) / 4;
      const ocy = oq.reduce((s, p) => s + p[1], 0) / 4;
      const oarea = polygonArea(oq);
      const centerLimit = 0.13 * Math.sqrt(Math.max(area, oarea));
      if (Math.hypot(cx - ocx, cy - ocy) < centerLimit && Math.min(area, oarea) / Math.max(area, oarea, 1) > 0.58) {
        dup = true;
        break;
      }
    }
    if (!dup) out.push([score, quad]);
  }
  return out;
}

/**
 * Locate candidate QR quadrilaterals in an ImageData.
 * Works on grayscale, pure-red and pure-green dark masks across a sweep of fixed
 * thresholds plus Otsu, then morphologically closes and fits convex quads.
 *
 * @param {ImageData} imageData
 * @param {object} [opts]
 * @param {number} [opts.maxDimension=2200] Downscale cap for the analysis pass.
 * @returns {{ score: number, quad: number[][], data: ImageData, width: number, height: number }[]}
 */
export function findQRQuads(imageData, opts = {}) {
  const { maxDimension = 2200 } = opts;
  const { width, height } = imageData;

  let work = imageData;
  let w = width;
  let h = height;
  const maxDim = Math.max(width, height);
  if (maxDim > maxDimension) {
    const scale = maxDimension / maxDim;
    w = Math.max(1, Math.round(width * scale));
    h = Math.max(1, Math.round(height * scale));
    work = downscaleImage(imageData, w, h);
  }

  // Multi-channel analysis: gray, red, green (red is strongest for blue ink).
  const channels = [
    toGray(work),
    redChannel(work),
    greenChannel(work),
  ];
  const candidates = [];

  for (const channel of channels) {
    const otsu = otsuThreshold(channel);
    const thresholds = Array.from(new Set([70, 85, 100, 115, 130, 145, 160, otsu])).sort((a, b) => a - b);
    for (const threshold of thresholds) {
      const dark = new Uint8ClampedArray(w * h);
      for (let i = 0; i < channel.length; i++) dark[i] = channel[i] < threshold ? 255 : 0;
      const closed = closeDark(dark, w, h);
      const components = connectedComponents(closed, w, h);
      for (const comp of components) {
        const compW = comp.maxX - comp.minX + 1;
        const compH = comp.maxY - comp.minY + 1;
        const ratio = compW / Math.max(compH, 1);
        if (ratio < 0.48 || ratio > 2.05) continue;
        if (comp.points.length < w * h * 0.003) continue;
        if (comp.points.length > w * h * 0.82) continue;
        const quad = fitQuad(comp.points, w);
        if (!quad) continue;
        const score = quadCandidateScore(quad, w, h);
        if (score > 0) candidates.push([score, quad]);
      }
    }
  }

  // Geometry was computed on the (possibly downscaled) working image; scale quads
  // back to original coordinates.
  const scaleX = width / w;
  const scaleY = height / h;
  const scaled = dedupeQuads(candidates).slice(0, 12).map(([score, quad]) => {
    const scaledQuad = quad.map(([x, y]) => [x * scaleX, y * scaleY]);
    return { score, quad: scaledQuad };
  });

  if (!scaled.length) return [];
  // Return in original-image space alongside per-quad data.
  return scaled;
}

function redChannel(img) {
  const { data, width, height } = img;
  const out = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) out[p] = data[i];
  return out;
}

function greenChannel(img) {
  const { data, width, height } = img;
  const out = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) out[p] = data[i + 1];
  return out;
}

/** Simple bilinear downscale to an analysis-size canvas (pure pixel). */
function downscaleImage(src, w, h) {
  const { data, width, height } = src;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = ((y + 0.5) * height) / h - 0.5;
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(height - 1, y0 + 1);
    const wy = sy - y0;
    for (let x = 0; x < w; x++) {
      const sx = ((x + 0.5) * width) / w - 0.5;
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(width - 1, x0 + 1);
      const wx = sx - x0;
      for (let c = 0; c < 4; c++) {
        const p00 = data[(y0 * width + x0) * 4 + c];
        const p01 = data[(y0 * width + x1) * 4 + c];
        const p10 = data[(y1 * width + x0) * 4 + c];
        const p11 = data[(y1 * width + x1) * 4 + c];
        const top = p00 + (p01 - p00) * wx;
        const bottom = p10 + (p11 - p10) * wx;
        out[(y * w + x) * 4 + c] = top + (bottom - top) * wy;
      }
    }
  }
  return { data: out, width: w, height: h };
}

/**
 * Compute a 3x3 homography mapping source -> destination for the four corners.
 * Pure-JS analog of cv2.getPerspectiveTransform (solve 8 linear equations).
 * Returns a row-major [a,b,c,d,e,f,g,h,i] matrix such that
 *   x' = (a x + b y + c) / (g x + h y + i)
 *   y' = (d x + e y + f) / (g x + h y + i)
 */
function perspectiveTransform(srcQuad, dstQuad) {
  // 8x8 linear system built from 4 point correspondences, solved via Gauss-Jordan.
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = srcQuad[i];
    const [u, v] = dstQuad[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  // Solve A * h = b with Gauss-Jordan elimination.
  const n = 8;
  const aug = A.map((row, r) => row.concat(b[r]));
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(aug[r][col]) > Math.abs(aug[pivot][col])) pivot = r;
    }
    if (Math.abs(aug[pivot][col]) < 1e-12) return null;
    [aug[col], aug[pivot]] = [aug[pivot], aug[col]];
    const pv = aug[col][col];
    for (let j = col; j <= n; j++) aug[col][j] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = aug[r][col];
      for (let j = col; j <= n; j++) aug[r][j] -= factor * aug[col][j];
    }
  }
  return [1, 0, 0, 0, 1, 0, 0, 0, 1].map((v, i) => (i < 8 ? aug[i][8] : v));
}

/**
 * Warp a source region (given as an ordered quad) into a square ImageData of
 * `size` x `size` with a white quiet-zone border.
 *
 * @param {ImageData} src Full image containing the QR code.
 * @param {number[][]} quad Ordered [TL, TR, BR, BL] corners (original-image space).
 * @param {number} size Canonical square size (e.g. 520).
 * @param {number} [expansion=0] Grow the quad outward around its centroid.
 * @returns {ImageData}
 */
export function warpQuad(src, quad, size, expansion = 0) {
  const { width, height } = src;
  const q = orderQuad(quad);
  if (expansion) {
    const cx = q.reduce((s, p) => s + p[0], 0) / 4;
    const cy = q.reduce((s, p) => s + p[1], 0) / 4;
    for (const p of q) {
      p[0] = cx + (p[0] - cx) * (1 + expansion);
      p[1] = cy + (p[1] - cy) * (1 + expansion);
    }
  }

  const pad = Math.round(size * 0.1);
  const outSize = size + pad * 2;
  const dstQuad = [
    [0, 0],
    [size - 1, 0],
    [size - 1, size - 1],
    [0, size - 1],
  ];

  // We need the inverse mapping (destination -> source). Compute src->dst then
  // invert numerically is fiddly; instead build the forward matrix and invert it
  // symbolically below via cofactors.
  const H = perspectiveTransform(q, dstQuad);
  if (!H) return null;

  // Inverse of the 3x3 H (up to scale; i is normalized to 1 already).
  const a = H[0]; const b2 = H[1]; const c = H[2];
  const d = H[3]; const e = H[4]; const f = H[5];
  const g = H[6]; const hh = H[7]; const i = H[8];
  const det = a * (e * i - f * hh) - b2 * (d * i - f * g) + c * (d * hh - e * g);
  if (Math.abs(det) < 1e-12) return null;
  const inv = [
    (e * i - f * hh) / det, (c * hh - b2 * i) / det, (b2 * f - c * e) / det,
    (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det,
    (d * hh - e * g) / det, (b2 * g - a * hh) / det, (a * e - b2 * d) / det,
  ];
  const ia = inv[0]; const ib = inv[1]; const ic = inv[2];
  const idd = inv[3]; const ie = inv[4]; const iff = inv[5];
  const ig = inv[6]; const ih = inv[7]; const ii = inv[8];

  const out = new Uint8ClampedArray(outSize * outSize * 4);
  // White background first (quiet zone).
  for (let i = 0; i < out.length; i += 4) {
    out[i] = 255;
    out[i + 1] = 255;
    out[i + 2] = 255;
    out[i + 3] = 255;
  }

  for (let y = 0; y < outSize; y++) {
    // Map the padded output pixel back into the unpadded canonical square, then to source.
    const py = y - pad;
    for (let x = 0; x < outSize; x++) {
      const px = x - pad;
      const denom = ig * px + ih * py + ii;
      if (Math.abs(denom) < 1e-9) continue;
      const sx = (ia * px + ib * py + ic) / denom;
      const sy = (idd * px + ie * py + iff) / denom;
      if (sx < 0 || sy < 0 || sx > width - 1 || sy > height - 1) continue;
      // Bilinear sample.
      const x0 = Math.min(width - 1, Math.max(0, Math.floor(sx)));
      const x1 = Math.min(width - 1, x0 + 1);
      const y0 = Math.min(height - 1, Math.max(0, Math.floor(sy)));
      const y1 = Math.min(height - 1, y0 + 1);
      const wx = sx - x0;
      const wy = sy - y0;
      const oi = (y * outSize + x) * 4;
      for (let c = 0; c < 4; c++) {
        const p00 = src.data[(y0 * width + x0) * 4 + c];
        const p01 = src.data[(y0 * width + x1) * 4 + c];
        const p10 = src.data[(y1 * width + x0) * 4 + c];
        const p11 = src.data[(y1 * width + x1) * 4 + c];
        const top = p00 + (p01 - p00) * wx;
        const bottom = p10 + (p11 - p10) * wx;
        out[oi + c] = top + (bottom - top) * wy;
      }
    }
  }

  return { data: out, width: outSize, height: outSize };
}

/**
 * Generate perspective-corrected variants for a full image. The reference tool
 * decodes multiple canonical sizes (520/650/780) with a few outward expansions;
 * here we run a couple of representative sizes in lazy order (cheap-ish only in
 * the aggressive tier).
 *
 * @param {ImageData} imageData
 * @returns {{ data: ImageData, label: string }[]}
 */
export function generatePerspectiveVariants(imageData, opts = {}) {
  const { sizes = [520, 650], expansions = [0, 0.03] } = opts;
  const quads = findQRQuads(imageData);
  const results = [];
  let idx = 0;
  for (const { quad } of quads.slice(0, 6)) {
    for (const size of sizes) {
      for (const expansion of expansions) {
        const warped = warpQuad(imageData, quad, size, expansion);
        if (!warped) continue;
        results.push({
          data: warped,
          label: `perspective-q${idx}-${size}-e${expansion}`,
        });
        idx++;
        if (results.length >= 12) break;
      }
      if (results.length >= 12) break;
    }
  }
  return results;
}

/**
 * Generate CLAHE-enhanced variants for a full image.
 *
 * @param {ImageData} imageData
 * @returns {{ data: ImageData, label: string }[]}
 */
export function generateCLAHEVariants(imageData) {
  const { width, height } = imageData;
  const gray = toGray(imageData);
  const red = redChannel(imageData);
  const claheGray = toCLAHE(gray, width, height);
  const claheRed = toCLAHE(red, width, height);
  const variants = [];
  variants.push({ data: grayToImageData(claheGray, width, height), label: 'clahe-gray' });
  variants.push({ data: grayToImageData(claheRed, width, height), label: 'clahe-red' });
  return variants;
}
