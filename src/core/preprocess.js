// Image preprocessing: multi-channel color rescue, auto-contrast stretching,
// sharpening, CLAHE, center-zoom, Otsu binarization, and perspective tilt shear compensation.
// Rescues colored, blue-ink, low-contrast, blurred, distant, inverted, and tilted QR codes.

// ImageData creation and geometric transforms

/**
 * Safe factory for ImageData or ImageData-compatible pixel container.
 * Compatible with Browser DOM, Web Workers, OffscreenCanvas, and headless environments.
 *
 * @param {number} width
 * @param {number} height
 * @returns {ImageData}
 */
export function createImageData(width, height) {
  if (typeof ImageData !== 'undefined') {
    try {
      return new ImageData(width, height);
    } catch {
      // Fallback below
    }
  }
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    try {
      const c = document.createElement('canvas');
      const ctx = c.getContext('2d');
      if (ctx && typeof ctx.createImageData === 'function') {
        return ctx.createImageData(width, height);
      }
    } catch {
      // Fallback below
    }
  }
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  };
}

/**
 * Create a canvas when a browser or worker canvas API is available.
 * Returns null so callers can use their CPU fallback in headless environments.
 *
 * @param {number} width
 * @param {number} height
 * @returns {HTMLCanvasElement|OffscreenCanvas|null}
 */
function createCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  return null;
}

/**
 * Generate targeted multi-path rescue variants for colored and blue-ink QR codes.
 * Uses dynamic-range contrast stretching to maximize ink/paper gradient.
 *
 * 1. red-stretched: white paper reflects red (bright), blue ink absorbs red (dark).
 * 2. blue-enhanced-stretched: (2*R - B) cuts blue channel contribution entirely.
 *
 * @param {ImageData} imageData
 * @returns {{ data: ImageData, label: string }[]}
 */
export function generatePreprocessVariants(imageData) {
  const { data, width, height } = imageData;
  const n = data.length;

  const red = createImageData(width, height);
  const dRed = red.data;
  const blueEnhanced = createImageData(width, height);
  const dBlueEnhanced = blueEnhanced.data;

  // Pass 1: find min and max for contrast stretching
  let minR = 255, maxR = 0;
  let minDiff = 500, maxDiff = -500;
  const diffs = new Int16Array(width * height);

  for (let i = 0, p = 0; i < n; i += 4, p++) {
    const r = data[i];
    const b = data[i + 2];
    const d = 2 * r - b;
    diffs[p] = d;

    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    if (d < minDiff) minDiff = d;
    if (d > maxDiff) maxDiff = d;
  }

  // Range normalization factor
  const rangeR = maxR - minR > 15 ? maxR - minR : 255;
  const baseR = maxR - minR > 15 ? minR : 0;

  const rangeDiff = maxDiff - minDiff > 15 ? maxDiff - minDiff : 255;
  const baseDiff = maxDiff - minDiff > 15 ? minDiff : 0;

  for (let p = 0, i = 0; i < n; i += 4, p++) {
    const a = data[i + 3] || 255;

    // Variant 1: Stretched Red Channel
    const valR = Math.max(0, Math.min(255, Math.round(((data[i] - baseR) * 255) / rangeR)));
    dRed[i] = valR;
    dRed[i + 1] = valR;
    dRed[i + 2] = valR;
    dRed[i + 3] = a;

    // Variant 2: Stretched Blue-Suppression (2*R - B)
    const valDiff = Math.max(0, Math.min(255, Math.round(((diffs[p] - baseDiff) * 255) / rangeDiff)));
    dBlueEnhanced[i] = valDiff;
    dBlueEnhanced[i + 1] = valDiff;
    dBlueEnhanced[i + 2] = valDiff;
    dBlueEnhanced[i + 3] = a;
  }

  return [
    { data: red, label: 'red-stretched' },
    { data: blueEnhanced, label: 'blue-enhanced' },
  ];
}

// Channel enhancement and local contrast transforms

