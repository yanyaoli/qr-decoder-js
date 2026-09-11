// Main decoding pipeline: high-performance decoding using zxing-wasm
// with robust multi-channel (blue/red/contrast), edge sharpening, CLAHE, tilt shear compensation,
// center-zoom for distant codes, and universal multi-encoding detection.

import { readBarcodesFromImageData } from './wasm-loader';
import {
  generatePreprocessVariants,
  sharpenImageData,
  generateCLAHEVariants,
  generateShearVariants,
  centerCrop,
  addQuietZone,
  generateInvertedVariant,
  generateDotMatrixFixVariants,
  toGray,
  toOtsuBinary,
  toAdaptiveBinary,
  grayToImageData,
} from './preprocess';
import { decodeWithFallback } from './encoding';

const DEFAULT_READER_OPTIONS = {
  formats: ['QRCode'],
  tryRotate: true,
  tryInvert: true,
  tryHarder: true,
  tryDownscale: true,
  tryDenoise: true,
  maxNumberOfSymbols: 1,
};

const MODES = ['fast', 'balanced', 'aggressive'];

/**
 * Decode a QR code from ImageData using zxing-wasm.
 *
 * @param {ImageData} imageData
 * @param {object} [options]
 * @param {'fast'|'balanced'|'aggressive'} [options.mode='aggressive']
 *   - fast: original only;
 *   - balanced: original + contrast-stretched red/blue-enhanced + sharpen + CLAHE + fast tilt shear + center-zoom;
 *   - aggressive: balanced + full 6-angle shear + color-aware quiet-zone, morphology,
 *     Otsu, adaptive-binary, and inverted variants.
 * @returns {Promise<import('../types').DecodeResult>}
 */
export async function decodeQRImageData(imageData, options = {}) {
  if (
    !imageData ||
    typeof imageData.width !== 'number' ||
    typeof imageData.height !== 'number' ||
    !imageData.data
  ) {
    return { success: false, error: 'Invalid image data (expected ImageData or {width,height,data})' };
  }

  const { mode = 'aggressive', ...zxingOptions } = options;
  const effectiveMode = MODES.includes(mode) ? mode : 'balanced';
  const readerOptions = { ...DEFAULT_READER_OPTIONS, ...zxingOptions };

  const attempts = buildDecodeAttempts(imageData, effectiveMode);

  let rawBytes = null;
  let successVersion = null;

  for (const ver of attempts) {
    let results;
    try {
      results = await readBarcodesFromImageData(ver.data, readerOptions);
    } catch (e) {
      console.warn(`Preprocess version "${ver.label}" decode failed:`, e);
      continue;
    }

    if (results && results.length > 0) {
      const hit =
        results.find((r) => r && r.isValid && r.bytes && r.bytes.length) || results[0];
      if (hit && hit.bytes && hit.bytes.length) {
        rawBytes = new Uint8Array(hit.bytes);
        successVersion = ver.label;
        break;
      }
    }
  }

  if (!rawBytes) {
    return { success: false, error: 'No QR code found in the image' };
  }

  // Multi-encoding fallback decoding using universal native TextDecoder and heuristic scoring
  const result = decodeWithFallback(rawBytes);

  return {
    success: true,
    text: result.text,
    encoding: result.encoding,
    detectedEncoding: result.encoding,
    version: successVersion,
  };
}

/**
 * Build an ordered list of decode attempts lazily.
 *
 * @param {ImageData} imageData
 * @param {'fast'|'balanced'|'aggressive'} mode
 * @yields {{ data: ImageData, label: string }}
 */
