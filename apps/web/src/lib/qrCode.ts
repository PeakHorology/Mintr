/**
 * A QR code encoder, written from ISO/IEC 18004: byte mode, error correction level M, versions
 * 1 to 40. Level M survives about 15% of the code being damaged, which is a fair margin for a
 * printed or burned surface without making the squares needlessly small.
 */

/** Error correction codewords per block at level M, by version. */
const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
/** Number of error correction blocks at level M, by version. */
const BLOCK_COUNT = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
/** Level M's two format bits. */
const FORMAT_BITS_M = 0;

/** Galois field GF(256) tables for the code's polynomial, 0x11D. */
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let value = 1;
  for (let power = 0; power < 255; power += 1) {
    GF_EXP[power] = value;
    GF_LOG[value] = power;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let power = 255; power < 512; power += 1) GF_EXP[power] = GF_EXP[power - 255];
}

function gfMultiply(left: number, right: number) {
  return left === 0 || right === 0 ? 0 : GF_EXP[GF_LOG[left] + GF_LOG[right]];
}

function reedSolomonDivisor(degree: number): Uint8Array {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let step = 0; step < degree; step += 1) {
    for (let index = 0; index < degree; index += 1) {
      result[index] = gfMultiply(result[index], root) ^ (index + 1 < degree ? result[index + 1] : 0);
    }
    root = gfMultiply(root, 2);
  }
  return result;
}

function reedSolomonRemainder(data: ArrayLike<number>, divisor: Uint8Array): Uint8Array {
  const result = new Uint8Array(divisor.length);
  for (let index = 0; index < data.length; index += 1) {
    const factor = data[index] ^ result[0];
    result.copyWithin(0, 1);
    result[result.length - 1] = 0;
    for (let term = 0; term < result.length; term += 1) result[term] ^= gfMultiply(divisor[term], factor);
  }
  return result;
}

function alignmentCentres(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const size = version * 4 + 17;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const centres = [6];
  for (let position = size - 7; centres.length < count; position -= step) centres.splice(1, 0, position);
  return centres;
}

/** Bits left for data and error correction once the fixed patterns are placed. */
function rawDataModules(version: number) {
  let bits = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const count = Math.floor(version / 7) + 2;
    bits -= (25 * count - 10) * count - 55;
    if (version >= 7) bits -= 36;
  }
  return bits;
}

function dataCodewords(version: number) {
  return Math.floor(rawDataModules(version) / 8) - ECC_PER_BLOCK[version] * BLOCK_COUNT[version];
}

/** The smallest version that holds this many bytes. */
function versionFor(byteCount: number): number | null {
  for (let version = 1; version <= 40; version += 1) {
    const lengthBits = version <= 9 ? 8 : 16;
    if (4 + lengthBits + byteCount * 8 <= dataCodewords(version) * 8) return version;
  }
  return null;
}