/**
 * 3x3 Laplacian edge-sharpening (Unsharp Mask) filter.
 * Directly restores blurry, out-of-focus, and low-contrast module transitions.
 *
 * @param {ImageData} imageData
 * @param {number} [amount=1.2]
 * @returns {ImageData}
 */
export function sharpenImageData(imageData, amount = 1.2) {
  const { width, height, data } = imageData;
  const out = createImageData(width, height);
  const oData = out.data;

  for (let y = 0; y < height; y++) {
    const row = y * width;
    const upRow = Math.max(0, y - 1) * width;
    const downRow = Math.min(height - 1, y + 1) * width;
    for (let x = 0; x < width; x++) {
      const idx = (row + x) * 4;
      const c = data[idx];
      const u = data[(upRow + x) * 4];
      const d = data[(downRow + x) * 4];
      const l = data[(row + Math.max(0, x - 1)) * 4];
      const r = data[(row + Math.min(width - 1, x + 1)) * 4];
      const laplacian = 5 * c - u - d - l - r;
      const val = Math.max(0, Math.min(255, Math.round(c * (1 - amount) + laplacian * amount)));
      oData[idx] = val;
      oData[idx + 1] = val;
      oData[idx + 2] = val;
      oData[idx + 3] = data[idx + 3] || 255;
    }
  }

  return out;
}

/**
 * Generate CLAHE (Contrast Limited Adaptive Histogram Equalization) variants.
 * Handles blur, weak focus, shadows, and locally uneven lighting.
 *
 * @param {ImageData} imageData
 * @returns {{ data: ImageData, label: string }[]}
 */
export function generateCLAHEVariants(imageData) {
  const { width, height, data } = imageData;

  // Red plane extraction (ultra effective for faint/blurry blue QR codes)
  const redPlane = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; p < redPlane.length; i += 4, p++) {
    redPlane[p] = data[i];
  }
  const claheRed = toCLAHE(redPlane, width, height, { clipLimit: 2.5, tileSize: 8 });

  // Standard luma plane extraction
  const gray = toGray(imageData);
  const claheGray = toCLAHE(gray, width, height, { clipLimit: 2.5, tileSize: 8 });

  return [
    { data: grayToImageData(claheRed, width, height), label: 'clahe-red' },
    { data: grayToImageData(claheGray, width, height), label: 'clahe-gray' },
  ];
}

/**
 * Extract center crop (e.g. 60% of frame).
 * Fixes distant / small QR codes in large high-resolution frames (e.g. 960px or 1080p).
 * Prevents full-image downscaling from destroying small modules.
 *
 * @param {ImageData} imageData
 * @param {number} [ratio=0.6]
 * @returns {ImageData}
 */
export function centerCrop(imageData, ratio = 0.6) {
  const { width, height, data } = imageData;
  const cropW = Math.round(width * ratio);
  const cropH = Math.round(height * ratio);
  const startX = Math.round((width - cropW) / 2);
  const startY = Math.round((height - cropH) / 2);
  const out = createImageData(cropW, cropH);
  const oData = out.data;

  for (let y = 0; y < cropH; y++) {
    const srcRow = (startY + y) * width;
    const dstRow = y * cropW;
    for (let x = 0; x < cropW; x++) {
      const s = (srcRow + startX + x) * 4;
      const d = (dstRow + x) * 4;
      oData[d] = data[s];
      oData[d + 1] = data[s + 1];
      oData[d + 2] = data[s + 2];
      oData[d + 3] = data[s + 3] || 255;
    }
  }
  return out;
}

/**
 * Perspective shear compensation for tilted/skewed QR codes.
 * Uses fast Canvas 2D GPU transform where available, with fast affine CPU fallback.
 *
 * @param {ImageData} srcImageData
 * @param {Array<{sx: number, sy: number, label: string}>} [shearAngles]
 * @returns {{ data: ImageData, label: string }[]}
 */
