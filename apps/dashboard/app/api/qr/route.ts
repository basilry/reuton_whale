import { NextResponse } from "next/server";

export const runtime = "nodejs";

const QR_SIZE = 25;
const QR_MARGIN = 4;
const DATA_CODEWORDS = 34;
const ECC_CODEWORDS = 10;
const MAX_DATA_BYTES = 32;
const FORMAT_MASK = 0x5412;
const FORMAT_POLYNOMIAL = 0x537;
const GALOIS_FIELD_POLYNOMIAL = 0x11d;
const GALOIS_FIELD_SIZE = 256;

type Matrix = (boolean | null)[][];

const gfExp = new Uint8Array(512);
const gfLog = new Uint8Array(GALOIS_FIELD_SIZE);

function initializeGaloisField() {
  let value = 1;
  for (let i = 0; i < 255; i += 1) {
    gfExp[i] = value;
    gfLog[value] = i;
    value <<= 1;
    if (value & 0x100) {
      value ^= GALOIS_FIELD_POLYNOMIAL;
    }
  }

  for (let i = 255; i < gfExp.length; i += 1) {
    gfExp[i] = gfExp[i - 255];
  }
}

initializeGaloisField();

function gfMultiply(left: number, right: number): number {
  if (left === 0 || right === 0) {
    return 0;
  }

  return gfExp[gfLog[left] + gfLog[right]];
}

function multiplyPolynomials(left: number[], right: number[]): number[] {
  const result = new Array(left.length + right.length - 1).fill(0);

  for (let i = 0; i < left.length; i += 1) {
    for (let j = 0; j < right.length; j += 1) {
      result[i + j] ^= gfMultiply(left[i], right[j]);
    }
  }

  return result;
}

function buildGeneratorPolynomial(degree: number): number[] {
  let polynomial = [1];

  for (let i = 0; i < degree; i += 1) {
    polynomial = multiplyPolynomials(polynomial, [1, gfExp[i]]);
  }

  return polynomial;
}

function encodeErrorCorrection(dataCodewords: number[], eccCodewords: number): number[] {
  const generator = buildGeneratorPolynomial(eccCodewords);
  const buffer = new Array(dataCodewords.length + eccCodewords).fill(0);

  for (let i = 0; i < dataCodewords.length; i += 1) {
    buffer[i] = dataCodewords[i];
  }

  for (let i = 0; i < dataCodewords.length; i += 1) {
    const factor = buffer[i];
    if (factor === 0) {
      continue;
    }

    for (let j = 1; j < generator.length; j += 1) {
      buffer[i + j] ^= gfMultiply(generator[j], factor);
    }
  }

  return buffer.slice(dataCodewords.length);
}

function appendBits(bits: number[], value: number, length: number) {
  for (let i = length - 1; i >= 0; i -= 1) {
    bits.push((value >> i) & 1);
  }
}

function encodeDataCodewords(text: string): number[] {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > MAX_DATA_BYTES) {
    throw new Error("QR payload exceeds version 2-L capacity.");
  }

  const bits: number[] = [];
  appendBits(bits, 0b0100, 4);
  appendBits(bits, bytes.length, 8);

  for (const byte of bytes) {
    appendBits(bits, byte, 8);
  }

  const totalDataBits = DATA_CODEWORDS * 8;
  const terminatorLength = Math.min(4, Math.max(0, totalDataBits - bits.length));
  for (let i = 0; i < terminatorLength; i += 1) {
    bits.push(0);
  }

  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  const dataCodewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let codeword = 0;
    for (let j = 0; j < 8; j += 1) {
      codeword = (codeword << 1) | bits[i + j];
    }
    dataCodewords.push(codeword);
  }

  let padByte = 0xec;
  while (dataCodewords.length < DATA_CODEWORDS) {
    dataCodewords.push(padByte);
    padByte = padByte === 0xec ? 0x11 : 0xec;
  }

  return dataCodewords;
}

function createMatrix(): Matrix {
  return Array.from({ length: QR_SIZE }, () => Array.from({ length: QR_SIZE }, () => null));
}

function createReservedMatrix(): boolean[][] {
  return Array.from({ length: QR_SIZE }, () => Array.from({ length: QR_SIZE }, () => false));
}

