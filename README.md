# qr-decoder-js

Browser QR decoder with a TypeScript QR engine. It has no runtime package dependencies or WebAssembly. The TypeScript compiler is the only development dependency.

```js
import { decodeQRFile } from 'qr-decoder-js';
const result = await decodeQRFile(file, { characterSet: 'gb18030' });
if (result.success) console.log(result.text, result.rawBytes);
```

`decodeQRImageData` accepts RGBA ImageData or `{ width, height, data }`; `decodeQRFile` also accepts browser image elements, canvas, Blob and File. Both return a Promise. `mode` may be `fast`, `balanced`, or `aggressive` (default); `tryInvert` controls inversion. The engine returns one QR code per call. Other historical ZXing-specific reader options are not implemented by the TypeScript engine.

The package exports ES modules and CommonJS. The previous UMD build and its `QRDecoder` browser global are no longer provided; browser pages can import the ES module instead.

Byte segments with a supported ECI use that encoding. For unmarked byte segments, `characterSet` selects an encoding; otherwise a heuristic tries UTF-8 and common legacy encodings. Guessing is inherently ambiguous. `rawBytes` preserves the decoded bytes, `qrVersion` is the QR version, and `version` identifies the preprocessing attempt. Unsupported ECI assignments return an error instead of guessing.

Development: `pnpm install`, `pnpm build`, `pnpm test` (Node 22 or newer). Synthetic tests cover UTF-8, GBK, mixed ECI, multiple QR versions, and blue, inverted, rotated, dot-matrix and sheared images. Some heavily distorted or low-resolution images may still be unreadable.

QR version and error-correction tables and small-color-image recovery techniques are adapted from qcore under the MIT license; see [LICENSE.qcore](LICENSE.qcore). The project previously incorporated jsQR and retains its [Apache-2.0 license](LICENSE.jsQR) for attribution. Project code is MIT.
