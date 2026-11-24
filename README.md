# qr-decoder-js

A browser QR code decoder written in TypeScript with no runtime dependencies.

- Decode QR codes from files, images, canvases, or RGBA pixel data.
- Support UTF-8, GBK/GB18030, ECI, and other browser-supported encodings.
- Handle inverted, colored, distorted, and dot-matrix QR codes.
- Export ES modules and CommonJS.

## Install

```sh
npm install qr-decoder-js
```

## Usage

```js
import { decodeQRFile } from 'qr-decoder-js';

const result = await decodeQRFile(file);
if (result.success) {
  console.log(result.text, result.encoding, result.rawBytes);
} else {
  console.error(result.error);
}
```

`decodeQRFile` accepts a `File`, `Blob`, image, canvas, `ImageData`, or RGBA data object. Use `decodeQRImageData(imageData, options)` for pixel data directly. Both functions return a promise containing one result.

Options include `mode` (`fast`, `balanced`, or `aggressive`, the default), `tryInvert`, and `characterSet` for byte segments without an ECI encoding. Unmarked encodings are otherwise guessed. `rawBytes` provides the decoded bytes when an explicit encoding is needed.

## Development

```sh
pnpm install
pnpm test
pnpm build
pnpm build:demo
```

## Attribution

QR specification tables and small-image recovery techniques are adapted from qcore under the [MIT license](LICENSE.qcore). The project previously incorporated jsQR and retains its [Apache-2.0 license](LICENSE.jsQR).
