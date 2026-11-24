import test from 'node:test';
import assert from 'node:assert/strict';
import { BitMatrix } from '../dist/esm/native/matrix.js';
import { extract } from '../dist/esm/native/sampling.js';

test('samples module centers and maps the finder points', () => {
  const image = BitMatrix.createEmpty(50, 50);
  image.setRegion(10, 10, 2, 2, true);
  const location = {
    dimension: 21,
    topLeft: { x: 7, y: 7 }, topRight: { x: 35, y: 7 },
    bottomLeft: { x: 7, y: 35 }, alignmentPattern: { x: 29, y: 29 },
  };
  const sampled = extract(image, location);
  assert.equal(sampled.matrix.get(5, 5), true);
  const mapped = sampled.mappingFunction(3.5, 3.5);
  assert.ok(Math.abs(mapped.x - 7) < 1e-8 && Math.abs(mapped.y - 7) < 1e-8);
});
