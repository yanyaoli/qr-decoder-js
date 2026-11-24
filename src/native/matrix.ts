/** Boolean image or QR module grid in row-major order. */
export class BitMatrix {
  private readonly cells: Uint8Array;
  private constructor(public readonly width: number, public readonly height: number) {
    this.cells = new Uint8Array(width * height);
  }
  static createEmpty(width: number, height: number): BitMatrix {
    return new BitMatrix(width, height);
  }
  row(y: number): Uint8Array {
    const start = y * this.width;
    return this.cells.subarray(start, start + this.width);
  }
  get(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height && this.cells[y * this.width + x] !== 0;
  }
  set(x: number, y: number, value: boolean): void {
    if (x >= 0 && x < this.width && y >= 0 && y < this.height) this.cells[y * this.width + x] = value ? 1 : 0;
  }
  setRegion(left: number, top: number, width: number, height: number, value: boolean): void {
    for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++) this.set(x, y, value);
  }
}