function inBounds(x: number, y: number): boolean {
  return x >= 0 && x < QR_SIZE && y >= 0 && y < QR_SIZE;
}

function setFixedModule(
  matrix: Matrix,
  reserved: boolean[][],
  x: number,
  y: number,
  value: boolean,
) {
  if (!inBounds(x, y)) {
    return;
  }

  matrix[y][x] = value;
  reserved[y][x] = true;
}

function reserveModule(matrix: Matrix, reserved: boolean[][], x: number, y: number) {
  if (!inBounds(x, y) || reserved[y][x]) {
    return;
  }

  matrix[y][x] = false;
  reserved[y][x] = true;
}

function placeFinderPattern(matrix: Matrix, reserved: boolean[][], x: number, y: number) {
  for (let row = 0; row < 7; row += 1) {
    for (let col = 0; col < 7; col += 1) {
      const dark =
        row === 0 ||
        row === 6 ||
        col === 0 ||
        col === 6 ||
        (row >= 2 && row <= 4 && col >= 2 && col <= 4);
      setFixedModule(matrix, reserved, x + col, y + row, dark);
    }
  }

  for (let offset = -1; offset <= 7; offset += 1) {
    reserveModule(matrix, reserved, x + offset, y - 1);
    reserveModule(matrix, reserved, x - 1, y + offset);
    reserveModule(matrix, reserved, x + 7, y + offset);
    reserveModule(matrix, reserved, x + offset, y + 7);
  }
}

function placeAlignmentPattern(matrix: Matrix, reserved: boolean[][], x: number, y: number) {
  for (let row = -2; row <= 2; row += 1) {
    for (let col = -2; col <= 2; col += 1) {
      const dark =
        Math.max(Math.abs(row), Math.abs(col)) === 2 || (row === 0 && col === 0);
      setFixedModule(matrix, reserved, x + col, y + row, dark);
    }
  }
}

function reserveFormatInfoArea(matrix: Matrix, reserved: boolean[][]) {
  for (let i = 0; i <= 5; i += 1) {
    reserveModule(matrix, reserved, 8, i);
  }
  reserveModule(matrix, reserved, 8, 7);
  reserveModule(matrix, reserved, 8, 8);
  reserveModule(matrix, reserved, 7, 8);
  for (let i = 0; i <= 5; i += 1) {
    reserveModule(matrix, reserved, 5 - i, 8);
  }

  for (let i = 0; i <= 7; i += 1) {
    reserveModule(matrix, reserved, QR_SIZE - 1 - i, 8);
  }

  for (let i = 0; i <= 6; i += 1) {
    reserveModule(matrix, reserved, 8, QR_SIZE - 7 + i);
  }
}

function placeFunctionPatterns(matrix: Matrix, reserved: boolean[][]) {
  placeFinderPattern(matrix, reserved, 0, 0);
  placeFinderPattern(matrix, reserved, QR_SIZE - 7, 0);
  placeFinderPattern(matrix, reserved, 0, QR_SIZE - 7);

  for (let i = 8; i < QR_SIZE - 8; i += 1) {
    const value = (i - 8) % 2 === 0;
    setFixedModule(matrix, reserved, i, 6, value);
    setFixedModule(matrix, reserved, 6, i, value);
  }

  placeAlignmentPattern(matrix, reserved, 18, 18);
  setFixedModule(matrix, reserved, 8, QR_SIZE - 8, true);
  reserveFormatInfoArea(matrix, reserved);
}

function placeDataBits(matrix: Matrix, reserved: boolean[][], bits: number[]) {
  let bitIndex = 0;
  let upward = true;

  for (let column = QR_SIZE - 1; column > 0; ) {
    if (column === 6) {
      column -= 1;
    }

    for (let offset = 0; offset < QR_SIZE; offset += 1) {
      const row = upward ? QR_SIZE - 1 - offset : offset;

      for (const col of [column, column - 1]) {
        if (reserved[row][col]) {
          continue;
        }

        if (bitIndex < bits.length) {
          matrix[row][col] = bits[bitIndex] === 1;
          bitIndex += 1;
        } else {
          matrix[row][col] = false;
        }
      }
    }

    upward = !upward;
    column -= 2;
  }

  if (bitIndex !== bits.length) {
    throw new Error("QR placement did not consume the expected number of bits.");
  }
}

