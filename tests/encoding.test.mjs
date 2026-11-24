import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeChunks } from '../src/core/encoding.ts';

test('decodes unmarked GBK payload and preserves ASCII segments', () => {
  const result = decodeChunks([
    { type: 'alphanumeric', text: 'ID:' },
    { type: 'byte', bytes: [0xc4, 0xe3, 0xba, 0xc3] },
  ]);
  assert.equal(result.text, 'ID:你好');
  assert.equal(result.encoding, 'gb18030');
});

test('honors ECI independently for mixed-encoding segments', () => {
  const result = decodeChunks([
    { type: 'eci', assignmentNumber: 29 },
    { type: 'byte', bytes: [0xc4, 0xe3, 0xba, 0xc3] },
    { type: 'eci', assignmentNumber: 26 },
    { type: 'byte', bytes: [0xe4, 0xb8, 0x96, 0xe7, 0x95, 0x8c] },
  ], 'shift_jis');
  assert.equal(result.text, '你好世界');
  assert.equal(result.encoding, 'mixed');
});

test('caller can select encoding for unmarked bytes', () => {
  assert.equal(decodeChunks([{ type: 'byte', bytes: [0x93, 0xfa, 0x96, 0x7b] }], 'shift_jis').text, '日本');
});

test('unknown ECI is reported instead of silently guessing', () => {
  assert.throws(() => decodeChunks([{ type: 'eci', assignmentNumber: 999 }]), /Unsupported ECI/);
});

test('ECI Latin-1 preserves the C1 control range', () => {
  assert.equal(decodeChunks([{ type: 'eci', assignmentNumber: 3 }, { type: 'byte', bytes: [0x80] }]).text, '\u0080');
});
