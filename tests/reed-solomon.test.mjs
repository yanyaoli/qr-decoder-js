import test from 'node:test';
import assert from 'node:assert/strict';
import { multiply, power } from '../dist/esm/native/gf256.js';
import { correctCodewords } from '../dist/esm/native/reed-solomon.js';

function encode(data, parityCount) {
  let generator = [1];
  for (let root = 0; root < parityCount; root++) {
    const next = new Array(generator.length + 1).fill(0);
    for (let i = 0; i < generator.length; i++) {
      next[i] ^= generator[i];
      next[i + 1] ^= multiply(generator[i], power(2, root));
    }
    generator = next;
  }
  const work = new Uint8Array(data.length + parityCount);
  work.set(data);
  for (let i = 0; i < data.length; i++) {
    const factor = work[i];
    for (let j = 0; j < generator.length; j++) work[i + j] ^= multiply(generator[j], factor);
  }
  return Uint8Array.from([...data, ...work.slice(data.length)]);
}

test('corrects damaged data and parity without mutating input', () => {
  for (let count = 0; count <= 5; count++) {
    const codewords = encode(Uint8Array.from({ length: 30 }, (_, i) => (i * 17 + 7) & 255), 10);
    const damaged = codewords.slice();
    for (let i = 0; i < count; i++) damaged[(i * 9 + 2) % damaged.length] ^= 0x51 + i;
    const before = damaged.slice();
    assert.deepEqual(correctCodewords(damaged, 10), codewords);
    assert.deepEqual(damaged, before);
  }
});

test('rejects an uncorrectable block and invalid dimensions', () => {
  const damaged = encode(Uint8Array.from({ length: 30 }, (_, i) => i * 3), 10);
  for (let i = 0; i < 7; i++) damaged[i * 3] ^= i + 7;
  assert.equal(correctCodewords(damaged, 10), null);
  assert.throws(() => correctCodewords(damaged, 0), RangeError);
});

test('uses known erasures to correct beyond the ordinary error limit', () => {
  const original = encode(Uint8Array.from({ length: 35 }, (_, i) => (i * 31 + 9) & 255), 16);
  for (let erased = 2; erased <= 12; erased += 2) {
    const unknown = (16 - erased) / 2;
    const damaged = original.slice();
    const positions = Array.from({ length: erased + unknown }, (_, i) => (i * 7 + 3) % damaged.length);
    for (const [i, pos] of positions.entries()) damaged[pos] ^= 0x91 + i;
    assert.deepEqual(correctCodewords(damaged, 16, positions.slice(0, erased)), original);
  }
  assert.throws(() => correctCodewords(Uint8Array.from([1, 2, 3]), 2, [4]), RangeError);
});
