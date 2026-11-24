import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeQRImageData } from '../dist/esm/index.js';

const fixtures = JSON.parse(await readFile(new URL('./qr-fixtures.json', import.meta.url), 'utf8'));
for (const fixture of fixtures) {
  test(`decodes synthetic ${fixture.name} QR payload`, async () => {
    const scale = 5;
    const width = fixture.rows[0].length * scale;
    const height = fixture.rows.length * scale;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const value = fixture.rows[Math.floor(y / scale)][Math.floor(x / scale)] === '1' ? 0 : 255;
        const index = (y * width + x) * 4;
        data[index] = data[index + 1] = data[index + 2] = value;
        data[index + 3] = 255;
      }
    }
    const result = await decodeQRImageData({ width, height, data }, { mode: 'fast' });
    assert.equal(result.success, true);
    assert.equal(result.text, fixture.text);
    assert.ok(result.rawBytes instanceof Uint8Array);
  });
}
