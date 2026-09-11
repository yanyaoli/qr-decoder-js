// WASM module loader for zxing-wasm.
// The binary is bundled locally into the output (fully self-contained, no CDN dependency).

import {
  readBarcodesFromImageData as zxingReadBarcodesFromImageData,
  purgeZXingModule,
  setZXingModuleOverrides,
} from 'zxing-wasm/reader';
import zxingWasmUrl from '../../wasm/zxing_reader.wasm?url';

function base64ToBytes(b64) {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
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

let zxingReadyPromise = null;

/**
 * Prepare zxing-wasm by loading the bundled zxing_reader.wasm.
 * Overriding locateFile keeps the library completely offline.
 */
export function loadZXing() {
  if (!zxingReadyPromise) {
    zxingReadyPromise = initZXing();
  }
  return zxingReadyPromise;
}

async function initZXing() {
  const binary = await fetchWasmBuffer(zxingWasmUrl, 'zxing_reader.wasm');
  purgeZXingModule();
  setZXingModuleOverrides({ wasmBinary: binary });
}

/** Wrapped read function: ensures WASM module is ready before barcode detection. */
export async function readBarcodesFromImageData(imageData, options) {
  await loadZXing();
  return zxingReadBarcodesFromImageData(imageData, options);
}