function maskCondition(maskId: number, row: number, col: number): boolean {
  switch (maskId) {
    case 0:
      return (row + col) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return col % 3 === 0;
    case 3:
      return (row + col) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6:
      return ((((row * col) % 2) + ((row * col) % 3)) % 2) === 0;
    case 7:
      return ((((row + col) % 2) + ((row * col) % 3)) % 2) === 0;
    default:
      return false;
  }
}

function cloneMatrix(matrix: Matrix): Matrix {
  return matrix.map((row) => row.slice());
}

function applyMask(matrix: Matrix, reserved: boolean[][], maskId: number) {
  for (let row = 0; row < QR_SIZE; row += 1) {
    for (let col = 0; col < QR_SIZE; col += 1) {
      if (reserved[row][col]) {
        continue;
      }

      if (maskCondition(maskId, row, col)) {
        matrix[row][col] = !(matrix[row][col] ?? false);
      }
    }
  }
}

function computeFormatBits(maskId: number): number {
  const format = (0b01 << 3) | maskId;
  let value = format << 10;

  for (let bit = 14; bit >= 10; bit -= 1) {
    if (((value >> bit) & 1) === 1) {
      value ^= FORMAT_POLYNOMIAL << (bit - 10);
    }
  }

  return ((format << 10) | (value & 0x3ff)) ^ FORMAT_MASK;
}

function placeFormatBits(matrix: Matrix, maskId: number) {
  const bits = computeFormatBits(maskId);
  const firstCopy = [
    [8, 0],
    [8, 1],
    [8, 2],
    [8, 3],
    [8, 4],
    [8, 5],
    [8, 7],
    [8, 8],
    [7, 8],
    [5, 8],
    [4, 8],
    [3, 8],
    [2, 8],
    [1, 8],
    [0, 8],
  ];

  const secondCopy = [
    [QR_SIZE - 1, 8],
    [QR_SIZE - 2, 8],
    [QR_SIZE - 3, 8],
    [QR_SIZE - 4, 8],
    [QR_SIZE - 5, 8],
    [QR_SIZE - 6, 8],
    [QR_SIZE - 7, 8],
    [QR_SIZE - 8, 8],
    [8, QR_SIZE - 7],
    [8, QR_SIZE - 6],
    [8, QR_SIZE - 5],
    [8, QR_SIZE - 4],
    [8, QR_SIZE - 3],
    [8, QR_SIZE - 2],
    [8, QR_SIZE - 1],
  ];

  for (let i = 0; i < firstCopy.length; i += 1) {
    const [x, y] = firstCopy[i];
    matrix[y][x] = ((bits >> (14 - i)) & 1) === 1;
  }

  for (let i = 0; i < secondCopy.length; i += 1) {
    const [x, y] = secondCopy[i];
    matrix[y][x] = ((bits >> (14 - i)) & 1) === 1;
  }
}