export function generateShearVariants(
  srcImageData,
  shearAngles = [
    { sx: 0, sy: 0.35, label: 'tilt-pitch-down' },
    { sx: 0, sy: -0.35, label: 'tilt-pitch-up' },
    { sx: 0.35, sy: 0, label: 'tilt-yaw-right' },
    { sx: -0.35, sy: 0, label: 'tilt-yaw-left' },
    { sx: 0.25, sy: 0.25, label: 'tilt-diagonal' },
    { sx: -0.25, sy: -0.25, label: 'tilt-diagonal-rev' },
  ]
) {
  const { width, height, data } = srcImageData;
  const source = createCanvas(width, height);

  if (source) {
    const sourceCtx = source.getContext('2d');
    if (sourceCtx) {
      sourceCtx.putImageData(srcImageData, 0, 0);

      const pad = Math.round(Math.max(width, height) * 0.2);
      const outW = width + pad * 2;
      const outH = height + pad * 2;
      const out = createCanvas(outW, outH);
      if (out) {
        const ctx = out.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          const variants = [];
          for (const { sx, sy, label } of shearAngles) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, outW, outH);

            ctx.translate(outW / 2, outH / 2);
            ctx.transform(1, sy, sx, 1, 0, 0);
            ctx.drawImage(source, -width / 2, -height / 2);

            variants.push({
              data: ctx.getImageData(0, 0, outW, outH),
              label: `shear-${label}`,
            });
          }
          return variants;
        }
      }
    }
  }

  // CPU fallback when Canvas is unavailable
  const variants = [];
  for (const { sx, sy, label } of shearAngles) {
    const padX = Math.round(height * Math.abs(sx) * 0.6 + 10);
    const padY = Math.round(width * Math.abs(sy) * 0.6 + 10);
    const outW = width + padX * 2;
    const outH = height + padY * 2;
    const out = createImageData(outW, outH);
    const oData = out.data;
    oData.fill(255);

    const cx = width / 2;
    const cy = height / 2;
    const ocx = outW / 2;
    const ocy = outH / 2;
    const det = 1 - sx * sy;
    if (Math.abs(det) < 0.001) continue;

    for (let dy = 0; dy < outH; dy++) {
      const yOff = dy - ocy;
      for (let dx = 0; dx < outW; dx++) {
        const xOff = dx - ocx;
        const srcX = Math.round((xOff - sx * yOff) / det + cx);
        const srcY = Math.round((-sy * xOff + yOff) / det + cy);

        if (srcX >= 0 && srcX < width && srcY >= 0 && srcY < height) {
          const s = (srcY * width + srcX) * 4;
          const d = (dy * outW + dx) * 4;
          oData[d] = data[s];
          oData[d + 1] = data[s + 1];
          oData[d + 2] = data[s + 2];
          oData[d + 3] = 255;
        }
      }
    }
    variants.push({ data: out, label: `shear-${label}` });
  }

  return variants;
}

// Quiet-zone, inversion, and binary repair transforms

/**
 * Pad an image with a clean white quiet zone border.
 * Fixes edge-cropped QR codes that lack surrounding quiet zone.
 *
 * @param {ImageData} imageData
 * @param {number} [borderRatio=0.15]
 * @returns {ImageData|null}
 */
export function addQuietZone(imageData, borderRatio = 0.15) {
  const { width, height, data } = imageData;
  const pad = Math.max(24, Math.round(Math.min(width, height) * borderRatio));
  const outW = width + pad * 2;
  const outH = height + pad * 2;

  const out = createImageData(outW, outH);
  const oData = out.data;
  oData.fill(255); // White border

  for (let y = 0; y < height; y++) {
    const srcRow = y * width * 4;
    const dstRow = ((y + pad) * outW + pad) * 4;
    for (let i = 0; i < width * 4; i++) {
      oData[dstRow + i] = data[srcRow + i];
    }
  }

  return out;
}

/**
 * Generate inverted luma variant for light-on-dark (inverted) QR codes.
 *
 * @param {ImageData} imageData
 * @returns {{ data: ImageData, label: string }}
 */
