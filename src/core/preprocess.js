// Image preprocessing: produce several channel versions to improve the detection
// rate for colored / light-colored QR codes.

/**
 * Generate several preprocessing versions:
 *   original - as-is
 *   blue     - blue channel (friendly to blue QR codes)
 *   green    - green channel
 *   red      - red channel
 *   gray     - standard luma (Rec.601 coefficients)
 *   inverted - inverted luma (light / inverted codes)
 *
 * @param {ImageData} imageData
 * @returns {{ data: ImageData, label: string }[]}
 */
export function preprocessImageData(imageData) {
  const { width, height } = imageData;
  const src = imageData.data;
  const n = src.length;
  const versions = [];

  versions.push({ data: imageData, label: 'original' });

  const blue = new ImageData(width, height);
  const dBlue = blue.data;
  const green = new ImageData(width, height);
  const dGreen = green.data;
  const red = new ImageData(width, height);
  const dRed = red.data;
  const gray = new ImageData(width, height);
  const dGray = gray.data;
  const inv = new ImageData(width, height);
  const dInv = inv.data;

  for (let i = 0; i < n; i += 4) {
    const r = src[i];
    const g = src[i + 1];
    const b = src[i + 2];

    dBlue[i] = b;
    dBlue[i + 1] = b;
    dBlue[i + 2] = b;
    dBlue[i + 3] = 255;

    dGreen[i] = g;
    dGreen[i + 1] = g;
    dGreen[i + 2] = g;
    dGreen[i + 3] = 255;

    dRed[i] = r;
    dRed[i + 1] = r;
    dRed[i + 2] = r;
    dRed[i + 3] = 255;

    const luma = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    dGray[i] = luma;
    dGray[i + 1] = luma;
    dGray[i + 2] = luma;
    dGray[i + 3] = 255;

    const invLuma = 255 - luma;
    dInv[i] = invLuma;
    dInv[i + 1] = invLuma;
    dInv[i + 2] = invLuma;
    dInv[i + 3] = 255;
  }

  versions.push({ data: blue, label: 'blue' });
  versions.push({ data: green, label: 'green' });
  versions.push({ data: red, label: 'red' });
  versions.push({ data: gray, label: 'gray' });
  versions.push({ data: inv, label: 'inverted' });

  return versions;
}

/**
 * Generate targeted multi-path rescue variants, tuned for blue-ink and
 * low-contrast QR codes. White backgrounds reflect red light (R stays high,
 * near-white); blue ink absorbs red light (R drops toward black), so pushing
 * the pixels through the red channel alone turns such codes into a high-contrast
 * grayscale. The `2*R - B` difference cuts the blue channel's contribution to
 * brightness out entirely.
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

    // Variant 1: pure red channel as grayscale.
    dRed[i] = r;
    dRed[i + 1] = r;
    dRed[i + 2] = r;
    dRed[i + 3] = a;

    // Variant 2: red/blue difference enhancement (white stays high, blue ink
    // gets pushed down toward 0).
    const val = Math.min(255, Math.max(0, 2 * r - b));
    dBlueEnhanced[i] = val;
    dBlueEnhanced[i + 1] = val;
    dBlueEnhanced[i + 2] = val;
    dBlueEnhanced[i + 3] = a;
  }

  return [
    { data: red, label: 'red-channel' },
    { data: blueEnhanced, label: 'blue-enhanced' },
  ];
}

/**
 * Generate affine shear / perspective-compensation variants for QR codes shot
 * at a steep angle. Heavy perspective or parallelogram skew breaks the fixed
 * 1:1:3:1:1 finder-pattern ratio that ZXing scans for along straight lines;
 * applying a horizontal / vertical shear flattens the code back so the ratio is
 * recoverable again.
 *
 * Each variant is centered before the shear and padded with a generous white
 * quiet-zone border, so the code's outer modules are not clipped afterwards.
 *
 * Requires a 2d canvas (OffscreenCanvas preferred, then document). Returns an
 * empty list when none is available so callers can skip the stage gracefully.
 *
 * @param {ImageData} srcImageData
 * @param {{ sx: number, sy: number }[]} [shearAngles] Shear factor pairs
 *   (equivalent to tan(angle) per axis; sx horizontal, sy vertical).
 * @returns {{ data: ImageData, label: string }[]}
 */
