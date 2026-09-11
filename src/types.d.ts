export interface DecodeResult {
  success: boolean;
  /** The decoded text content. */
  text?: string;
  /** The TextDecoder character encoding label used (e.g. "utf-8", "gb18030", "shift_jis"). */
  encoding?: string;
  /** Detected encoding identifier. */
  detectedEncoding?: string | null;
  /** Preprocess version that matched, such as original, color rescue, adaptive binary, or inverted. */
  version?: string;
  error?: string;
}

export interface ReaderOptions {
  /** Rescue depth:
   *  - fast: original only (fastest for high-framerate video stream)
  *  - balanced: original + color rescue + sharpening + CLAHE + fast shear + center crop
  *  - aggressive: balanced + quiet-zone, dot-matrix, Otsu, adaptive binary, and inverted variants
   */
  mode?: 'fast' | 'balanced' | 'aggressive';
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
