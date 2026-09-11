// Image preprocessing: focused high-efficiency channel variants to rescue
// colored, blue-ink, low-contrast, and inverted QR codes.

/**
 * Generate targeted multi-path rescue variants.
 *
 * 1. red-channel: white background reflects red (high), blue ink absorbs red (low).
 * 2. blue-enhanced (2*R - B): pushes white to 255 and blue ink to 0, maximizing contrast.
 *
 * @param {ImageData} imageData
 * @returns {{ data: ImageData, label: string }[]}
 */
export function generatePreprocessVariants(imageData) {
  const { data, width, height } = imageData;
  const n = data.length;

  const red = new ImageData(width, height);
  const dRed = red.data;
  const blueEnhanced = new ImageData(width, height);
  const dBlueEnhanced = blueEnhanced.data;

  for (let i = 0; i < n; i += 4) {
    const r = data[i];
    const b = data[i + 2];
    const a = data[i + 3];

    // Variant 1: pure red channel as grayscale
    dRed[i] = r;
    dRed[i + 1] = r;
    dRed[i + 2] = r;
    dRed[i + 3] = a;

    // Variant 2: red/blue difference enhancement (2*R - B)
    const val = Math.min(255, Math.max(0, 2 * r - b));
    dBlueEnhanced[i] = val;
    dBlueEnhanced[i + 1] = val;
    dBlueEnhanced[i + 2] = val;
    dBlueEnhanced[i + 3] = a;
  }

  return [
    { data: blueEnhanced, label: 'blue-enhanced' },
    { data: red, label: 'red-channel' },
  ];
}

/**
 * Generate inverted luma variant for light-on-dark (inverted) QR codes.
 *
 * @param {ImageData} imageData
 * @returns {{ data: ImageData, label: string }}
 */
export function generateInvertedVariant(imageData) {
  const { data, width, height } = imageData;
  const inv = new ImageData(width, height);
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

  const out = new ImageData(width, height);
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
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
    const val = gray[i];
    rgba[j] = val;
    rgba[j + 1] = val;
    rgba[j + 2] = val;
    rgba[j + 3] = 255;
  }
  return new ImageData(rgba, width, height);
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
