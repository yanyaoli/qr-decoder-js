import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BitMatrix } from '../dist/esm/native/matrix.js';
import { decode } from '../dist/esm/native/matrix-decoder.js';
import { decodeChunks } from '../dist/esm/core/encoding.js';

const fixtures = JSON.parse(await readFile(new URL('./standard-matrices.json', import.meta.url), 'utf8'));
for (const fixture of fixtures) {
  for (const mirrored of [false, true]) {
    test(`decodes version ${fixture.version} level ${fixture.level}${mirrored ? ' mirrored' : ''}`, () => {
      const n = fixture.rows.length;
      const matrix = BitMatrix.createEmpty(n, n);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        matrix.set(mirrored ? y : x, mirrored ? x : y, fixture.rows[y][x] === '1');
      }
      const payload = decode(matrix);
      assert.ok(payload);
      assert.equal(payload.version, fixture.version);
      assert.equal(decodeChunks(payload.chunks).text, fixture.text);
    });
  }
}

test('uses low-confidence modules as erasures only when hard correction fails', () => {
  const fixture = fixtures.find(item => item.version === 7 && item.level === 'M');
  const n = fixture.rows.length, matrix = BitMatrix.createEmpty(n, n), reserved = BitMatrix.createEmpty(n, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) matrix.set(x, y, fixture.rows[y][x] === '1');
  reserved.setRegion(0, 0, 9, 9, true);
  reserved.setRegion(n - 8, 0, 8, 9, true);
  reserved.setRegion(0, n - 8, 9, 8, true);
  for (const y of [6, 22, 38]) for (const x of [6, 22, 38]) {
    if ((x === 6 && (y === 6 || y === n - 7)) || (y === 6 && x === n - 7)) continue;
    reserved.setRegion(x - 2, y - 2, 5, 5, true);
  }
  reserved.setRegion(6, 9, 1, n - 17, true);
  reserved.setRegion(9, 6, n - 17, 1, true);
  reserved.setRegion(n - 11, 0, 3, 6, true);
  reserved.setRegion(0, n - 11, 6, 3, true);
  const positions = [];
  let upward = true;
  for (let right = n - 1; right > 0; right -= 2) {
    if (right === 6) right--;
    for (let step = 0; step < n; step++) for (let offset = 0; offset < 2; offset++) {
      const x = right - offset, y = upward ? n - 1 - step : step;
      if (!reserved.get(x, y)) positions.push([x, y]);
    }
    upward = !upward;
  }
  const confidence = new Uint8Array(n * n).fill(210), incorrectConfidence = confidence.slice();
  for (let i = 0; i < 10; i++) {
    const [x, y] = positions[i * 4 * 8];
    matrix.set(x, y, !matrix.get(x, y));
    if (i < 4) confidence[y * n + x] = 1;
  }
  for (let i = 0; i < 4; i++) {
    const [x, y] = positions[(i * 4 + 1) * 8];
    incorrectConfidence[y * n + x] = 1;
  }
  assert.equal(decode(matrix), null);
  assert.equal(decode(matrix, incorrectConfidence), null);
  const result = decode(matrix, confidence);
  assert.ok(result);
  assert.equal(decodeChunks(result.chunks).text, fixture.text);
});
