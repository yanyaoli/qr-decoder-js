# qr-decoder-js

A small, browser-focused QR code decoder with TypeScript declarations. It detects
payload encoding and falls back across common encodings to reduce garbled text,
especially for Chinese and other non-UTF-8 content.

[中文](README_ZH.md)

## Install

```bash
npm install qr-decoder-js
```

## Usage

Decode an image file selected by the user:

```html
<input id="file" type="file" accept="image/*" />
```

```js
import { decodeQRFile } from 'qr-decoder-js';

const input = document.querySelector('#file');

input.addEventListener('change', async () => {
  const file = input.files?.[0];
  if (!file) return;

  const result = await decodeQRFile(file);
  console.log(result.success ? result.text : result.error);
});
```

For an existing canvas, use `decodeQRImageData`:

```js
import { decodeQRImageData } from 'qr-decoder-js';

const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
const result = await decodeQRImageData(imageData);
```

`decodeQRFile` accepts `File`, `Blob`, `ImageData`, `HTMLImageElement`,
`HTMLCanvasElement`, `OffscreenCanvas`, and `{ width, height, data }`.
`decodeQRImageData` accepts `ImageData` or the same `{ width, height, data }`
shape. The `data` value must contain RGBA pixels.

## API

### `decodeQRFile(input, options?)`

Decode a QR code from a file or browser image object.

### `decodeQRImageData(imageData, options?)`

Decode a QR code from RGBA image data.

Both methods return `Promise<DecodeResult>`.

By default, decoding uses `mode: 'aggressive'`. It tries the original image,
red/blue channel contrast rescue, edge sharpening, CLAHE, tilt compensation,
quiet-zone padding, morphology, Otsu thresholding, local adaptive thresholding,
and inversion. Use `mode: 'fast'` or `mode: 'balanced'` when lower latency is
more important than rescue coverage.

Common reader options include `tryRotate`, `tryInvert`, `tryHarder`,
`tryDownscale`, `tryDenoise`, `maxNumberOfSymbols`, `formats`, and
`characterSet`:

```js
const result = await decodeQRFile(file, {
  tryHarder: true,
  tryRotate: true,
  maxNumberOfSymbols: 1
});
```

### Result

```ts
interface DecodeResult {
  success: boolean;
  text?: string;
  encoding?: string;
  detectedEncoding?: string | null;
  version?: string;
  error?: string;
}
```

On failure, check `success` and read `error`:

```js
{
  success: false,
  error: 'No QR code found in the image'
}
```

## Browser support

The target browser must support WebAssembly, `fetch`, `TextDecoder`, and
`ImageData`. The package uses `zxing-wasm` for QR detection and native
`TextDecoder` for encoding fallback; it does not use Google ML Kit,
`compact_enc_det`, or `ced-wasm`. The package is intended for browser
applications and does not provide a Node.js image adapter.

## Development

```bash
pnpm install
pnpm dev       # local demo
pnpm build     # build the package
```

## License

MIT

## Acknowledgements

This project uses and is inspired by:

- [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) for QR code detection.
