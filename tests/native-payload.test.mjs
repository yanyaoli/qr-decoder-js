import test from 'node:test';
import assert from 'node:assert/strict';
import { decodePayload } from '../dist/esm/native/bitstream.js';

function bits(...parts) {
  let input = parts.map(([value, width]) => value.toString(2).padStart(width, '0')).join('') + '0000';
  input = input.padEnd(Math.ceil(input.length / 8) * 8, '0');
  return Uint8Array.from(input.match(/.{8}/g), byte => parseInt(byte, 2));
}

test('parses numeric, ECI and byte segments without losing bytes', () => {
  const data = bits([1, 4], [3, 10], [123, 10], [7, 4], [26, 8], [4, 4], [2, 8], [0xc3, 8], [0xa9, 8]);
  const result = decodePayload(data, 1);
  assert.deepEqual(result.chunks, [
    { type: 'numeric', text: '123' },
    { type: 'eci', assignmentNumber: 26 },
    { type: 'byte', bytes: [0xc3, 0xa9] },
  ]);
  assert.deepEqual(result.bytes, [49, 50, 51, 0xc3, 0xa9]);
});

test('rejects invalid and truncated numeric payloads', () => {
  assert.throws(() => decodePayload(bits([1, 4], [3, 10], [1023, 10]), 1), /numeric/);
  assert.throws(() => decodePayload(Uint8Array.of(0x40, 0xff), 1), /Truncated/);
});

test('accepts valid empty padding and rejects an all-zero false payload', () => {
  assert.deepEqual(decodePayload(Uint8Array.of(0, 0xec, 0x11), 1).chunks, []);
  assert.throws(() => decodePayload(Uint8Array.of(0, 0, 0), 1), /padding/);
});
