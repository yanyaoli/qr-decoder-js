# qr-decoder-js

一个面向浏览器的轻量二维码解码库，提供 TypeScript 类型声明，并支持文本编码检测与常见编码回退，减少中文及其他非 UTF-8 内容的乱码问题。

[English](README.md)

## 安装

```bash
npm install qr-decoder-js
```

## 使用

从用户选择的图片文件中解码二维码：

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

如果已有 Canvas 图像数据，可以使用 `decodeQRImageData`：

```js
import { decodeQRImageData } from 'qr-decoder-js';

const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
const result = await decodeQRImageData(imageData);
```

`decodeQRFile` 支持 `File`、`Blob`、`ImageData`、`HTMLImageElement`、
`HTMLCanvasElement`、`OffscreenCanvas` 和 `{ width, height, data }`。
`decodeQRImageData` 支持 `ImageData` 或同样的 `{ width, height, data }`
结构，其中 `data` 必须是 RGBA 像素数据。

## API

### `decodeQRFile(input, options?)`

从文件或浏览器图像对象中解码二维码。

### `decodeQRImageData(imageData, options?)`

从 RGBA 图像数据中解码二维码。

两个方法都返回 `Promise<DecodeResult>`。

默认使用 `mode: 'aggressive'`，会依次尝试原图、红/蓝通道对比度增强、锐化、
CLAHE、倾斜校正、静区补边、形态学修复、Otsu 二值化、局部自适应二值化和反色。
如果更重视解码延迟而不是困难图片的检出率，可以使用 `mode: 'fast'` 或
`mode: 'balanced'`。

常用选项包括 `tryRotate`、`tryInvert`、`tryHarder`、`tryDownscale`、
`tryDenoise`、`maxNumberOfSymbols`、`formats` 和 `characterSet`：

```js
const result = await decodeQRFile(file, {
  tryHarder: true,
  tryRotate: true,
  maxNumberOfSymbols: 1
});
```

### 返回值

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

解码失败时检查 `success`，并读取 `error`：

```js
{
  success: false,
  error: 'No QR code found in the image'
}
```

## 浏览器要求

目标浏览器需要支持 WebAssembly、`fetch`、`TextDecoder` 和 `ImageData`。
二维码识别使用 `zxing-wasm`，文本编码回退使用浏览器原生 `TextDecoder`，
当前不使用 Google ML Kit、`compact_enc_det` 或 `ced-wasm`。
本包面向浏览器应用，不提供 Node.js 图片解码适配层。

## 本地开发

```bash
pnpm install
pnpm dev       # 启动本地示例
pnpm build     # 构建 npm 包
```

## 许可证

MIT

## 致谢

本项目使用或参考了以下开源项目：

- [zxing-wasm](https://github.com/Sec-ant/zxing-wasm)：用于二维码识别。
