// WASM module loader for zxing-wasm (QR detection/decoding) and ced-wasm (encoding detection).
// Both binaries are bundled locally (no CDN dependency).

// At build time the wasm files are inlined into the output as base64 `data:` URLs
// (fully self-contained). At runtime we decode the binary and inject it into the
// emscripten module via `wasmBinary`, so no network fetch or locateFile is needed.

import {
  readBarcodesFromImageData as zxingReadBarcodesFromImageData,
  purgeZXingModule,
  setZXingModuleOverrides,
} from 'zxing-wasm/reader';
import zxingWasmUrl from '../../wasm/zxing_reader.wasm?url';
import cedWasmUrl from '../../wasm/ced.wasm?url';
import cedSource from '../../wasm/ced.js?raw';

/** The `?url` import may produce a data URL (inlined) or a plain URL. It is passed through as-is. */
function resolveAssetUrl(url) {
  return url;
}

function base64ToBytes(b64) {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Fallback for non-browser (Node) environments.
  const buf = Buffer.from(b64, 'base64');
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function bytesFromDataUrl(url) {
  if (typeof url !== 'string' || !/^data:/i.test(url)) return null;
  const comma = url.indexOf(',');
  if (comma === -1) return null;
  const meta = url.slice(5, comma);
  const body = url.slice(comma + 1);
  if (/;base64/i.test(meta)) return base64ToBytes(body);
  return new TextEncoder().encode(decodeURIComponent(body));
}

async function fetchWasmBuffer(url, label) {
  const local = bytesFromDataUrl(url);
  if (local) return local;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${label}: ${response.status} ${response.url}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

// ---------------- zxing ----------------

let zxingReadyPromise = null;

/**
 * Prepare zxing-wasm by fetching the bundled zxing_reader.wasm and injecting it
 * through `Module.wasmBinary`. zxing-wasm's default locateFile points to a CDN
 * (jsdelivr); overriding it keeps everything offline.
 */
export function loadZXing() {
  if (!zxingReadyPromise) {
    zxingReadyPromise = initZXing();
  }
  return zxingReadyPromise;
}

async function initZXing() {
  const binary = await fetchWasmBuffer(resolveAssetUrl(zxingWasmUrl), 'zxing_reader.wasm');
  purgeZXingModule();
  setZXingModuleOverrides({ wasmBinary: binary });
}

/** Wrapped read function: ensures the local WASM is ready before decoding. */
export async function readBarcodesFromImageData(imageData, options) {
  await loadZXing();
  return zxingReadBarcodesFromImageData(imageData, options);
}

// ---------------- ced ----------------

let cedPromise = null;

/**
 * Load the ced-wasm encoding-detection module.
 *
 * ced.js is a classic Emscripten script that locates and instantiates ced.wasm by
 * itself. Here we import the script source as raw text (`?raw`), inject the wasm
 * binary via `Module.wasmBinary`, and execute the script inside its own function
 * scope. This avoids polluting globals and does not rely on locating ced.wasm by
 * relative path.
 *
 * @returns {Promise<object>} The initialized Module object exposing DetectEncoding.
 */
export function loadCED() {
  if (!cedPromise) {
    cedPromise = initCED();
  }
  return cedPromise;
}

async function initCED() {
  const binary = await fetchWasmBuffer(resolveAssetUrl(cedWasmUrl), 'ced.wasm');
  const module = { wasmBinary: binary };

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('CED wasm initialization timed out'));
      }
    }, 30000);

    const done = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(value);
    };

    module.onAbort = (e) => {
      done(new Error(`CED wasm aborted: ${(e && e.message) || e}`));
    };

    module.onRuntimeInitialized = () => {
      if (typeof module.DetectEncoding === 'function') done(null, module);
      else done(new Error('CED wasm initialized but DetectEncoding was not found'));
    };

    try {
      // eslint-disable-next-line no-new-func
      const compile = new Function('Module', cedSource);
      compile(module);
      // In rare cases the wasm may initialize synchronously; double-check.
      if (typeof module.DetectEncoding === 'function') done(null, module);
    } catch (e) {
      done(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/**
 * Detect the character encoding of a byte sequence.
 * CED usually returns a string such as "GBK" or "Shift_JIS". Returns null on failure.
 */
export async function detectEncoding(bytes) {
  const module = await loadCED();
  try {
    const enc = module.DetectEncoding(bytes);
    if (enc == null) return null;
    if (typeof enc === 'string') return enc;
    // Some wrappers return an object like { encoding, confidence, ... }
    if (typeof enc === 'object' && enc.encoding != null) return String(enc.encoding);
    return String(enc);
  } catch (e) {
    console.warn('ced DetectEncoding call failed', e);
    return null;
  }
}