function* buildDecodeAttempts(imageData, mode = 'balanced') {
  const { width, height } = imageData;

  // Stage 1: original (covers standard B&W QR codes in single pass)
  yield { data: imageData, label: 'original' };
  if (mode === 'fast') return;

  // Stage 2: high-efficiency color/blue-ink rescue channels (contrast-stretched 2*R-B and red-channel)
  const preprocessVariants = generatePreprocessVariants(imageData);
  for (const variant of preprocessVariants) {
    yield { data: variant.data, label: variant.label };
  }

  // Stage 3: Sharpened red channel (directly restores blurry, out-of-focus, or distant blue QR codes)
  const redVariant = preprocessVariants[0]; // red-stretched
  if (redVariant) {
    yield {
      data: sharpenImageData(redVariant.data, 1.2),
      label: 'sharpen-red',
    };
  }

  // Stage 4: CLAHE (local-contrast enhancement: directly rescues faint, shadow-covered, or unevenly lit codes)
  for (const variant of generateCLAHEVariants(imageData)) {
    yield { data: variant.data, label: variant.label };
  }

  // Stage 5: Fast Tilt / Perspective Shear on red-channel (primary pitch & yaw tilts)
  // Essential for live camera scanning when phone or target is tilted forward/backward or sideways
  const fastShearAngles = [
    { sx: 0, sy: 0.35, label: 'tilt-pitch-down' },
    { sx: 0, sy: -0.35, label: 'tilt-pitch-up' },
    { sx: 0.35, sy: 0, label: 'tilt-yaw-right' },
    { sx: -0.35, sy: 0, label: 'tilt-yaw-left' },
  ];
  for (const variant of generateShearVariants(redVariant ? redVariant.data : imageData, fastShearAngles)) {
    yield { data: variant.data, label: `${variant.label}-red` };
  }

  // Stage 6: Center crop for distant QR codes in large frames (>= 380px)
  if (width >= 380 && height >= 380) {
    const cropped = centerCrop(imageData, 0.6);
    const [croppedRed] = generatePreprocessVariants(cropped);
    if (croppedRed) {
      yield { data: croppedRed.data, label: 'center-crop-red' };
      yield { data: sharpenImageData(croppedRed.data, 1.2), label: 'center-crop-sharpen-red' };
    }
  }

  if (mode === 'balanced') return;

  // Stage 7: Full 6-direction tilt shear on original image
  for (const variant of generateShearVariants(imageData)) {
    yield { data: variant.data, label: variant.label };
  }

  // Stage 8: Pad each color-rescue channel so edge-cropped codes regain a quiet zone.
  const quietZoneSources = [
    { data: imageData, label: 'quiet-zone' },
    ...preprocessVariants.map((variant) => ({
      data: variant.data,
      label: `quiet-zone-${variant.label}`,
    })),
  ];
  for (const source of quietZoneSources) {
    const padded = addQuietZone(source.data);
    if (padded) {
      yield { data: padded, label: source.label };
    }
  }

  // Stage 9: Apply morphology and thresholding to every useful source channel.
  const rescueSources = [
    { data: imageData, label: '' },
    ...preprocessVariants.map((variant) => ({
      data: variant.data,
      label: `${variant.label}-`,
    })),
  ];
  for (const source of rescueSources) {
    for (const variant of generateDotMatrixFixVariants(source.data)) {
      yield { data: variant.data, label: `${source.label}${variant.label}` };
    }
  }

  const binarySources = [
    { data: imageData, label: 'gray' },
    ...preprocessVariants.map((variant) => ({
      data: variant.data,
      label: variant.label,
    })),
  ];
  for (const source of binarySources) {
    const sourceGray = toGray(source.data);
    yield {
      data: grayToImageData(toOtsuBinary(sourceGray, width, height), width, height),
      label: `otsu-binary-${source.label}`,
    };
  }

  for (const source of binarySources) {
    const sourceGray = toGray(source.data);
    yield {
      data: grayToImageData(toAdaptiveBinary(sourceGray, width, height), width, height),
      label: `adaptive-binary-${source.label}`,
    };
  }

  for (const source of binarySources) {
    const inverted = generateInvertedVariant(source.data);
    yield { data: inverted.data, label: `inverted-${source.label}` };
  }
}

/**
 * Decode a QR code from various input types:
 * File, Blob, ImageData, HTMLImageElement, HTMLCanvasElement, or OffscreenCanvas.
 *
 * @param {File|Blob|ImageData|HTMLImageElement|HTMLCanvasElement|OffscreenCanvas} input
 * @param {object} [options]
 * @returns {Promise<import('../types').DecodeResult>}
 */
export async function decodeQRFile(input, options = {}) {
  const imgData = await toImageData(input);
  const effectiveOptions = { mode: 'aggressive', ...options };
  return decodeQRImageData(imgData, effectiveOptions);
}

/** Convert input types into a single ImageData. */
async function toImageData(input) {
  if (typeof ImageData !== 'undefined' && input instanceof ImageData) return input;
  if (
    input &&
    typeof input.width === 'number' &&
    typeof input.height === 'number' &&
    input.data
  ) {
    return input;
  }

  if (typeof HTMLImageElement !== 'undefined' && input instanceof HTMLImageElement) {
    return imageDataFromElement(input);
  }
  if (typeof HTMLCanvasElement !== 'undefined' && input instanceof HTMLCanvasElement) {
    const ctx = input.getContext('2d');
    return ctx.getImageData(0, 0, input.width, input.height);
  }
  if (typeof OffscreenCanvas !== 'undefined' && input instanceof OffscreenCanvas) {
    const ctx = input.getContext('2d');
    return ctx.getImageData(0, 0, input.width, input.height);
  }

  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    return imageDataFromBlob(input);
  }

  throw new TypeError(
    'Unsupported input type; expected File, Blob, ImageData, HTMLImageElement, or Canvas'
  );
}

function imageDataFromElement(img) {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function imageDataFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(imageDataFromElement(img));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image from blob'));
    };
    img.src = url;
  });
}
