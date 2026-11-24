import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeQRImageData } from '../dist/esm/index.js';

const fixture = JSON.parse(await readFile(new URL('./qr-fixtures.json', import.meta.url), 'utf8'))[0];
for (const style of ['blue', 'inverted', 'rotated', 'dot-matrix', 'sheared']) {
  test(`decodes a synthetic ${style} QR image`, async () => {
    const scale = 6, n = fixture.rows.length, width = n * scale + (style === 'sheared' ? 30 : 0), height = n * scale;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const sourceX = x - (style === 'sheared' ? Math.floor(y * 0.12) : 0);
      const px = Math.floor(sourceX / scale), py = Math.floor(y / scale);
      let black = px >= 0 && px < n && (style === 'rotated' ? fixture.rows[n - 1 - px][py] === '1' : fixture.rows[py][px] === '1');
      if (style === 'dot-matrix' && black) {
        const finder = (px < 11 && (py < 11 || py >= n - 11)) || (px >= n - 11 && py < 11);
        const dx = (sourceX % scale + 0.5) / scale - 0.5, dy = (y % scale + 0.5) / scale - 0.5;
        if (!finder) black = dx * dx + dy * dy < 0.23;
      }
      if (style === 'inverted') black = !black;
      const rgb = black ? (style === 'blue' ? [20, 65, 180] : [0, 0, 0]) : [255, 255, 255];
      data.set([...rgb, 255], (y * width + x) * 4);
    }
    const result = await decodeQRImageData({ width, height, data }, { mode: style === 'dot-matrix' ? 'aggressive' : 'fast' });
    assert.equal(result.success, true);
    assert.equal(result.text, fixture.text);
    if (style === 'inverted') {
      const noInversion = await decodeQRImageData({ width, height, data }, { mode: 'aggressive', tryInvert: false });
      assert.equal(noInversion.success, false);
    }
  });
}

test('does not report a QR code in a blank image', async () => {
  const width = 83, height = 61;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const result = await decodeQRImageData({ width, height, data }, { mode: 'fast' });
  assert.equal(result.success, false);
});

test('decodes a small blurred blue QR image generated from a standard matrix', async () => {
  const matrices = JSON.parse(await readFile(new URL('./standard-matrices.json', import.meta.url), 'utf8'));
  const code = matrices.find(item => item.version === 7 && item.level === 'M');
  const scale = 3, margin = 4, n = code.rows.length, width = (n + margin * 2) * scale, height = width;
  const original = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const mx = Math.floor(x / scale) - margin, my = Math.floor(y / scale) - margin;
    const black = mx >= 0 && my >= 0 && mx < n && my < n && code.rows[my][mx] === '1';
    original.set(black ? [28, 68, 160, 255] : [195, 208, 228, 255], (y * width + x) * 4);
  }
  const blurred = original.slice();
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) for (let c = 0; c < 3; c++) {
    const i = (y * width + x) * 4 + c;
    blurred[i] = (original[i] * 4 + original[i - 4] + original[i + 4] + original[i - width * 4] + original[i + width * 4]) / 8;
  }
  const result = await decodeQRImageData({ width, height, data: blurred }, { mode: 'aggressive' });
  assert.equal(result.success, true);
  assert.equal(result.text, code.text);
});
