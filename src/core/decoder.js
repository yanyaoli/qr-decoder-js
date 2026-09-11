// Main decoding pipeline: high-performance decoding using zxing-wasm
// with targeted color rescue channels and robust universal multi-encoding detection.

import { readBarcodesFromImageData } from './wasm-loader';
import {
  generatePreprocessVariants,
  generateInvertedVariant,
  generateDotMatrixFixVariants,
  toGray,
  toOtsuBinary,
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
 * @param {'fast'|'balanced'|'aggressive'} [options.mode]
 *   - fast: original only (ultra-fast video stream path);
 *   - balanced: original + blue-ink/color rescue (2*R-B) + red channel;
 *   - aggressive: balanced + dot-matrix healing + otsu binary + inverted.
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

  const { mode = 'balanced', ...zxingOptions } = options;
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

  // Stage 2: high-efficiency color/blue-ink rescue channels (2*R-B and red-channel)
  for (const variant of generatePreprocessVariants(imageData)) {
    yield { data: variant.data, label: variant.label };
  }
  if (mode === 'balanced') return;

  // Stage 3: aggressive rescue for difficult cases (dot-matrix pin printer, otsu, inverted)
  for (const variant of generateDotMatrixFixVariants(imageData)) {
    yield { data: variant.data, label: variant.label };
  }

  const gray = toGray(imageData);
  yield {
    data: grayToImageData(toOtsuBinary(gray, width, height), width, height),
    label: 'otsu-binary',
  };

  yield generateInvertedVariant(imageData);
}

/**
 * Decode a QR code from various input types:
 * File, Blob, ImageData, HTMLImageElement, HTMLCanvasElement, or OffscreenCanvas.
 *
 * @param {File|Blob|ImageData|HTMLImageElement|HTMLCanvasElement|OffscreenCanvas} input
 * @param {object} [options]
 * @returns {Promise<import('../types').DecodeResult>}
 */
export async function decodeQRFile(input, options) {
  const imgData = await toImageData(input);
  return decodeQRImageData(imgData, options);
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