export function generateInvertedVariant(imageData) {
  const { data, width, height } = imageData;
  const inv = createImageData(width, height);
  const dInv = inv.data;
  const n = data.length;

  for (let i = 0; i < n; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    const luma = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    const invLuma = 255 - luma;

    dInv[i] = invLuma;
    dInv[i + 1] = invLuma;
    dInv[i + 2] = invLuma;
    dInv[i + 3] = a;
  }

  return { data: inv, label: 'inverted' };
}

/**
 * Lightweight 3x3 morphological closing to heal broken dot-matrix / pin-printer dots.
 *
 * @param {ImageData} imageData
 * @param {number} [threshold=135]
 * @returns {{ data: ImageData, label: string }[]}
 */
export function generateDotMatrixFixVariants(imageData, threshold = 135) {
  const { data, width, height } = imageData;
  const size = width * height;
  const dark = new Uint8Array(size);

  for (let i = 0, p = 0; p < size; i += 4, p++) {
    const lum = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
    dark[p] = lum < threshold ? 1 : 0;
  }

  const dilated = new Uint8Array(size);
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const idx = row + x;
      dilated[idx] =
        dark[idx] |
        dark[idx - 1] |
        dark[idx + 1] |
        dark[idx - width] |
        dark[idx + width];
    }
  }

  const closed = new Uint8Array(size);
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const idx = row + x;
      closed[idx] =
        dilated[idx] &
        dilated[idx - 1] &
        dilated[idx + 1] &
        dilated[idx - width] &
        dilated[idx + width];
    }
  }

  const out = createImageData(width, height);
  const outData = out.data;
  for (let p = 0, i = 0; p < size; p++, i += 4) {
    const val = closed[p] ? 0 : 255;
    outData[i] = val;
    outData[i + 1] = val;
    outData[i + 2] = val;
    outData[i + 3] = 255;
  }

  return [{ data: out, label: 'dot-matrix-healed' }];
}

/**
 * Standard grayscale conversion.
 *
 * @param {ImageData} imgData
 * @returns {Uint8ClampedArray}
 */
export function toGray(imgData) {
  const { data, width, height } = imgData;
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }
  return gray;
}

/**
 * Convert a 1-channel grayscale byte plane back to an RGBA ImageData.
 *
 * @param {Uint8ClampedArray} gray
 * @param {number} width
 * @param {number} height
 * @returns {ImageData}
 */
export function grayToImageData(gray, width, height) {
  const imgData = createImageData(width, height);
  const rgba = imgData.data;
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
    const val = gray[i];
    rgba[j] = val;
    rgba[j + 1] = val;
    rgba[j + 2] = val;
    rgba[j + 3] = 255;
  }
  return imgData;
}

/**
 * Otsu global thresholding binarization.
 *
 * @param {Uint8ClampedArray} gray
 * @param {number} width
 * @param {number} height
 * @returns {Uint8ClampedArray}
 */
export function toOtsuBinary(gray, width, height) {
  const total = gray.length;
  const hist = new Int32Array(256);
  for (let i = 0; i < total; i++) hist[gray[i]]++;

  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];

  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let thr = 127;

  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) {
      maxVar = between;
      thr = t;
    }
  }

  const bin = new Uint8ClampedArray(total);
  for (let i = 0; i < total; i++) {
    bin[i] = gray[i] > thr ? 255 : 0;
  }
  return bin;
}

/**
 * Local adaptive thresholding for unevenly lit or low-contrast QR images.
 * Uses an integral image so the per-pixel neighborhood mean stays linear-time.
 *
 * @param {Uint8ClampedArray} gray
 * @param {number} width
 * @param {number} height
 * @param {number} [radius=8]
 * @param {number} [bias=0.15]
 * @returns {Uint8ClampedArray}
 */
