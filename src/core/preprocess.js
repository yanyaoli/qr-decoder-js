// Image preprocessing: produce several channel versions to improve the detection
// rate for colored / light-colored QR codes.

/**
 * Generate several preprocessing versions:
 *   original - as-is
 *   blue     - blue channel (friendly to blue QR codes)
 *   green    - green channel
 *   red      - red channel
 *   gray     - standard luma (Rec.601 coefficients)
 *   inverted - inverted luma (light / inverted codes)
 *
 * @param {ImageData} imageData
 * @returns {{ data: ImageData, label: string }[]}
 */
export function preprocessImageData(imageData) {
  const { width, height } = imageData;
  const src = imageData.data;
  const n = src.length;
  const versions = [];

  versions.push({ data: imageData, label: 'original' });

  const blue = new ImageData(width, height);
  const dBlue = blue.data;
  const green = new ImageData(width, height);
  const dGreen = green.data;
  const red = new ImageData(width, height);
  const dRed = red.data;
  const gray = new ImageData(width, height);
  const dGray = gray.data;
  const inv = new ImageData(width, height);
  const dInv = inv.data;

  for (let i = 0; i < n; i += 4) {
    const r = src[i];
    const g = src[i + 1];
    const b = src[i + 2];

    dBlue[i] = b;
    dBlue[i + 1] = b;
    dBlue[i + 2] = b;
    dBlue[i + 3] = 255;

    dGreen[i] = g;
    dGreen[i + 1] = g;
    dGreen[i + 2] = g;
    dGreen[i + 3] = 255;

    dRed[i] = r;
    dRed[i + 1] = r;
    dRed[i + 2] = r;
    dRed[i + 3] = 255;

    const luma = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    dGray[i] = luma;
    dGray[i + 1] = luma;
    dGray[i + 2] = luma;
    dGray[i + 3] = 255;

    const invLuma = 255 - luma;
    dInv[i] = invLuma;
    dInv[i + 1] = invLuma;
    dInv[i + 2] = invLuma;
    dInv[i + 3] = 255;
  }

  versions.push({ data: blue, label: 'blue' });
  versions.push({ data: green, label: 'green' });
  versions.push({ data: red, label: 'red' });
  versions.push({ data: gray, label: 'gray' });
  versions.push({ data: inv, label: 'inverted' });

  return versions;
}
