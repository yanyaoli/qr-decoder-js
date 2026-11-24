import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFormat } from '../dist/esm/native/format.js';

test('decodes standard masked QR format words and corrects damaged copies', () => {
  // Standard format bits: M mask 0 and L mask 0.
  assert.deepEqual(decodeFormat(0x5412, 0), { errorCorrection: 'M', mask: 0, distance: 0 });
  assert.deepEqual(decodeFormat(0x77c4 ^ 0x7, 0), { errorCorrection: 'L', mask: 0, distance: 3 });
  assert.deepEqual(decodeFormat(0, 0x5412 ^ 0x3), { errorCorrection: 'M', mask: 0, distance: 2 });
});
