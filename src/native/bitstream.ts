export interface Segment {
  type: 'numeric' | 'alphanumeric' | 'byte' | 'kanji' | 'eci';
  text?: string;
  bytes?: number[];
  assignmentNumber?: number;
}

export interface Payload {
  text: string;
  bytes: number[];
  chunks: Segment[];
  version: number;
}

class Bits {
  private position = 0;
  constructor(private readonly data: Uint8Array | Uint8ClampedArray) {}
  get remaining(): number { return this.data.length * 8 - this.position; }
  get offset(): number { return this.position & 7; }
  read(count: number): number {
    if (count > this.remaining) throw new Error('Truncated QR payload');
    let value = 0;
    for (let i = 0; i < count; i++, this.position++) {
      value = (value << 1) | ((this.data[this.position >> 3] >> (7 - (this.position & 7))) & 1);
    }
    return value;
  }
}

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

/** Parse data codewords after QR error correction into ordered payload segments. */
export function decodePayload(data: Uint8Array | Uint8ClampedArray, version: number): Payload {
  if (version < 1 || version > 40) throw new RangeError('Invalid QR version');
  const bits = new Bits(data);
  const tier = version <= 9 ? 0 : version <= 26 ? 1 : 2;
  const result: Payload = { text: '', bytes: [], chunks: [], version };
  let fnc1 = false;
  while (bits.remaining >= 4) {
    const mode = bits.read(4);
    if (mode === 0) {
      // An all-zero matrix can satisfy Reed-Solomon yet is not a QR payload.
      // Validate standard pad codewords when no data segment has been found.
      if (!result.chunks.some(chunk => chunk.type !== 'eci')) {
        if (bits.offset && bits.read(8 - bits.offset) !== 0) throw new Error('Invalid QR padding');
        let pad = 0xec;
        while (bits.remaining >= 8) {
          if (bits.read(8) !== pad) throw new Error('Invalid QR padding');
          pad ^= 0xfd;
        }
      }
      return result;
    }
    if (mode === 7) {
      const first = bits.read(8);
      let assignment: number;
      if ((first & 0x80) === 0) assignment = first;
      else if ((first & 0xc0) === 0x80) assignment = ((first & 0x3f) << 8) | bits.read(8);
      else if ((first & 0xe0) === 0xc0) assignment = ((first & 0x1f) << 16) | bits.read(16);
      else throw new Error('Invalid ECI assignment');
      result.chunks.push({ type: 'eci', assignmentNumber: assignment });
      continue;
    }
    if (mode === 3) { bits.read(16); continue; }
    if (mode === 5 || mode === 9) { if (mode === 9) bits.read(8); fnc1 = true; continue; }
    const widths: Record<number, number[]> = { 1: [10, 12, 14], 2: [9, 11, 13], 4: [8, 16, 16], 8: [8, 10, 12] };
    if (!widths[mode]) throw new Error(`Unsupported QR mode ${mode}`);
    let count = bits.read(widths[mode][tier]);
    let text = '';
    const bytes: number[] = [];
    if (mode === 1) {
      while (count >= 3) { const n = bits.read(10); if (n >= 1000) throw new Error('Invalid numeric group'); text += String(n).padStart(3, '0'); count -= 3; }
      if (count) { const n = bits.read(count === 2 ? 7 : 4); if (n >= 10 ** count) throw new Error('Invalid numeric group'); text += String(n).padStart(count, '0'); }
    } else if (mode === 2) {
      while (count >= 2) { const n = bits.read(11); if (n >= 2025) throw new Error('Invalid alphanumeric group'); text += ALPHABET[Math.floor(n / 45)] + ALPHABET[n % 45]; count -= 2; }
      if (count) { const n = bits.read(6); if (n >= 45) throw new Error('Invalid alphanumeric group'); text += ALPHABET[n]; }
      if (fnc1) text = text.replace(/%%|%/g, match => match === '%%' ? '%' : '\x1d');
    } else if (mode === 4) {
      while (count--) bytes.push(bits.read(8));
      result.chunks.push({ type: 'byte', bytes });
      result.bytes.push(...bytes);
      continue;
    } else {
      while (count--) {
        const n = bits.read(13);
        let code = (Math.floor(n / 0xc0) << 8) | (n % 0xc0);
        code += code < 0x1f00 ? 0x8140 : 0xc140;
        bytes.push(code >> 8, code & 255);
      }
      text = new TextDecoder('shift_jis', { fatal: true }).decode(new Uint8Array(bytes));
      result.chunks.push({ type: 'kanji', bytes, text });
      result.bytes.push(...bytes);
      result.text += text;
      continue;
    }
    for (const char of text) bytes.push(char.charCodeAt(0));
    result.chunks.push({ type: mode === 1 ? 'numeric' : 'alphanumeric', text });
    result.bytes.push(...bytes);
    result.text += text;
  }
  if (bits.remaining && bits.read(bits.remaining) !== 0) throw new Error('Invalid QR padding');
  return result;
}
