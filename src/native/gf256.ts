/** Arithmetic in the QR Code field GF(256), with primitive polynomial 0x11d. */
const exponent = new Uint8Array(512);
const logarithm = new Uint8Array(256);

let value = 1;
for (let i = 0; i < 255; i++) {
  exponent[i] = value;
  exponent[i + 255] = value;
  logarithm[value] = i;
  value <<= 1;
  if ((value & 0x100) !== 0) value ^= 0x11d;
}
exponent[510] = exponent[0];
exponent[511] = exponent[1];

export function multiply(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : exponent[logarithm[a] + logarithm[b]];
}

export function divide(a: number, b: number): number {
  if (b === 0) throw new RangeError('Cannot divide by zero in GF(256)');
  return a === 0 ? 0 : exponent[logarithm[a] - logarithm[b] + 255];
}

export function power(a: number, n: number): number {
  if (n === 0) return 1;
  if (a === 0) {
    if (n < 0) throw new RangeError('Cannot raise zero to a negative power');
    return 0;
  }
  const reduced = ((n % 255) + 255) % 255;
  return exponent[(logarithm[a] * reduced) % 255];
}

/** Evaluate a received codeword polynomial at consecutive QR field roots. */
export function syndromes(codewords: Uint8Array, count: number): Uint8Array {
  const result = new Uint8Array(count);
  for (let root = 0; root < count; root++) {
    let sum = 0;
    for (const codeword of codewords) sum = multiply(sum, exponent[root]) ^ codeword;
    result[root] = sum;
  }
  return result;
}
