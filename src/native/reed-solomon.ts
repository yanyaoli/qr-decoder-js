import { divide, multiply, power, syndromes } from './gf256.js';

/** Correct QR codewords using their Reed–Solomon parity, or return null. */
export function correctCodewords(input: Uint8Array, parityCount: number, erasures: number[] = []): Uint8Array | null {
  if (input.length === 0 || input.length > 255 || parityCount <= 0 || parityCount >= input.length) {
    throw new RangeError('Invalid Reed–Solomon block dimensions');
  }
  if (erasures.length > parityCount || new Set(erasures).size !== erasures.length ||
      erasures.some(index => !Number.isInteger(index) || index < 0 || index >= input.length)) {
    throw new RangeError('Invalid Reed–Solomon erasures');
  }
  const syndrome = syndromes(input, parityCount);
  if (syndrome.every(value => value === 0)) return input.slice();
  // Remove known error locations from the syndrome sequence before finding
  // the remaining unknown locations with Berlekamp–Massey.
  let modified = Array.from(syndrome);
  for (const index of erasures) {
    const root = power(2, input.length - 1 - index);
    modified = modified.slice(1).map((value, i) => value ^ multiply(root, modified[i]));
  }

  // Berlekamp–Massey: coefficients are ordered from constant term upward.
  let locator = new Uint8Array(parityCount + 1);
  let previous = new Uint8Array(parityCount + 1);
  locator[0] = previous[0] = 1;
  let degree = 0;
  let shift = 1;
  let lastDiscrepancy = 1;
  for (let n = 0; n < modified.length; n++) {
    let discrepancy = modified[n];
    for (let i = 1; i <= degree; i++) discrepancy ^= multiply(locator[i], modified[n - i]);
    if (discrepancy === 0) {
      shift++;
      continue;
    }
    const saved = locator.slice();
    const factor = divide(discrepancy, lastDiscrepancy);
    for (let i = 0; i + shift <= parityCount; i++) {
      locator[i + shift] ^= multiply(factor, previous[i]);
    }
    if (2 * degree <= n) {
      degree = n + 1 - degree;
      previous = saved;
      lastDiscrepancy = discrepancy;
      shift = 1;
    } else {
      shift++;
    }
  }
  if (2 * degree + erasures.length > parityCount) return null;

  // Chien search maps roots to codeword indices.
  const locations: number[] = [];
  for (let index = 0; index < input.length; index++) {
    const exponent = input.length - 1 - index;
    const root = power(2, -exponent);
    let evaluation = 0;
    for (let i = degree; i >= 0; i--) evaluation = multiply(evaluation, root) ^ locator[i];
    if (evaluation === 0) locations.push(index);
  }
  if (locations.length !== degree) return null;
  if (locations.some(index => erasures.includes(index))) return null;
  locations.push(...erasures);
  if (!locations.length) return null;

  // Solve the syndrome equations for error magnitudes in the finite field.
  const errorCount = locations.length;
  const equations = Array.from({ length: errorCount }, (_, row) => {
    const equation = new Uint8Array(errorCount + 1);
    for (let column = 0; column < errorCount; column++) {
      equation[column] = power(2, (input.length - 1 - locations[column]) * row);
    }
    equation[errorCount] = syndrome[row];
    return equation;
  });
  for (let column = 0; column < errorCount; column++) {
    let pivot = column;
    while (pivot < errorCount && equations[pivot][column] === 0) pivot++;
    if (pivot === errorCount) return null;
    [equations[column], equations[pivot]] = [equations[pivot], equations[column]];
    const divisor = equations[column][column];
    for (let i = column; i <= errorCount; i++) equations[column][i] = divide(equations[column][i], divisor);
    for (let row = 0; row < errorCount; row++) {
      if (row === column) continue;
      const factor = equations[row][column];
      for (let i = column; i <= errorCount; i++) equations[row][i] ^= multiply(factor, equations[column][i]);
    }
  }
  const corrected = input.slice();
  for (let i = 0; i < errorCount; i++) corrected[locations[i]] ^= equations[i][errorCount];
  return syndromes(corrected, parityCount).every(value => value === 0) ? corrected : null;
}
