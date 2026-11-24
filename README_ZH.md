# qr-decoder-js

浏览器二维码解码库，使用 TypeScript 实现识别引擎。运行时无需安装其他包，也不使用 WebAssembly；开发构建只需 TypeScript 编译器。

```js
import { decodeQRFile } from 'qr-decoder-js';
const result = await decodeQRFile(file, { characterSet: 'gb18030' });
if (result.success) console.log(result.text, result.rawBytes);
```

`decodeQRImageData` 接受 RGBA ImageData 或 `{ width, height, data }`；`decodeQRFile` 还接受浏览器图片、画布、Blob 和 File。两个方法返回 Promise。`mode` 可选 `fast`、`balanced` 或默认的 `aggressive`，`tryInvert` 控制反色尝试。每次返回一个二维码；此前的其他 ZXing 专用选项尚未由新引擎实现。

包提供 ES Module 和 CommonJS 导出；旧版的 UMD 构建及 `QRDecoder` 浏览器全局变量不再提供，浏览器页面可以改用 ES Module 导入。

字节段优先使用二维码中支持的 ECI；无标记时使用调用方指定的 `characterSet`，否则启发式尝试 UTF-8 和常见旧编码。编码猜测可能有歧义，可通过 `rawBytes` 获取原始字节自行处理。`qrVersion` 是二维码版本，`version` 表示成功的预处理步骤；遇到不支持的 ECI 会返回错误。

开发：`pnpm install`、`pnpm build`、`pnpm test`（需要 Node 22 或更新版本）。合成测试覆盖 UTF-8、GBK、混合 ECI、多个二维码版本，以及蓝色、反色、旋转、点阵和倾斜图像。严重畸变或分辨率较低的图像仍可能无法识别。

二维码版本和纠错规格表以及小尺寸彩色图像恢复方法参考并改编自 qcore，采用 MIT 许可，见 [LICENSE.qcore](LICENSE.qcore)。项目曾集成 jsQR，保留其 [Apache-2.0 许可证](LICENSE.jsQR)以注明来源；项目代码采用 MIT。