function dataStream(bytes: Uint8Array, version: number): Uint8Array {
  const capacity = dataCodewords(version);
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let bit = length - 1; bit >= 0; bit -= 1) bits.push((value >>> bit) & 1);
  };
  push(0b0100, 4); // Byte mode.
  push(bytes.length, version <= 9 ? 8 : 16);
  bytes.forEach((byte) => push(byte, 8));
  push(0, Math.min(4, capacity * 8 - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  const out = new Uint8Array(capacity);
  for (let index = 0; index < bits.length; index += 1) out[index >>> 3] |= bits[index] << (7 - (index & 7));
  // Pad with the two bytes the standard names.
  for (let index = bits.length >>> 3, pad = 0xec; index < capacity; index += 1, pad ^= 0xec ^ 0x11) out[index] = pad;
  return out;
}

/** Splits the data into blocks, adds each block's error correction, and interleaves them. */
function withErrorCorrection(data: Uint8Array, version: number): Uint8Array {
  const blockCount = BLOCK_COUNT[version];
  const eccLength = ECC_PER_BLOCK[version];
  const total = Math.floor(rawDataModules(version) / 8);
  const shortBlocks = blockCount - (total % blockCount);
  const shortLength = Math.floor(total / blockCount);
  const divisor = reedSolomonDivisor(eccLength);
  const blocks: { data: Uint8Array; ecc: Uint8Array }[] = [];
  let offset = 0;
  for (let index = 0; index < blockCount; index += 1) {
    const length = shortLength - eccLength + (index < shortBlocks ? 0 : 1);
    const part = data.slice(offset, offset + length);
    offset += length;
    blocks.push({ data: part, ecc: reedSolomonRemainder(part, divisor) });
  }
  const out: number[] = [];
  const longest = shortLength - eccLength + 1;
  for (let column = 0; column < longest; column += 1) {
    for (const block of blocks) if (column < block.data.length) out.push(block.data[column]);
  }
  for (let column = 0; column < eccLength; column += 1) {
    for (const block of blocks) out.push(block.ecc[column]);
  }
  return Uint8Array.from(out);
}

type Grid = { size: number; dark: boolean[][]; fixed: boolean[][] };

function setFixed(grid: Grid, x: number, y: number, dark: boolean) {
  grid.dark[y][x] = dark;
  grid.fixed[y][x] = true;
}

function drawFormatBits(grid: Grid, mask: number) {
  const data = (FORMAT_BITS_M << 3) | mask;
  let remainder = data;
  for (let step = 0; step < 10; step += 1) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  const bits = ((data << 10) | remainder) ^ 0x5412;
  const bit = (index: number) => ((bits >>> index) & 1) !== 0;
  const { size } = grid;
  for (let index = 0; index <= 5; index += 1) setFixed(grid, 8, index, bit(index));
  setFixed(grid, 8, 7, bit(6));
  setFixed(grid, 8, 8, bit(7));
  setFixed(grid, 7, 8, bit(8));
  for (let index = 9; index < 15; index += 1) setFixed(grid, 14 - index, 8, bit(index));
  for (let index = 0; index < 8; index += 1) setFixed(grid, size - 1 - index, 8, bit(index));
  for (let index = 8; index < 15; index += 1) setFixed(grid, 8, size - 15 + index, bit(index));
  setFixed(grid, 8, size - 8, true);
}

function drawFixedPatterns(grid: Grid, version: number) {
  const { size } = grid;
  for (let index = 0; index < size; index += 1) {
    setFixed(grid, 6, index, index % 2 === 0);
    setFixed(grid, index, 6, index % 2 === 0);
  }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        const ring = Math.max(Math.abs(dx), Math.abs(dy));
        setFixed(grid, x, y, ring !== 2 && ring !== 4);
      }
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  const centres = alignmentCentres(version);
  const last = centres.length - 1;
  centres.forEach((cy, row) => centres.forEach((cx, column) => {
    const onFinder = (row === 0 && column === 0) || (row === 0 && column === last) || (row === last && column === 0);
    if (onFinder) return;
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) setFixed(grid, cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }));
  drawFormatBits(grid, 0);
  if (version >= 7) {
    let remainder = version;
    for (let step = 0; step < 12; step += 1) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    const bits = (version << 12) | remainder;
    for (let index = 0; index < 18; index += 1) {
      const dark = ((bits >>> index) & 1) !== 0;
      const a = size - 11 + (index % 3);
      const b = Math.floor(index / 3);
      setFixed(grid, a, b, dark);
      setFixed(grid, b, a, dark);
    }
  }
}

function drawCodewords(grid: Grid, codewords: Uint8Array) {
  const { size, dark, fixed } = grid;
  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical += 1) {
      for (let column = 0; column < 2; column += 1) {
        const x = right - column;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        if (fixed[y][x] || bitIndex >= codewords.length * 8) continue;
        dark[y][x] = ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) !== 0;
        bitIndex += 1;
      }
    }
  }
}

function maskHit(mask: number, x: number, y: number) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

function applyMask(grid: Grid, mask: number) {
  for (let y = 0; y < grid.size; y += 1) {
    for (let x = 0; x < grid.size; x += 1) {
      if (!grid.fixed[y][x] && maskHit(mask, x, y)) grid.dark[y][x] = !grid.dark[y][x];
    }
  }
}

/** The standard's four penalty rules; the mask with the lowest score reads best. */
function penalty(grid: Grid) {
  const { size, dark } = grid;
  let score = 0;
  const lineScore = (read: (index: number) => boolean) => {
    let run = 1;
    for (let index = 1; index < size; index += 1) {
      if (read(index) === read(index - 1)) {
        run += 1;
      } else {
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
    if (run >= 5) score += run - 2;
    // A dark-light-dark-dark-dark-light-dark run next to four light squares looks like a finder.
    for (let index = 0; index + 10 < size; index += 1) {
      const window = Array.from({ length: 11 }, (_, step) => read(index + step));
      const matches = (pattern: number[]) => pattern.every((value, step) => window[step] === (value === 1));
      if (matches([1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0]) || matches([0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1])) score += 40;
    }
  };
  for (let index = 0; index < size; index += 1) {
    lineScore((step) => dark[index][step]);
    lineScore((step) => dark[step][index]);
  }
  let darkCount = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (dark[y][x]) darkCount += 1;
      if (y + 1 < size && x + 1 < size && dark[y][x] === dark[y][x + 1] && dark[y][x] === dark[y + 1][x] && dark[y][x] === dark[y + 1][x + 1]) score += 3;
    }
  }
  score += Math.floor(Math.abs(darkCount * 20 - size * size * 10) / (size * size)) * 10;
  return score;
}

