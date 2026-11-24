export interface DecodeResult {
  success: boolean;
  /** The decoded text content. */
  text?: string;
  /** The TextDecoder character encoding label used (e.g. "utf-8", "gb18030", "shift_jis"). */
  encoding?: string;
  /** Detected encoding identifier. */
  detectedEncoding?: string | null;
  /** QR payload bytes before text decoding. */
  rawBytes?: Uint8Array;
  /** QR symbol version (1–40). */
  qrVersion?: number;
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
  /** @deprecated Accepted for compatibility; the TypeScript engine decodes QR codes only. */
  formats?: string[];
  /** @deprecated Accepted for compatibility; finder detection handles rotation automatically. */
  tryRotate?: boolean;
  /** Whether to scan the inverse image; defaults to true. */
  tryInvert?: boolean;
  /** @deprecated ZXing-specific option; not used by the TypeScript engine. */
  tryHarder?: boolean;
  /** @deprecated ZXing-specific option; not used by the TypeScript engine. */
  tryDownscale?: boolean;
  /** @deprecated ZXing-specific option; not used by the TypeScript engine. */
  tryDenoise?: boolean;
  /** @deprecated The TypeScript engine currently returns at most one symbol. */
  maxNumberOfSymbols?: number;
  /** @deprecated ZXing-specific option; not used by the TypeScript engine. */
  binarizer?: string;
  /** @deprecated ZXing-specific option; not used by the TypeScript engine. */
  isPure?: boolean;
  /** @deprecated ZXing-specific option; not used by the TypeScript engine. */
  returnErrors?: boolean;
  /** @deprecated ZXing-specific option; not used by the TypeScript engine. */
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
