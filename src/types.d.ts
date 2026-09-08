export interface DecodeResult {
  success: boolean;
  /** The decoded text. */
  text?: string;
  /** The TextDecoder label that was ultimately used. */
  encoding?: string;
  /** Raw detection result from ced-wasm (e.g. "GBK"); may be empty. */
  detectedEncoding?: string | null;
  /** Preprocess version that matched: original / blue / green / red / gray / inverted. */
  version?: string;
  error?: string;
}

export interface ReaderOptions {
  formats?: string[];
  tryRotate?: boolean;
  tryInvert?: boolean;
  tryHarder?: boolean;
  tryDownscale?: boolean;
  tryDenoise?: boolean;
  maxNumberOfSymbols?: number;
  binarizer?: string;
  isPure?: boolean;
  returnErrors?: boolean;
  textMode?: string;
  characterSet?: string;
  [key: string]: unknown;
}

export function decodeQRImageData(
  imageData:
    | ImageData
    | { width: number; height: number; data: Uint8ClampedArray | Uint8Array | number[] },
  options?: ReaderOptions
): Promise<DecodeResult>;

export function decodeQRFile(
  input:
    | File
    | Blob
    | ImageData
    | HTMLImageElement
    | HTMLCanvasElement
    | OffscreenCanvas
    | { width: number; height: number; data: Uint8ClampedArray | Uint8Array | number[] },
  options?: ReaderOptions
): Promise<DecodeResult>;