/** The longest text that fits, in bytes. */
export const QR_MAX_BYTES = 2331;

/** The code's squares, `true` for dark, row by row from the top. Null when the text is too long or empty. */
export function encodeQr(text: string): boolean[][] | null {
  if (!text) return null;
  const bytes = new TextEncoder().encode(text);
  const version = versionFor(bytes.length);
  if (version === null) return null;
  const size = version * 4 + 17;
  const grid: Grid = {
    size,
    dark: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
    fixed: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
  };
  drawFixedPatterns(grid, version);
  drawCodewords(grid, withErrorCorrection(dataStream(bytes, version), version));
  let bestMask = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask += 1) {
    applyMask(grid, mask);
    drawFormatBits(grid, mask);
    const score = penalty(grid);
    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
    }
    applyMask(grid, mask); // Masking twice undoes it.
  }
  applyMask(grid, bestMask);
  drawFormatBits(grid, bestMask);
  return grid.dark;
}

/** A closed solid in squares: x across, y up, z down the code from its top row. */
export type QrSolid = { positions: number[]; indices: number[] };

/**
 * The dark squares as one closed solid, built square by square. Triangulating merged outlines
 * would be fewer triangles, but a grid is full of points in a line, and a triangulator skips those,
 * leaving hairline splits in the mesh that booleans refuse.
 *
 * Two dark squares that touch only at a corner would meet at a single point, which is not a valid
 * solid. Each pulls its corner in by `cornerGap` of a square, far too small to see or scan.
 */
export function qrSolid(squares: readonly (readonly boolean[])[], height: number, cornerGap = 0.02): QrSolid {
  const size = squares.length;
  const dark = (x: number, y: number) => x >= 0 && y >= 0 && x < size && y < size && squares[y][x];
  const positions: number[] = [];
  const indices: number[] = [];
  const ids = new Map<string, number>();
  /** A corner's vertex for one square, shared with its neighbours unless they touch only there. */
  const vertex = (cellX: number, cellY: number, nodeX: number, nodeY: number, top: boolean) => {
    const opposite = dark(nodeX * 2 - cellX - 1, nodeY * 2 - cellY - 1);
    const sideA = dark(nodeX * 2 - cellX - 1, cellY);
    const sideB = dark(cellX, nodeY * 2 - cellY - 1);
    const pinched = opposite && !sideA && !sideB;
    const key = pinched ? `${nodeX},${nodeY},${cellX},${cellY},${top}` : `${nodeX},${nodeY},${top}`;
    const known = ids.get(key);
    if (known !== undefined) return known;
    const pull = pinched ? cornerGap : 0;
    positions.push(nodeX + (cellX + 0.5 - nodeX) * 2 * pull, top ? height : 0, nodeY + (cellY + 0.5 - nodeY) * 2 * pull);
    ids.set(key, positions.length / 3 - 1);
    return positions.length / 3 - 1;
  };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!dark(x, y)) continue;
      const corners: [number, number][] = [[x, y], [x, y + 1], [x + 1, y + 1], [x + 1, y]];
      const top = corners.map(([nodeX, nodeY]) => vertex(x, y, nodeX, nodeY, true));
      const bottom = corners.map(([nodeX, nodeY]) => vertex(x, y, nodeX, nodeY, false));
      indices.push(top[0], top[1], top[2], top[0], top[2], top[3]);
      indices.push(bottom[0], bottom[2], bottom[1], bottom[0], bottom[3], bottom[2]);
      // Left, front, right and back: a wall wherever the neighbour is light.
      const neighbours: [number, number][] = [[x - 1, y], [x, y + 1], [x + 1, y], [x, y - 1]];
      neighbours.forEach(([nextX, nextY], side) => {
        if (dark(nextX, nextY)) return;
        const from = side;
        const to = (side + 1) % 4;
        indices.push(top[to], top[from], bottom[from], top[to], bottom[from], bottom[to]);
      });
    }
  }
  return { positions, indices };
}