export function generateShearVariants(
  srcImageData,
  shearAngles = [
    { sx: 0.35, sy: 0 }, // horizontal forward shear (right-side tilt)
    { sx: -0.35, sy: 0 }, // horizontal backward shear (left-side tilt)
    { sx: 0, sy: 0.35 }, // vertical forward shear (pitch up)
    { sx: 0, sy: -0.35 }, // vertical backward shear (pitch down)
    { sx: 0.25, sy: 0.25 }, // diagonal distortion
    { sx: -0.25, sy: -0.25 },
  ]
) {
  const { width, height } = srcImageData;
  const source = createCanvas(width, height);
  if (!source) return [];
  const sourceCtx = source.getContext('2d');
  if (!sourceCtx) return [];
  sourceCtx.putImageData(srcImageData, 0, 0);

  // Enlarge the output canvas to hold the sheared image plus a quiet-zone border.
  const pad = Math.round(Math.max(width, height) * 0.25);
  const outW = width + pad * 2;
  const outH = height + pad * 2;
  const out = createCanvas(outW, outH);
  if (!out) return [];
  const ctx = out.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];

  const variants = [];
  for (const { sx, sy } of shearAngles) {
    // Reset and paint a pure-white background.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, outW, outH);

    // Shear around the output center, then drop the image in.
    ctx.translate(outW / 2, outH / 2);
    ctx.transform(1, sy, sx, 1, 0, 0);
    ctx.drawImage(source, -width / 2, -height / 2);

    variants.push({
      data: ctx.getImageData(0, 0, outW, outH),
      label: `shear-sx${sx}-sy${sy}`,
    });
  }
  return variants;
}

/** Create a 2d-capable canvas, preferring OffscreenCanvas outside of documents. */
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
 * 3x3 morphological closing for dot-matrix / pin-printer artifacts. The operator
 * is applied on grayscale values where dark module pixels are low (near 0):
 *   - dilation takes the 3x3 neighborhood minimum, which expands dark ink and
 *     bridges horizontally/vertically broken printer dots;
 *   - erosion then takes the neighborhood maximum, restoring the original size.
 * The image border is copied through untouched so no black rim is introduced.
 *
 * @param {Uint8ClampedArray} grayArray
 * @param {number} width
 * @param {number} height
 * @returns {Uint8ClampedArray}
 */
function morphologicalClose(grayArray, width, height) {
  const size = width * height;
  const dilated = new Uint8ClampedArray(size);
  const closed = new Uint8ClampedArray(size);

  for (let y = 1; y < height - 1; y++) {
    const rowOffset = y * width;
    for (let x = 1; x < width - 1; x++) {
      let minVal = 255;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const val = grayArray[rowOffset + dy * width + (x + dx)];
          if (val < minVal) minVal = val;
        }
      }
      dilated[rowOffset + x] = minVal;
    }
  }

  for (let y = 1; y < height - 1; y++) {
    const rowOffset = y * width;
    for (let x = 1; x < width - 1; x++) {
      let maxVal = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const val = dilated[rowOffset + dy * width + (x + dx)];
          if (val > maxVal) maxVal = val;
        }
      }
      closed[rowOffset + x] = maxVal;
    }
  }

  // Carry the border over instead of leaving it black (0).
  for (let x = 0; x < width; x++) {
    closed[x] = grayArray[x];
    closed[(height - 1) * width + x] = grayArray[(height - 1) * width + x];
  }
  for (let y = 0; y < height; y++) {
    closed[y * width] = grayArray[y * width];
    closed[y * width + width - 1] = grayArray[y * width + width - 1];
  }

  return closed;
}

/**
 * Generate rescue variants for dot-matrix / pin-printer blue QR codes. Such codes
 * suffer from broken printer dots and white fly-speck gaps that break the finder
 * pattern; combining the red channel (strongest contrast against blue ink) with a
 * morphological close stitches the fragments back together.
 *
 * Two outputs are produced:
 *   dot-matrix-healed-gray - smoothed grayscale after closing;
 *   dot-matrix-binary     - hard-thresholded (fully black/white) version.
 *
 * @param {ImageData} imageData
 * @param {number} [threshold] Binarization level (Otsu for blue dot-matrix codes
 *   usually lands around 120-140).
 * @returns {{ data: ImageData, label: string }[]}
 */
export function generateDotMatrixFixVariants(imageData, threshold = 135) {
  const { data, width, height } = imageData;
  const total = width * height;
  const redGray = new Uint8ClampedArray(total);

  // 1. Red channel: strongest contrast against blue ink.
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    redGray[j] = data[i];
  }

  // 2. Min-Max contrast stretch.
  let min = 255;
  let max = 0;
  for (let i = 0; i < total; i++) {
    if (redGray[i] < min) min = redGray[i];
    if (redGray[i] > max) max = redGray[i];
  }
  const range = Math.max(1, max - min);
  for (let i = 0; i < total; i++) {
    redGray[i] = ((redGray[i] - min) / range) * 255;
  }

  // 3. Morphological close to stitch broken horizontal/vertical lines.
  const healedGray = morphologicalClose(redGray, width, height);

  // 4. Pack results back into RGBA ImageData for zxing.
  const out1 = new Uint8ClampedArray(data.length);
  const out2 = new Uint8ClampedArray(data.length);

  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const g = healedGray[j];
    out1[i] = g;
    out1[i + 1] = g;
    out1[i + 2] = g;
    out1[i + 3] = 255;

    const b = healedGray[j] < threshold ? 0 : 255;
    out2[i] = b;
    out2[i + 1] = b;
    out2[i + 2] = b;
    out2[i + 3] = 255;
  }

  return [
    { data: new ImageData(out1, width, height), label: 'dot-matrix-healed-gray' },
    { data: new ImageData(out2, width, height), label: 'dot-matrix-binary' },
  ];
}