export function toAdaptiveBinary(gray, width, height, radius = 8, bias = 0.15) {
  const stride = width + 1;
  const integral = new Int32Array((width + 1) * (height + 1));
  const out = new Uint8ClampedArray(gray.length);

  for (let y = 1; y <= height; y++) {
    let rowSum = 0;
    const sourceRow = (y - 1) * width;
    const integralRow = y * stride;
    const previousRow = (y - 1) * stride;
    for (let x = 1; x <= width; x++) {
      rowSum += gray[sourceRow + x - 1];
      integral[integralRow + x] = integral[previousRow + x] + rowSum;
    }
  }

  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    const top = y0 * stride;
    const bottom = (y1 + 1) * stride;
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum =
        integral[bottom + x1 + 1] -
        integral[top + x1 + 1] -
        integral[bottom + x0] +
        integral[top + x0];
      const threshold = (sum / area) * (1 - bias);
      out[y * width + x] = gray[y * width + x] <= threshold ? 0 : 255;
    }
  }

  return out;
}

/**
 * CLAHE (Contrast Limited Adaptive Histogram Equalization) on a grayscale plane.
 * Directly fixes blurred, poorly focused, or unevenly lit QR codes.
 *
 * @param {Uint8ClampedArray} gray
 * @param {number} width
 * @param {number} height
 * @param {object} [opts]
 * @returns {Uint8ClampedArray}
 */
export function toCLAHE(gray, width, height, opts = {}) {
  const { clipLimit = 2.5, tileSize = 8 } = opts;

  const out = new Uint8ClampedArray(gray.length);
  const maps = [];

  for (let ty = 0; ty < tileSize; ty++) {
    for (let tx = 0; tx < tileSize; tx++) {
      const hist = new Int32Array(256);
      const x0 = Math.floor((tx * width) / tileSize);
      const x1 = Math.floor(((tx + 1) * width) / tileSize);
      const y0 = Math.floor((ty * height) / tileSize);
      const y1 = Math.floor(((ty + 1) * height) / tileSize);
      // clipLimit is normalized against the 256-bin histogram of this tile.
      const tileArea = (x1 - x0) * (y1 - y0);
      const clip = Math.max(1, Math.round((clipLimit * tileArea) / 256));
      for (let y = y0; y < y1; y++) {
        const row = y * width;
        for (let x = x0; x < x1; x++) {
          hist[gray[row + x]]++;
        }
      }

      let excess = 0;
      for (let i = 0; i < 256; i++) {
        if (hist[i] > clip) {
          excess += hist[i] - clip;
          hist[i] = clip;
        }
      }
      const bonus = Math.floor(excess / 256);
      let rem = excess - bonus * 256;
      for (let i = 0; i < 256; i++) hist[i] += bonus;
      for (let i = 0; i < 256 && rem > 0; i++, rem--) hist[i] += 1;

      const total = (x1 - x0) * (y1 - y0) || 1;
      let sum = 0;
      const map = new Uint8ClampedArray(256);
      for (let i = 0; i < 256; i++) {
        sum += hist[i];
        map[i] = Math.round((sum * 255) / total);
      }
      maps.push(map);
    }
  }

  for (let y = 0; y < height; y++) {
    const fy = ((y + 0.5) / height) * tileSize - 0.5;
    const ty0 = Math.max(0, Math.min(tileSize - 1, Math.floor(fy)));
    const ty1 = Math.max(0, Math.min(tileSize - 1, ty0 + 1));
    const wy = Math.max(0, Math.min(1, fy - ty0));
    for (let x = 0; x < width; x++) {
      const fx = ((x + 0.5) / width) * tileSize - 0.5;
      const tx0 = Math.max(0, Math.min(tileSize - 1, Math.floor(fx)));
      const tx1 = Math.max(0, Math.min(tileSize - 1, tx0 + 1));
      const wx = Math.max(0, Math.min(1, fx - tx0));

      const v = gray[y * width + x];
      const m00 = maps[ty0 * tileSize + tx0][v];
      const m01 = maps[ty0 * tileSize + tx1][v];
      const m10 = maps[ty1 * tileSize + tx0][v];
      const m11 = maps[ty1 * tileSize + tx1][v];
      const top = m00 + (m01 - m00) * wx;
      const bottom = m10 + (m11 - m10) * wx;
      out[y * width + x] = top + (bottom - top) * wy;
    }
  }

  return out;
}
