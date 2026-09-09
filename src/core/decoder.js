// Main decoding pipeline: multi-channel preprocessing to locate the QR code,
// extraction of the raw bytes, then encoding detection with fallback decoding.

import { readBarcodesFromImageData, detectEncoding } from './wasm-loader';
import {
  preprocessImageData,
  generatePreprocessVariants,
  generateShearVariants,
  generateDotMatrixFixVariants,
  toGray,
  toOtsuBinary,
  grayToImageData,
} from './preprocess';
import { decodeWithFallback, normalizeEncoding } from './encoding';
import { generateCLAHEVariants, generatePerspectiveVariants } from './perspective';

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
 * Decode a QR code from ImageData.
 *
 * @param {ImageData} imageData
 * @param {object} [options] ReaderOptions passed through to zxing (formats/tryHarder/...)
 *   plus the decoder-level `mode` selector.
 * @param {'fast'|'balanced'|'aggressive'} [options.mode] Controls how many rescue
 *   attempts run after the original image fails:
 *   - fast      - original only (video frames; lowest latency);
 *   - balanced  - original + channel/color rescue (grayscale, Otsu, red/2R-B,
 *                 dot-matrix); no canvas transforms;
 *   - aggressive - everything incl. quiet-zone padding and shear compensation
 *                 (single stills / hardest cases). Default.
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
  const effectiveMode = MODES.includes(mode) ? mode : 'aggressive';
  const readerOptions = { ...DEFAULT_READER_OPTIONS, ...zxingOptions };

  // 1. Build the ordered list of decode attempts:
  //    - original image first (fast path for normal QR codes);
  //    - channel-preprocessed variants (colored / light-colored codes);
  //    - quiet-zone / padded variants as a last resort (edge-cropped codes).
  //    Candidates are produced lazily so a success on an early stage skips the
  //    remaining (and more expensive) attempts.
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
 * Build the ordered list of decode attempts (lazily, so a fast success on an
 * early stage skips the remaining work). Depth follows `mode`:
 *
 *   fast
 *     Stage 1 - original (video frames: zero extra operators)
 *   balanced
 *     Stage 1 - original
 *     Stage 2 - dot-matrix / pin-printer rescue (red + morphological close)
 *     Stage 3 - channel rescue: red + (2*R - B), then grayscale/Otsu
 *     Stage 4 - channel separations (blue/green/gray/inverted)
 *   aggressive (default)
 *     everything in balanced
 *     Stage 5 - CLAHE (local-contrast) gray/red variants for uneven lighting
 *     Stage 6 - quiet-zone padding (+ red variant) for edge-cropped codes
 *     Stage 7 - perspective correction: locate the code quad, homography-warp it
 *               to a canonical square (front-facing) for steep-angle shots
 *     Stage 8 - affine shear / perspective compensation for steep angles
 *
 * Canvas-based stages (quiet-zone / shear) are skipped in DOM-less environments.
 *
 * @param {ImageData} imageData
 * @param {'fast'|'balanced'|'aggressive'} mode
 * @yields {{ data: ImageData, label: string }}
 */
function* buildDecodeAttempts(imageData, mode = 'aggressive') {
  const { width, height } = imageData;

  // Stage 1: original (always tried first).
  yield { data: imageData, label: 'original' };
  if (mode === 'fast') return;

  // Stage 2: dot-matrix broken-ink rescue (cheap pure pixel ops).
  for (const variant of generateDotMatrixFixVariants(imageData)) {
    yield { data: variant.data, label: variant.label };
  }

  // Stage 3: blue / low-contrast rescue + grayscale/Otsu.
  for (const variant of generatePreprocessVariants(imageData)) {
    yield { data: variant.data, label: variant.label };
  }
  const gray = toGray(imageData);
  yield { data: grayToImageData(toOtsuBinary(gray, width, height), width, height), label: 'otsu-binary' };

  // Stage 4: remaining robustness channel splits. Skip 'original' (already tried)
  // and 'red' (identical to the 'red-channel' rescue above).
  for (const ver of preprocessImageData(imageData)) {
    if (ver.label === 'original' || ver.label === 'red') continue;
    yield ver;
  }

  if (mode === 'balanced') return;

  // Stage 5: CLAHE local-contrast enhancement (uneven light / low light).
  for (const variant of generateCLAHEVariants(imageData)) {
    yield { data: variant.data, label: variant.label };
  }

  // Stage 6: quiet-zone (canvas required). Never fail the whole decode just
  // because this last-resort padding could not be produced.
  let bordered = null;
  try {
    bordered = addQuietZoneForImageData(imageData);
  } catch (e) {
    console.warn('Quiet-zone padding failed, skipping bordered attempts:', e);
  }
  if (bordered) {
    yield { data: bordered, label: 'quiet-zone' };
    const [redVariant] = generatePreprocessVariants(bordered);
    yield { data: redVariant.data, label: 'quiet-zone-red' };
  }

  // Stage 7: perspective (homography) correction. Locate the QR quad then warp it
  // back to a front-facing square. Pure pixel, but still expensive, so bounded.
  try {
    for (const variant of generatePerspectiveVariants(imageData, { sizes: [520, 650], expansions: [0, 0.03] })) {
      yield { data: variant.data, label: variant.label };
    }
  } catch (e) {
    console.warn('Perspective-correction stage failed, skipping:', e);
  }

  // Stage 8: affine shear / perspective compensation for codes shot at steep
  // angles. Most expensive stage, so it only runs after everything above failed.
  for (const variant of generateShearVariants(imageData)) {
    yield { data: variant.data, label: variant.label };
    // Stage 8.2: shear + red channel, for steep-angle blue-ink codes.
    const [redOfShear] = generatePreprocessVariants(variant.data);
    yield { data: redOfShear.data, label: `${variant.label}-red` };
  }
}

/**
 * Pad an image with a white border (mirrors Python's copyMakeBorder). This gives
 * ZXing a proper quiet zone for QR codes that are cropped flush against the image
 * edge or tilted in the frame.
 *
 * @param {HTMLCanvasElement|OffscreenCanvas} canvas
 * @param {number} [borderSize=40]
 * @returns {ImageData|null} The padded image, or null when no canvas is available.
 */
export function addQuietZone(canvas, borderSize = 40) {
  const target = createCanvas(canvas.width + borderSize * 2, canvas.height + borderSize * 2);
  if (!target) return null;
  const ctx = target.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, target.width, target.height);
  ctx.drawImage(canvas, borderSize, borderSize);
  return ctx.getImageData(0, 0, target.width, target.height);
}

/** Pad an ImageData with a white border without touching the input image. */
function addQuietZoneForImageData(imageData, borderSize) {
  const { width, height } = imageData;
  const source = createCanvas(width, height);
  if (!source) return null;
  const sourceCtx = source.getContext('2d');
  if (!sourceCtx) return null;

  sourceCtx.putImageData(imageData, 0, 0);

  const size = borderSize || Math.max(32, Math.round(width * 0.1));
  return addQuietZone(source, size);
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
