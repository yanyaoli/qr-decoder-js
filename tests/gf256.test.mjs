import test from 'node:test';
import assert from 'node:assert/strict';
import { multiply, divide, power, syndromes } from '../src/native/gf256.ts';

function multiplyPolynomial(a, b) {
  let result = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) result ^= a;
    b >>>= 1;
    a <<= 1;
    if (a & 0x100) a ^= 0x11d;
  }
  return result;
}

test('GF multiplication matches polynomial arithmetic for every byte pair', () => {
  for (let a = 0; a < 256; a++) {
    for (let b = 0; b < 256; b++) {
      assert.equal(multiply(a, b), multiplyPolynomial(a, b));
    }
  }
});

test('division and powers obey field identities', () => {
  for (let a = 1; a < 256; a++) {
    assert.equal(divide(a, a), 1);
    assert.equal(multiply(a, power(a, -1)), 1);
    assert.equal(power(a, 255), 1);
  }
  assert.throws(() => divide(1, 0), RangeError);
  assert.throws(() => power(0, -1), RangeError);
});

test('syndromes evaluate QR codeword polynomials at consecutive roots', () => {
  // (x + 1)(x + 2) = x² + 3x + 2 in GF(256).
  assert.deepEqual([...syndromes(Uint8Array.of(1, 3, 2), 2)], [0, 0]);
  assert.notDeepEqual([...syndromes(Uint8Array.of(1, 2, 2), 2)], [0, 0]);
});
