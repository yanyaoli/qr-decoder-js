/**
 * Public entry point for the QR decoder package.
 *
 * Keep implementation details in `core/` private so they can evolve without
 * expanding the package's public compatibility surface.
 */
export { decodeQRImageData, decodeQRFile } from './core/decoder';
