# qr-decoder-js

使用 TypeScript 实现的浏览器二维码解码库，运行时无需第三方依赖。

- 支持文件、图片、画布和 RGBA 像素数据。
- 支持 UTF-8、GBK/GB18030、ECI 和浏览器支持的其他编码。
- 支持反色、彩色、畸变和点阵二维码。
- 提供 ES Module 和 CommonJS 导出。

## 安装

```sh
npm install qr-decoder-js
```

## 使用

```js
import { decodeQRFile } from 'qr-decoder-js';

const result = await decodeQRFile(file);
if (result.success) {
  console.log(result.text, result.encoding, result.rawBytes);
} else {
  console.error(result.error);
}
```

`decodeQRFile` 接受 `File`、`Blob`、图片、画布、`ImageData` 或 RGBA 数据对象。像素数据也可以使用 `decodeQRImageData(imageData, options)` 解析。两个函数均返回包含单个结果的 Promise。

可通过 `mode` 选择 `fast`、`balanced` 或默认的 `aggressive`，通过 `tryInvert` 控制反色识别。无 ECI 标记的字节段可使用 `characterSet` 指定编码，否则会进行编码猜测；`rawBytes` 返回原始字节。

## 开发

```sh
pnpm install
pnpm test
pnpm build
pnpm build:demo
```

## 来源

二维码规格表和小图恢复方法改编自 qcore，采用 [MIT 许可](LICENSE.qcore)。项目曾集成 jsQR，保留其 [Apache-2.0 许可](LICENSE.jsQR)。
