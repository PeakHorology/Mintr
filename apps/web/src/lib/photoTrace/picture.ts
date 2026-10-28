import { applyHomography, homographyFrom, type Point } from "@/lib/photoTrace/geometry";

/** RGBA pixels. */
export type Rgba = { width: number; height: number; data: Uint8ClampedArray };

/**
 * The resolution a picture says it was saved at, in dots per inch, or null.
 * Scanners write it: PNG keeps it in a pHYs chunk, JPEG in its JFIF header or EXIF.
 */
export function pictureDpi(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // PNG
  if (bytes.length > 16 && view.getUint32(0) === 0x89504e47) {
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset);
      const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      if (type === "pHYs" && length >= 9) {
        const perMetreX = view.getUint32(offset + 8);
        const unit = bytes[offset + 16];
        return unit === 1 && perMetreX > 0 ? perMetreX * 0.0254 : null;
      }
      if (type === "IDAT" || type === "IEND") return null;
      offset += 12 + length;
    }
    return null;
  }
  // JPEG
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    let jfif: number | null = null;
    while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
      const marker = bytes[offset + 1];
      const length = view.getUint16(offset + 2);
      const body = offset + 4;
      if (marker === 0xe0 && String.fromCharCode(...bytes.subarray(body, body + 4)) === "JFIF") {
        const units = bytes[body + 7];
        const density = view.getUint16(body + 8);
        if (density > 1 && units === 1) jfif = density;
        else if (density > 1 && units === 2) jfif = density * 2.54;
      }
      if (marker === 0xe1 && String.fromCharCode(...bytes.subarray(body, body + 4)) === "Exif") {
        const exif = exifDpi(view, body + 6);
        if (exif) return exif;
      }
      if (marker === 0xda) break;
      offset += 2 + length;
    }
    return jfif;
  }
  return null;
}

function exifDpi(view: DataView, tiff: number): number | null {
  try {
    const little = view.getUint16(tiff) === 0x4949;
    const u16 = (at: number) => view.getUint16(at, little);
    const u32 = (at: number) => view.getUint32(at, little);
    const ifd = tiff + u32(tiff + 4);
    const count = u16(ifd);
    let resolution: number | null = null;
    let unit = 2;
    for (let index = 0; index < count; index += 1) {
      const entry = ifd + 2 + index * 12;
      const tag = u16(entry);
      if (tag === 0x011a) {
        const at = tiff + u32(entry + 8);
        const denominator = u32(at + 4);
        resolution = denominator ? u32(at) / denominator : null;
      } else if (tag === 0x0128) {
        unit = u16(entry + 8);
      }
    }
    // Cameras write 72 dpi for every photo; only a real figure means a scan.
    if (!resolution || resolution <= 72) return null;
    return unit === 3 ? resolution * 2.54 : resolution;
  } catch {
    return null;
  }
}

/**
 * Reads a picture file, turned the right way up, at most `maxSide` pixels on its long side.
 * `scale` is how much it was shrunk, so a scan's own resolution still gives true size.
 */
export async function readPicture(file: Blob, maxSide: number): Promise<Rgba & { scale: number }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("This browser cannot read pictures");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const pixels = context.getImageData(0, 0, width, height);
  return { width, height, data: pixels.data, scale };
}

/** Bilinear colour at a fractional pixel; outside the picture reads as transparent. */
function sample(source: Rgba, x: number, y: number, out: Uint8ClampedArray, at: number) {
  if (x < 0 || y < 0 || x > source.width - 1 || y > source.height - 1) {
    out[at] = out[at + 1] = out[at + 2] = out[at + 3] = 0;
    return;
  }
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(source.width - 1, x0 + 1);
  const y1 = Math.min(source.height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  for (let channel = 0; channel < 4; channel += 1) {
    const a = source.data[(y0 * source.width + x0) * 4 + channel];
    const b = source.data[(y0 * source.width + x1) * 4 + channel];
    const c = source.data[(y1 * source.width + x0) * 4 + channel];
    const d = source.data[(y1 * source.width + x1) * 4 + channel];
    out[at + channel] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
}

/**
 * Straightens the sheet of paper in a photo into a top-down picture where every pixel is
 * `mmPerPixel` square. The four corners run top-left, top-right, bottom-right, bottom-left.
 */
export function straightenPaper(source: Rgba, corners: readonly Point[], paper: { width: number; height: number }, mmPerPixel: number) {
  const width = Math.max(1, Math.round(paper.width / mmPerPixel));
  const height = Math.max(1, Math.round(paper.height / mmPerPixel));
  // Map from the straight picture back into the photo, so each new pixel looks up its colour.
  const back = homographyFrom(
    [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }],
    corners,
  );
  if (!back) return null;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from = applyHomography(back, { x: x + 0.5, y: y + 0.5 });
      sample(source, from.x - 0.5, from.y - 0.5, data, (y * width + x) * 4);
    }
  }
  return { width, height, data } satisfies Rgba;
}

/**
 * Resizes a picture to new pixel counts across and down, so a photo measured as stretched
 * comes out with square pixels.
 */
export function resizePicture(source: Rgba, width: number, height: number): Rgba {
  const data = new Uint8ClampedArray(width * height * 4);
  const sx = source.width / width;
  const sy = source.height / height;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      sample(source, Math.min(source.width - 1, (x + 0.5) * sx - 0.5), Math.min(source.height - 1, (y + 0.5) * sy - 0.5), data, (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

/** A picture's pixels as a canvas image, for drawing. */
export function pictureToCanvas(picture: Rgba) {
  const canvas = document.createElement("canvas");
  canvas.width = picture.width;
  canvas.height = picture.height;
  canvas.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(picture.data), picture.width, picture.height), 0, 0);
  return canvas;
}
