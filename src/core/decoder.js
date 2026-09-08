// Main decoding pipeline: multi-channel preprocessing to locate the QR code,
// extraction of the raw bytes, then encoding detection with fallback decoding.

import { readBarcodesFromImageData, detectEncoding } from './wasm-loader';
import { preprocessImageData } from './preprocess';
import { decodeWithFallback, normalizeEncoding } from './encoding';

const DEFAULT_READER_OPTIONS = {
  formats: ['QRCode'],
  tryRotate: true,
  tryInvert: true,
  tryHarder: true,
  tryDownscale: true,
  tryDenoise: true,
  maxNumberOfSymbols: 1,
};

/**
 * Decode a QR code from ImageData.
 *
 * @param {ImageData} imageData
 * @param {object} [options] ReaderOptions passed through to zxing (formats/tryHarder/...)
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

  const readerOptions = { ...DEFAULT_READER_OPTIONS, ...options };

  // 1. Preprocess into several channel versions and try to decode each one.
  const versions = preprocessImageData(imageData);

  let rawBytes = null;
  let successVersion = null;
  for (const ver of versions) {
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
        // Copy into an independent Uint8Array instead of holding a wasm memory view.
        rawBytes = new Uint8Array(hit.bytes);
        successVersion = ver.label;
        break;
      }
    }
  }

  if (!rawBytes) {
    return { success: false, error: 'No QR code found in the image' };
  }

  // 2. Encoding detection (ced-wasm), defaulting to UTF-8 on failure.
  let detectedEncoding = 'utf-8';
  let rawDetected = null;
  try {
    rawDetected = await detectEncoding(rawBytes);
    if (rawDetected) detectedEncoding = normalizeEncoding(rawDetected);
  } catch (e) {
    console.warn('Encoding detection failed, falling back to utf-8', e);
  }

  // 3. Multi-encoding fallback decoding.
  const result = decodeWithFallback(rawBytes, detectedEncoding);
  if (result.score < 0) {
    // All candidates scored poorly (e.g. pure ASCII / very short content).
    // Force decoding as UTF-8.
    const text = new TextDecoder('utf-8').decode(rawBytes);
    return {
      success: true,
      text,
      encoding: 'utf-8',
      detectedEncoding: rawDetected,
      version: successVersion,
    };
  }

  return {
    success: true,
    text: result.text,
    encoding: result.encoding,
    detectedEncoding: rawDetected,
    version: successVersion,
  };
}

/**
 * Decode a QR code from a File / Blob / HTMLImageElement / HTMLCanvasElement.
 *
 * @param {File|Blob|HTMLImageElement|HTMLCanvasElement} input
 * @param {object} [options]
 * @returns {Promise<import('../types').DecodeResult>}
 */
export async function decodeQRFile(input, options = {}) {
  if (!input) {
    return { success: false, error: 'No image provided' };
  }

  const imageData = await toImageData(input);
  return decodeQRImageData(imageData, options);
}

/** Convert several input types into a single ImageData. */
async function toImageData(input) {
  // Already an ImageData / {width,height,data}
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

  // Blob / File
  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    return imageDataFromBlob(input);
  }

  throw new TypeError(
    'Unsupported input type; expected File, Blob, ImageData or HTMLImageElement'
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
      reject(new Error('Failed to load the image'));
    };
    img.src = url;
  });
}