function scoreMatrix(matrix: Matrix): number {
  let penalty = 0;

  for (let row = 0; row < QR_SIZE; row += 1) {
    let runColor = matrix[row][0] ?? false;
    let runLength = 1;

    for (let col = 1; col < QR_SIZE; col += 1) {
      const color = matrix[row][col] ?? false;
      if (color === runColor) {
        runLength += 1;
      } else {
        if (runLength >= 5) {
          penalty += 3 + (runLength - 5);
        }
        runColor = color;
        runLength = 1;
      }
    }

    if (runLength >= 5) {
      penalty += 3 + (runLength - 5);
    }
  }

  for (let col = 0; col < QR_SIZE; col += 1) {
    let runColor = matrix[0][col] ?? false;
    let runLength = 1;

    for (let row = 1; row < QR_SIZE; row += 1) {
      const color = matrix[row][col] ?? false;
      if (color === runColor) {
        runLength += 1;
      } else {
        if (runLength >= 5) {
          penalty += 3 + (runLength - 5);
        }
        runColor = color;
        runLength = 1;
      }
    }

    if (runLength >= 5) {
      penalty += 3 + (runLength - 5);
    }
  }

  for (let row = 0; row < QR_SIZE - 1; row += 1) {
    for (let col = 0; col < QR_SIZE - 1; col += 1) {
      const color = matrix[row][col] ?? false;
      if (
        color === (matrix[row][col + 1] ?? false) &&
        color === (matrix[row + 1][col] ?? false) &&
        color === (matrix[row + 1][col + 1] ?? false)
      ) {
        penalty += 3;
      }
    }
  }

  const pattern = [true, false, true, true, true, false, true];
  const scanLine = (getter: (index: number) => boolean) => {
    for (let index = 0; index <= QR_SIZE - 7; index += 1) {
      let matches = true;
      for (let offset = 0; offset < pattern.length; offset += 1) {
        if ((getter(index + offset) ?? false) !== pattern[offset]) {
          matches = false;
          break;
        }
      }

      if (!matches) {
        continue;
      }

      const before = index >= 4
        ? [index - 4, index - 3, index - 2, index - 1].every((item) => !getter(item))
        : false;
      const after = index + 11 <= QR_SIZE
        ? [index + 7, index + 8, index + 9, index + 10].every((item) => !getter(item))
        : false;

      if (before || after) {
        penalty += 40;
      }
    }
  };

  for (let row = 0; row < QR_SIZE; row += 1) {
    scanLine((col) => matrix[row][col] ?? false);
  }

  for (let col = 0; col < QR_SIZE; col += 1) {
    scanLine((row) => matrix[row][col] ?? false);
  }

  let darkCount = 0;
  for (let row = 0; row < QR_SIZE; row += 1) {
    for (let col = 0; col < QR_SIZE; col += 1) {
      if (matrix[row][col]) {
        darkCount += 1;
      }
    }
  }

  const percent = (darkCount * 100) / (QR_SIZE * QR_SIZE);
  penalty += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return penalty;
}

function buildSvg(matrix: Matrix): string {
  const totalSize = QR_SIZE + QR_MARGIN * 2;
  const cells: string[] = [];

  for (let row = 0; row < QR_SIZE; row += 1) {
    for (let col = 0; col < QR_SIZE; col += 1) {
      if (!matrix[row][col]) {
        continue;
      }

      cells.push(
        `<rect x="${col + QR_MARGIN}" y="${row + QR_MARGIN}" width="1" height="1" />`,
      );
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalSize} ${totalSize}" width="240" height="240" role="img" aria-label="Telegram QR code" shape-rendering="crispEdges">\n<rect width="${totalSize}" height="${totalSize}" fill="#ffffff"/>\n<g fill="#000000">\n${cells.join("\n")}\n</g>\n</svg>\n`;
}

function buildQrSvg(text: string): string {
  const dataCodewords = encodeDataCodewords(text);
  const eccCodewords = encodeErrorCorrection(dataCodewords, ECC_CODEWORDS);
  const allCodewords = [...dataCodewords, ...eccCodewords];
  const bits: number[] = [];

  for (const codeword of allCodewords) {
    appendBits(bits, codeword, 8);
  }

  const baseMatrix = createMatrix();
  const reserved = createReservedMatrix();
  placeFunctionPatterns(baseMatrix, reserved);
  placeDataBits(baseMatrix, reserved, bits);

  let bestMatrix: Matrix | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let maskId = 0; maskId < 8; maskId += 1) {
    const candidate = cloneMatrix(baseMatrix);
    applyMask(candidate, reserved, maskId);
    placeFormatBits(candidate, maskId);

    const score = scoreMatrix(candidate);
    if (score < bestScore) {
      bestScore = score;
      bestMatrix = candidate;
    }
  }

  if (!bestMatrix) {
    throw new Error("Failed to select a QR mask.");
  }

  return buildSvg(bestMatrix);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const text = url.searchParams.get("data")?.trim() ?? url.searchParams.get("url")?.trim() ?? "";

  if (!text) {
    return NextResponse.json(
      { error: "invalid-qr-request" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const svg = buildQrSvg(text);
    return new NextResponse(svg, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "image/svg+xml; charset=utf-8",
      },
    });
  } catch (error) {
    console.error("[api/qr]", error instanceof Error ? error.message : String(error));
    return NextResponse.json(
      { error: "unable-to-generate-qr" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
