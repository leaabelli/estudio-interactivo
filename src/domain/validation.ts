import {
  DIFFICULTIES,
  type CompletedRun,
  type Difficulty,
  type QuestionProgress,
  type StudyAnswer,
  type StudyQuestion,
  type StudySnapshot
} from "./types";
import {
  canonicalUtf8ByteLength,
  type CanonicalJsonValue
} from "./canonical";

export const MAX_SOURCE_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024;
export const MAX_MODULE_BYTES = 6 * 1024 * 1024;
export const MAX_PROGRESS_BYTES = Math.floor(3.5 * 1024 * 1024);
export const MAX_QUESTION_MEDIA_BYTES = 512 * 1024;
export const MAX_QUESTION_MEDIA_PIXELS = 8_000_000;
export const MAX_COUNTER = Number.MAX_SAFE_INTEGER - 1;

const MAX_ERRORS = 200;
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const LANGUAGE_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;
const TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/;
const MEDIA_DATA_URI_PATTERN = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/;
const VISIBLE_TEXT_PATTERN = /[\p{L}\p{N}\p{P}\p{S}]/u;
const DEFAULT_IGNORABLE_TEXT_PATTERN = /\p{Default_Ignorable_Code_Point}/gu;
const hasOwn = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

export interface ValidationError {
  path: string;
  message: string;
}

export type ValidationResult<T = StudySnapshot> =
  | { ok: true; value: T }
  | { ok: false; errors: ValidationError[] };

type UnknownRecord = Record<string, unknown>;

class Errors {
  readonly values: ValidationError[] = [];

  add(path: string, message: string): void {
    if (this.values.length < MAX_ERRORS) {
      this.values.push({ path, message });
    }
  }

  get any(): boolean {
    return this.values.length > 0;
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[],
  errors: Errors
): UnknownRecord | null {
  if (!isRecord(value)) {
    errors.add(path, "debe ser un objeto");
    return null;
  }

  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      errors.add(`${path}.${key}`, "la propiedad no está permitida");
    }
  }
  for (const key of required) {
    if (!hasOwn(value, key)) {
      errors.add(`${path}.${key}`, "la propiedad es obligatoria");
    }
  }
  return value;
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function stringInRange(
  value: unknown,
  path: string,
  min: number,
  max: number,
  errors: Errors
): value is string {
  if (typeof value !== "string") {
    errors.add(path, "debe ser texto");
    return false;
  }
  const length = codePointLength(value);
  if (length < min || length > max) {
    errors.add(path, `debe tener entre ${min} y ${max} caracteres Unicode`);
    return false;
  }
  return true;
}

function nonBlankStringInRange(
  value: unknown,
  path: string,
  min: number,
  max: number,
  errors: Errors
): value is string {
  if (!stringInRange(value, path, min, max, errors)) return false;
  if (!VISIBLE_TEXT_PATTERN.test(value.replace(DEFAULT_IGNORABLE_TEXT_PATTERN, ""))) {
    errors.add(path, "debe incluir al menos un carácter visible");
    return false;
  }
  return true;
}

function id(value: unknown, path: string, errors: Errors): value is string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    errors.add(path, "debe cumplir [a-z0-9][a-z0-9._-]{0,63}");
    return false;
  }
  return true;
}

function integerInRange(
  value: unknown,
  path: string,
  min: number,
  max: number,
  errors: Errors
): value is number {
  if (!Number.isInteger(value) || typeof value !== "number" || value < min || value > max) {
    errors.add(path, `debe ser un entero entre ${min} y ${max}`);
    return false;
  }
  return true;
}

function counter(value: unknown, path: string, errors: Errors): value is number {
  return integerInRange(value, path, 0, MAX_COUNTER, errors);
}

function positiveRevision(value: unknown, path: string, errors: Errors): value is number {
  return integerInRange(value, path, 1, MAX_COUNTER, errors);
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function validTimestamp(value: unknown, path: string, errors: Errors): value is string {
  if (typeof value !== "string") {
    errors.add(path, "debe ser una fecha RFC 3339 UTC terminada en Z");
    return false;
  }
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match) {
    errors.add(path, "debe ser una fecha RFC 3339 UTC terminada en Z");
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const daysByMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maxDay = daysByMonth[month - 1] ?? 0;
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > maxDay ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    errors.add(path, "contiene una fecha u hora imposible");
    return false;
  }
  return true;
}

function timestampMillis(value: string): number {
  return Date.parse(value);
}

function literal(
  value: unknown,
  expected: string | number | null,
  path: string,
  errors: Errors
): boolean {
  if (value !== expected) {
    errors.add(path, `debe ser ${JSON.stringify(expected)}`);
    return false;
  }
  return true;
}

function oneOfStrings(
  value: unknown,
  values: readonly string[],
  path: string,
  errors: Errors
): value is string {
  if (typeof value !== "string" || !values.includes(value)) {
    errors.add(path, `debe ser uno de: ${values.join(", ")}`);
    return false;
  }
  return true;
}

interface ImageDimensions {
  width: number;
  height: number;
}

function bytesMatch(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function asciiMatch(bytes: Uint8Array, offset: number, expected: string): boolean {
  return Array.from(expected).every((value, index) => bytes[offset + index] === value.charCodeAt(0));
}

function uint16BigEndian(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function uint16LittleEndian(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function uint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

function uint32BigEndian(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) * 0x1000000) +
    ((bytes[offset + 1] ?? 0) << 16) +
    ((bytes[offset + 2] ?? 0) << 8) +
    (bytes[offset + 3] ?? 0)
  );
}

function uint32LittleEndian(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) +
    ((bytes[offset + 1] ?? 0) << 8) +
    ((bytes[offset + 2] ?? 0) << 16) +
    ((bytes[offset + 3] ?? 0) * 0x1000000)
  );
}

function tiffOrientation(
  bytes: Uint8Array,
  tiffStart: number,
  dataEnd: number
): number | null {
  if (dataEnd - tiffStart < 8) return null;
  const littleEndian = bytesMatch(bytes, tiffStart, [0x49, 0x49]);
  const bigEndian = bytesMatch(bytes, tiffStart, [0x4d, 0x4d]);
  if (!littleEndian && !bigEndian) return null;
  const read16 = (offset: number): number => littleEndian
    ? uint16LittleEndian(bytes, offset)
    : uint16BigEndian(bytes, offset);
  const read32 = (offset: number): number => littleEndian
    ? uint32LittleEndian(bytes, offset)
    : uint32BigEndian(bytes, offset);
  if (read16(tiffStart + 2) !== 42) return null;

  const ifdOffset = read32(tiffStart + 4);
  if (ifdOffset < 8 || ifdOffset > dataEnd - tiffStart - 2) return null;
  const ifdStart = tiffStart + ifdOffset;
  const entryCount = read16(ifdStart);
  if (entryCount > Math.floor((dataEnd - ifdStart - 2) / 12)) return null;
  for (let index = 0; index < entryCount; index += 1) {
    const entryStart = ifdStart + 2 + (index * 12);
    if (read16(entryStart) !== 0x0112) continue;
    if (read16(entryStart + 2) !== 3 || read32(entryStart + 4) !== 1) return null;
    const orientation = read16(entryStart + 8);
    return orientation >= 1 && orientation <= 8 ? orientation : null;
  }
  return 1;
}

function jpegExifOrientation(
  bytes: Uint8Array,
  dataStart: number,
  dataEnd: number
): number | null | undefined {
  if (
    dataEnd - dataStart < 6 ||
    !bytesMatch(bytes, dataStart, [0x45, 0x78, 0x69, 0x66, 0x00, 0x00])
  ) return undefined;
  return tiffOrientation(bytes, dataStart + 6, dataEnd);
}

function crc32Range(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let offset = start; offset < end; offset += 1) {
    crc ^= bytes[offset]!;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (
    bytes.length < 57 ||
    !bytesMatch(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ) return null;

  let offset = 8;
  let dimensions: ImageDimensions | null = null;
  let colorType: number | null = null;
  let sawPalette = false;
  let sawImageData = false;
  let imageDataBytes = 0;
  const imageDataPrefix: number[] = [];
  let imageDataClosed = false;
  let chunkIndex = 0;
  let exifOrientation = 1;
  let sawExifOrientation = false;

  while (offset + 12 <= bytes.length) {
    const dataLength = uint32BigEndian(bytes, offset);
    const dataStart = offset + 8;
    if (dataLength > bytes.length - dataStart - 4) return null;
    const dataEnd = dataStart + dataLength;
    const chunkEnd = dataEnd + 4;
    const typeOffset = offset + 4;
    const typeBytes = bytes.subarray(typeOffset, typeOffset + 4);
    if (!Array.from(typeBytes).every((byte) =>
      (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a))) return null;
    if (typeBytes[2]! >= 0x61 && typeBytes[2]! <= 0x7a) return null;
    if (crc32Range(bytes, typeOffset, dataEnd) !== uint32BigEndian(bytes, dataEnd)) return null;

    const chunkType = String.fromCharCode(...typeBytes);
    if (chunkIndex === 0 && chunkType !== "IHDR") return null;
    if (chunkType === "acTL" || chunkType === "fcTL" || chunkType === "fdAT") return null;
    if (sawImageData && chunkType !== "IDAT" && chunkType !== "IEND") {
      imageDataClosed = true;
    }

    if (chunkType === "IHDR") {
      if (chunkIndex !== 0 || dataLength !== 13 || dimensions) return null;
      const width = uint32BigEndian(bytes, dataStart);
      const height = uint32BigEndian(bytes, dataStart + 4);
      const bitDepth = bytes[dataStart + 8]!;
      colorType = bytes[dataStart + 9]!;
      const validDepths: Readonly<Record<number, readonly number[]>> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16]
      };
      if (
        width < 1 ||
        height < 1 ||
        !validDepths[colorType]?.includes(bitDepth) ||
        bytes[dataStart + 10] !== 0 ||
        bytes[dataStart + 11] !== 0 ||
        ![0, 1].includes(bytes[dataStart + 12]!)
      ) return null;
      dimensions = { width, height };
    } else if (chunkType === "PLTE") {
      if (!dimensions || sawPalette || sawImageData || dataLength < 3 || dataLength > 768 || dataLength % 3 !== 0) {
        return null;
      }
      if (colorType === 0 || colorType === 4) return null;
      sawPalette = true;
    } else if (chunkType === "eXIf") {
      if (!dimensions || sawImageData || sawExifOrientation) return null;
      const orientation = tiffOrientation(bytes, dataStart, dataEnd);
      if (orientation === null) return null;
      exifOrientation = orientation;
      sawExifOrientation = true;
    } else if (chunkType === "IDAT") {
      if (!dimensions || imageDataClosed || (colorType === 3 && !sawPalette)) return null;
      sawImageData = true;
      imageDataBytes += dataLength;
      for (let index = 0; index < dataLength && imageDataPrefix.length < 2; index += 1) {
        imageDataPrefix.push(bytes[dataStart + index]!);
      }
    } else if (chunkType === "IEND") {
      if (
        !dimensions ||
        dataLength !== 0 ||
        !sawImageData ||
        imageDataBytes < 8 ||
        imageDataPrefix.length < 2 ||
        (imageDataPrefix[0]! & 0x0f) !== 8 ||
        (imageDataPrefix[0]! >> 4) > 7 ||
        ((imageDataPrefix[0]! << 8) + imageDataPrefix[1]!) % 31 !== 0 ||
        (imageDataPrefix[1]! & 0x20) !== 0 ||
        (colorType === 3 && !sawPalette) ||
        chunkEnd !== bytes.length
      ) return null;
      return exifOrientation >= 5
        ? { width: dimensions.height, height: dimensions.width }
        : dimensions;
    } else if (typeBytes[0]! >= 0x41 && typeBytes[0]! <= 0x5a) {
      return null;
    }

    offset = chunkEnd;
    chunkIndex += 1;
  }
  return null;
}

function jpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const startOfFrameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  let dimensions: ImageDimensions | null = null;
  let inScan = false;
  let sawScan = false;
  let scanDataBytes = 0;
  let exifOrientation = 1;
  let sawExifOrientation = false;

  while (offset < bytes.length) {
    let marker: number | undefined;
    if (inScan) {
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) {
          scanDataBytes += 1;
          offset += 1;
          continue;
        }
        offset += 1;
        while (bytes[offset] === 0xff) offset += 1;
        marker = bytes[offset];
        offset += 1;
        if (marker === 0x00) {
          scanDataBytes += 1;
          marker = undefined;
          continue;
        }
        if (marker !== undefined && marker >= 0xd0 && marker <= 0xd7) {
          marker = undefined;
          continue;
        }
        inScan = false;
        break;
      }
      if (marker === undefined) return null;
    } else {
      if (bytes[offset] !== 0xff) return null;
      while (bytes[offset] === 0xff) offset += 1;
      marker = bytes[offset];
      offset += 1;
    }

    if (marker === undefined || marker === 0x00 || marker === 0xd8) return null;
    if (marker === 0xd9) {
      if (!sawScan || scanDataBytes < 1 || !dimensions || offset !== bytes.length) return null;
      return exifOrientation >= 5
        ? { width: dimensions.height, height: dimensions.width }
        : dimensions;
    }
    if (marker === 0x01) continue;
    if (marker >= 0xd0 && marker <= 0xd7) return null;
    if (offset + 2 > bytes.length) return null;
    const segmentLength = uint16BigEndian(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    if (marker === 0xe1) {
      const orientation = jpegExifOrientation(bytes, offset + 2, offset + segmentLength);
      if (orientation === null) return null;
      if (orientation !== undefined) {
        if (sawScan && orientation !== 1) return null;
        if (sawExifOrientation && exifOrientation !== orientation) return null;
        exifOrientation = orientation;
        sawExifOrientation = true;
      }
    }
    if (startOfFrameMarkers.has(marker)) {
      if (segmentLength < 8) return null;
      const height = uint16BigEndian(bytes, offset + 3);
      const width = uint16BigEndian(bytes, offset + 5);
      const components = bytes[offset + 7]!;
      if (width < 1 || height < 1 || components < 1 || segmentLength !== 8 + (3 * components)) return null;
      if (dimensions && (dimensions.width !== width || dimensions.height !== height)) return null;
      dimensions = { width, height };
    }
    if (marker === 0xda) {
      const components = bytes[offset + 2]!;
      if (!dimensions || components < 1 || segmentLength !== 6 + (2 * components)) return null;
      sawScan = true;
      inScan = true;
    }
    offset += segmentLength;
  }
  return null;
}

function webpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (
    bytes.length < 20 ||
    !asciiMatch(bytes, 0, "RIFF") ||
    !asciiMatch(bytes, 8, "WEBP") ||
    uint32LittleEndian(bytes, 4) + 8 !== bytes.length
  ) return null;

  let offset = 12;
  let extendedDimensions: ImageDimensions | null = null;
  let rasterDimensions: ImageDimensions | null = null;
  let extendedFlags: number | null = null;
  let sawExif = false;
  let chunkIndex = 0;

  while (offset + 8 <= bytes.length) {
    const chunkType = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const dataLength = uint32LittleEndian(bytes, offset + 4);
    const dataStart = offset + 8;
    if (dataLength > bytes.length - dataStart) return null;
    const dataEnd = dataStart + dataLength;
    const chunkEnd = dataEnd + (dataLength % 2);
    if (chunkEnd > bytes.length) return null;

    if (chunkType === "VP8X") {
      if (chunkIndex !== 0 || dataLength !== 10 || extendedDimensions) return null;
      extendedFlags = bytes[dataStart]!;
      if ((extendedFlags & 0xc3) !== 0) return null;
      extendedDimensions = {
        width: uint24LittleEndian(bytes, dataStart + 4) + 1,
        height: uint24LittleEndian(bytes, dataStart + 7) + 1
      };
    } else if (chunkType === "VP8 ") {
      if (rasterDimensions || dataLength <= 10 || !bytesMatch(bytes, dataStart + 3, [0x9d, 0x01, 0x2a])) return null;
      const firstPartitionLength = ((bytes[dataStart]! >> 5) | (bytes[dataStart + 1]! << 3) | (bytes[dataStart + 2]! << 11));
      if (10 + firstPartitionLength > dataLength) return null;
      const width = uint16LittleEndian(bytes, dataStart + 6) & 0x3fff;
      const height = uint16LittleEndian(bytes, dataStart + 8) & 0x3fff;
      if (width < 1 || height < 1) return null;
      rasterDimensions = { width, height };
    } else if (chunkType === "VP8L") {
      if (rasterDimensions || dataLength <= 5 || bytes[dataStart] !== 0x2f) return null;
      const width = 1 + bytes[dataStart + 1]! + ((bytes[dataStart + 2]! & 0x3f) << 8);
      const height = 1 + (bytes[dataStart + 2]! >> 6) + (bytes[dataStart + 3]! << 2) + ((bytes[dataStart + 4]! & 0x0f) << 10);
      rasterDimensions = { width, height };
    } else if (chunkType === "EXIF") {
      if (sawExif || extendedFlags === null || (extendedFlags & 0x08) === 0) return null;
      const tiffStart = bytesMatch(bytes, dataStart, [0x45, 0x78, 0x69, 0x66, 0x00, 0x00])
        ? dataStart + 6
        : dataStart;
      const orientation = tiffOrientation(bytes, tiffStart, dataEnd);
      if (orientation === null || orientation !== 1) return null;
      sawExif = true;
    } else if (chunkType === "ANIM" || chunkType === "ANMF") {
      return null;
    }

    offset = chunkEnd;
    chunkIndex += 1;
  }

  if (
    offset !== bytes.length ||
    !rasterDimensions ||
    ((extendedFlags ?? 0) & 0x08) !== (sawExif ? 0x08 : 0)
  ) return null;
  if (
    extendedDimensions &&
    (extendedDimensions.width !== rasterDimensions.width || extendedDimensions.height !== rasterDimensions.height)
  ) return null;
  return rasterDimensions;
}

function validateMediaDataUri(
  value: unknown,
  path: string,
  errors: Errors
): ImageDimensions | null {
  if (typeof value !== "string") {
    errors.add(path, "debe ser un data URI de imagen autocontenida");
    return null;
  }
  const match = MEDIA_DATA_URI_PATTERN.exec(value);
  if (!match || match[2]!.length % 4 !== 0) {
    errors.add(path, "debe usar base64 canónico PNG, JPEG o WebP, sin URL externa");
    return null;
  }
  let decoded: string;
  try {
    decoded = atob(match[2]!);
  } catch {
    errors.add(path, "contiene base64 inválido");
    return null;
  }
  if (btoa(decoded) !== match[2]) {
    errors.add(path, "debe usar base64 canónico");
    return null;
  }
  if (decoded.length > MAX_QUESTION_MEDIA_BYTES) {
    errors.add(path, `la imagen supera ${MAX_QUESTION_MEDIA_BYTES} bytes decodificados`);
    return null;
  }
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  const dimensions = match[1] === "image/png"
    ? pngDimensions(bytes)
    : match[1] === "image/jpeg"
      ? jpegDimensions(bytes)
      : webpDimensions(bytes);
  if (!dimensions) {
    errors.add(path, `los bytes no corresponden a un contenedor ${match[1]} íntegro con dimensiones legibles`);
    return null;
  }
  if (dimensions.width * dimensions.height > MAX_QUESTION_MEDIA_PIXELS) {
    errors.add(path, `la imagen supera ${MAX_QUESTION_MEDIA_PIXELS} píxeles`);
    return null;
  }
  return dimensions;
}

function validateQuestionContentStructure(value: unknown, path: string, errors: Errors): void {
  if (!Array.isArray(value)) {
    errors.add(path, "debe ser una lista de 1 a 4 bloques");
    return;
  }
  if (value.length < 1 || value.length > 4) {
    errors.add(path, "debe contener entre 1 y 4 bloques");
  }
  value.forEach((entry, index) => {
    const blockPath = `${path}[${index}]`;
    if (!isRecord(entry)) {
      errors.add(blockPath, "debe ser un bloque de tabla, imagen o diagrama");
      return;
    }
    if (entry.kind === "table") {
      const table = exactObject(entry, blockPath, ["kind", "caption", "columns", "rows"], ["rowHeaderColumn"], errors);
      if (!table) return;
      literal(table.kind, "table", `${blockPath}.kind`, errors);
      nonBlankStringInRange(table.caption, `${blockPath}.caption`, 1, 300, errors);
      const columns = table.columns;
      if (!Array.isArray(columns)) {
        errors.add(`${blockPath}.columns`, "debe ser una lista de 1 a 12 encabezados");
      } else {
        if (columns.length < 1 || columns.length > 12) {
          errors.add(`${blockPath}.columns`, "debe contener entre 1 y 12 encabezados");
        }
        columns.forEach((column, columnIndex) =>
          nonBlankStringInRange(column, `${blockPath}.columns[${columnIndex}]`, 1, 120, errors));
      }
      if (!Array.isArray(table.rows)) {
        errors.add(`${blockPath}.rows`, "debe ser una lista de 1 a 50 filas");
      } else {
        if (table.rows.length < 1 || table.rows.length > 50) {
          errors.add(`${blockPath}.rows`, "debe contener entre 1 y 50 filas");
        }
        table.rows.forEach((row, rowIndex) => {
          const rowPath = `${blockPath}.rows[${rowIndex}]`;
          if (!Array.isArray(row)) {
            errors.add(rowPath, "debe ser una lista de celdas");
            return;
          }
          if (Array.isArray(columns) && row.length !== columns.length) {
            errors.add(rowPath, `debe contener exactamente ${columns.length} celdas`);
          }
          if (row.length < 1 || row.length > 12) {
            errors.add(rowPath, "debe contener entre 1 y 12 celdas");
          }
          row.forEach((cell, cellIndex) =>
            stringInRange(cell, `${rowPath}[${cellIndex}]`, 0, 500, errors));
        });
      }
      if (hasOwn(table, "rowHeaderColumn")) {
        const maxColumn = Array.isArray(columns) && columns.length > 0 ? columns.length - 1 : 11;
        integerInRange(table.rowHeaderColumn, `${blockPath}.rowHeaderColumn`, 0, maxColumn, errors);
      }
      return;
    }
    if (entry.kind === "image" || entry.kind === "diagram") {
      const media = exactObject(
        entry,
        blockPath,
        ["kind", "dataUri", "alt", "width", "height"],
        ["caption"],
        errors
      );
      if (!media) return;
      oneOfStrings(media.kind, ["image", "diagram"], `${blockPath}.kind`, errors);
      nonBlankStringInRange(media.alt, `${blockPath}.alt`, 1, 500, errors);
      if (hasOwn(media, "caption")) {
        nonBlankStringInRange(media.caption, `${blockPath}.caption`, 1, 500, errors);
      }
      const widthIsValid = integerInRange(media.width, `${blockPath}.width`, 1, 8192, errors);
      const heightIsValid = integerInRange(media.height, `${blockPath}.height`, 1, 8192, errors);
      const dimensions = validateMediaDataUri(media.dataUri, `${blockPath}.dataUri`, errors);
      if (dimensions && widthIsValid && media.width !== dimensions.width) {
        errors.add(`${blockPath}.width`, `debe coincidir con el ancho real (${dimensions.width})`);
      }
      if (dimensions && heightIsValid && media.height !== dimensions.height) {
        errors.add(`${blockPath}.height`, `debe coincidir con el alto real (${dimensions.height})`);
      }
      return;
    }
    errors.add(`${blockPath}.kind`, "debe ser table, image o diagram");
  });
}

function validateAnswerStructure(
  value: unknown,
  path: string,
  allowNull: boolean,
  errors: Errors
): void {
  if (value === null) {
    if (!allowNull) errors.add(path, "no puede ser null");
    return;
  }
  if (!isRecord(value)) {
    errors.add(path, "debe ser una respuesta etiquetada");
    return;
  }
  if (value.kind === "option") {
    const answer = exactObject(value, path, ["kind", "optionId"], [], errors);
    if (answer) {
      literal(answer.kind, "option", `${path}.kind`, errors);
      id(answer.optionId, `${path}.optionId`, errors);
    }
    return;
  }
  if (value.kind === "dontKnow") {
    const answer = exactObject(value, path, ["kind"], [], errors);
    if (answer) literal(answer.kind, "dontKnow", `${path}.kind`, errors);
    return;
  }
  errors.add(`${path}.kind`, "debe ser option o dontKnow");
}

function validateModuleStructure(value: unknown, path: string, errors: Errors): void {
  const module = exactObject(
    value,
    path,
    ["id", "contentRevision", "title", "subject", "description", "language", "createdAt", "updatedAt"],
    [],
    errors
  );
  if (!module) return;
  id(module.id, `${path}.id`, errors);
  positiveRevision(module.contentRevision, `${path}.contentRevision`, errors);
  stringInRange(module.title, `${path}.title`, 1, 120, errors);
  stringInRange(module.subject, `${path}.subject`, 1, 120, errors);
  stringInRange(module.description, `${path}.description`, 0, 1000, errors);
  if (stringInRange(module.language, `${path}.language`, 2, 35, errors) && !LANGUAGE_PATTERN.test(module.language)) {
    errors.add(`${path}.language`, "debe ser una etiqueta BCP-47 ASCII válida");
  }
  validTimestamp(module.createdAt, `${path}.createdAt`, errors);
  validTimestamp(module.updatedAt, `${path}.updatedAt`, errors);
}

function validateQuestionStructure(value: unknown, path: string, errors: Errors): void {
  const question = exactObject(
    value,
    path,
    ["id", "revision", "difficulty", "topic", "prompt", "options", "correctOptionId", "explanation"],
    ["body", "source", "supportingContent"],
    errors
  );
  if (!question) return;
  id(question.id, `${path}.id`, errors);
  positiveRevision(question.revision, `${path}.revision`, errors);
  oneOfStrings(question.difficulty, DIFFICULTIES, `${path}.difficulty`, errors);
  stringInRange(question.topic, `${path}.topic`, 1, 120, errors);
  stringInRange(question.prompt, `${path}.prompt`, 1, 5000, errors);
  if (hasOwn(question, "body")) {
    nonBlankStringInRange(question.body, `${path}.body`, 1, 5000, errors);
  }
  id(question.correctOptionId, `${path}.correctOptionId`, errors);
  stringInRange(question.explanation, `${path}.explanation`, 1, 5000, errors);

  if (!Array.isArray(question.options)) {
    errors.add(`${path}.options`, "debe ser una lista de 2 a 8 opciones");
  } else {
    if (question.options.length < 2 || question.options.length > 8) {
      errors.add(`${path}.options`, "debe contener entre 2 y 8 opciones");
    }
    question.options.forEach((entry, index) => {
      const optionPath = `${path}.options[${index}]`;
      const option = exactObject(entry, optionPath, ["id", "text"], [], errors);
      if (!option) return;
      id(option.id, `${optionPath}.id`, errors);
      stringInRange(option.text, `${optionPath}.text`, 1, 2000, errors);
    });
  }

  if (hasOwn(question, "source")) {
    const source = exactObject(question.source, `${path}.source`, ["label"], ["reference"], errors);
    if (source) {
      stringInRange(source.label, `${path}.source.label`, 1, 300, errors);
      if (hasOwn(source, "reference")) {
        stringInRange(source.reference, `${path}.source.reference`, 1, 500, errors);
      }
    }
  }
  if (hasOwn(question, "supportingContent")) {
    validateQuestionContentStructure(question.supportingContent, `${path}.supportingContent`, errors);
  }
}

function validateQuestionProgressStructure(value: unknown, path: string, errors: Errors): void {
  const progress = exactObject(
    value,
    path,
    [
      "questionRevision",
      "attempts",
      "correct",
      "lastResult",
      "lastAnswer",
      "lastSubmittedAt",
      "lastCompletedStateRevision"
    ],
    [],
    errors
  );
  if (!progress) return;
  positiveRevision(progress.questionRevision, `${path}.questionRevision`, errors);
  counter(progress.attempts, `${path}.attempts`, errors);
  counter(progress.correct, `${path}.correct`, errors);
  if (progress.lastResult !== null) {
    oneOfStrings(progress.lastResult, ["correct", "incorrect"], `${path}.lastResult`, errors);
  }
  validateAnswerStructure(progress.lastAnswer, `${path}.lastAnswer`, true, errors);
  if (progress.lastSubmittedAt !== null) {
    validTimestamp(progress.lastSubmittedAt, `${path}.lastSubmittedAt`, errors);
  }
  if (progress.lastCompletedStateRevision !== null) {
    positiveRevision(progress.lastCompletedStateRevision, `${path}.lastCompletedStateRevision`, errors);
  }
}

function validateFiltersStructure(value: unknown, path: string, errors: Errors): void {
  const filters = exactObject(value, path, ["difficulty", "population", "requestedSize", "acceptedSize"], [], errors);
  if (!filters) return;
  oneOfStrings(filters.difficulty, [...DIFFICULTIES, "mixta"], `${path}.difficulty`, errors);
  oneOfStrings(filters.population, ["nuevas", "todas"], `${path}.population`, errors);
  literal(filters.requestedSize, 10, `${path}.requestedSize`, errors);
  integerInRange(filters.acceptedSize, `${path}.acceptedSize`, 1, 10, errors);
}

function validateRunItemStructure(value: unknown, path: string, errors: Errors): void {
  const item = exactObject(value, path, ["questionId", "questionRevision", "optionOrder", "answer"], [], errors);
  if (!item) return;
  id(item.questionId, `${path}.questionId`, errors);
  positiveRevision(item.questionRevision, `${path}.questionRevision`, errors);
  if (!Array.isArray(item.optionOrder)) {
    errors.add(`${path}.optionOrder`, "debe ser una lista de IDs de opción");
  } else {
    if (item.optionOrder.length < 2 || item.optionOrder.length > 8) {
      errors.add(`${path}.optionOrder`, "debe contener entre 2 y 8 IDs");
    }
    item.optionOrder.forEach((optionId, index) => id(optionId, `${path}.optionOrder[${index}]`, errors));
  }
  validateAnswerStructure(item.answer, `${path}.answer`, true, errors);
}

const ACTIVE_RUN_KEYS = [
  "id",
  "createdStateRevision",
  "completedStateRevision",
  "startedAt",
  "seed",
  "filters",
  "coverageBeforeCount",
  "items",
  "status",
  "submittedAt",
  "currentIndex"
] as const;

const COMPLETED_RUN_KEYS = [
  "id",
  "createdStateRevision",
  "completedStateRevision",
  "startedAt",
  "seed",
  "filters",
  "coverageBeforeCount",
  "items",
  "status",
  "submittedAt",
  "correctCount",
  "incorrectCount",
  "coverageAfterCount"
] as const;

function validateRunCommonStructure(run: UnknownRecord, path: string, errors: Errors): void {
  id(run.id, `${path}.id`, errors);
  positiveRevision(run.createdStateRevision, `${path}.createdStateRevision`, errors);
  validTimestamp(run.startedAt, `${path}.startedAt`, errors);
  integerInRange(run.seed, `${path}.seed`, 0, 0xffffffff, errors);
  validateFiltersStructure(run.filters, `${path}.filters`, errors);
  integerInRange(run.coverageBeforeCount, `${path}.coverageBeforeCount`, 0, 5000, errors);
  if (!Array.isArray(run.items)) {
    errors.add(`${path}.items`, "debe ser una lista de 1 a 10 preguntas");
  } else {
    if (run.items.length < 1 || run.items.length > 10) {
      errors.add(`${path}.items`, "debe contener entre 1 y 10 preguntas");
    }
    run.items.forEach((item, index) => validateRunItemStructure(item, `${path}.items[${index}]`, errors));
  }
}

function validateActiveRunStructure(value: unknown, path: string, errors: Errors): void {
  const run = exactObject(value, path, ACTIVE_RUN_KEYS, [], errors);
  if (!run) return;
  validateRunCommonStructure(run, path, errors);
  literal(run.completedStateRevision, null, `${path}.completedStateRevision`, errors);
  literal(run.status, "active", `${path}.status`, errors);
  literal(run.submittedAt, null, `${path}.submittedAt`, errors);
  integerInRange(run.currentIndex, `${path}.currentIndex`, 0, 9, errors);
}

function validateCompletedRunStructure(value: unknown, path: string, errors: Errors): void {
  const run = exactObject(value, path, COMPLETED_RUN_KEYS, [], errors);
  if (!run) return;
  validateRunCommonStructure(run, path, errors);
  positiveRevision(run.completedStateRevision, `${path}.completedStateRevision`, errors);
  literal(run.status, "completed", `${path}.status`, errors);
  validTimestamp(run.submittedAt, `${path}.submittedAt`, errors);
  integerInRange(run.correctCount, `${path}.correctCount`, 0, 10, errors);
  integerInRange(run.incorrectCount, `${path}.incorrectCount`, 0, 10, errors);
  integerInRange(run.coverageAfterCount, `${path}.coverageAfterCount`, 0, 5000, errors);
}

function validateDifficultySummaryStructure(value: unknown, path: string, errors: Errors): void {
  const summary = exactObject(value, path, ["attempts", "correct"], [], errors);
  if (!summary) return;
  counter(summary.attempts, `${path}.attempts`, errors);
  counter(summary.correct, `${path}.correct`, errors);
}

function validatePriorSummaryStructure(value: unknown, path: string, errors: Errors): void {
  const summary = exactObject(
    value,
    path,
    ["runCount", "attemptCount", "correctCount", "firstSubmittedAt", "lastSubmittedAt", "byDifficulty"],
    [],
    errors
  );
  if (!summary) return;
  counter(summary.runCount, `${path}.runCount`, errors);
  counter(summary.attemptCount, `${path}.attemptCount`, errors);
  counter(summary.correctCount, `${path}.correctCount`, errors);
  if (summary.firstSubmittedAt !== null) validTimestamp(summary.firstSubmittedAt, `${path}.firstSubmittedAt`, errors);
  if (summary.lastSubmittedAt !== null) validTimestamp(summary.lastSubmittedAt, `${path}.lastSubmittedAt`, errors);
  const byDifficulty = exactObject(summary.byDifficulty, `${path}.byDifficulty`, DIFFICULTIES, [], errors);
  if (byDifficulty) {
    for (const difficulty of DIFFICULTIES) {
      validateDifficultySummaryStructure(byDifficulty[difficulty], `${path}.byDifficulty.${difficulty}`, errors);
    }
  }
}

function validateProgressStructure(value: unknown, path: string, errors: Errors): void {
  const progress = exactObject(
    value,
    path,
    ["updatedAt", "stateRevision", "questions", "runs", "priorRunSummary", "activeRun"],
    [],
    errors
  );
  if (!progress) return;
  validTimestamp(progress.updatedAt, `${path}.updatedAt`, errors);
  counter(progress.stateRevision, `${path}.stateRevision`, errors);
  if (!isRecord(progress.questions)) {
    errors.add(`${path}.questions`, "debe ser un objeto indexado por ID de pregunta");
  } else {
    for (const [questionId, questionProgress] of Object.entries(progress.questions)) {
      const questionPath = `${path}.questions[${JSON.stringify(questionId)}]`;
      id(questionId, questionPath, errors);
      validateQuestionProgressStructure(questionProgress, questionPath, errors);
    }
  }
  if (!Array.isArray(progress.runs)) {
    errors.add(`${path}.runs`, "debe ser una lista de ejecuciones completadas");
  } else {
    if (progress.runs.length > 500) errors.add(`${path}.runs`, "no puede superar 500 ejecuciones detalladas");
    progress.runs.forEach((run, index) => validateCompletedRunStructure(run, `${path}.runs[${index}]`, errors));
  }
  validatePriorSummaryStructure(progress.priorRunSummary, `${path}.priorRunSummary`, errors);
  if (progress.activeRun !== null) {
    validateActiveRunStructure(progress.activeRun, `${path}.activeRun`, errors);
  }
}

function validateStructure(value: unknown, errors: Errors): value is StudySnapshot {
  const snapshot = exactObject(value, "$", ["schemaVersion", "module", "questions", "progress"], [], errors);
  if (!snapshot) return false;
  literal(snapshot.schemaVersion, 1, "$.schemaVersion", errors);
  validateModuleStructure(snapshot.module, "$.module", errors);
  if (!Array.isArray(snapshot.questions)) {
    errors.add("$.questions", "debe ser una lista de 1 a 5000 preguntas");
  } else {
    if (snapshot.questions.length < 1 || snapshot.questions.length > 5000) {
      errors.add("$.questions", "debe contener entre 1 y 5000 preguntas");
    }
    snapshot.questions.forEach((question, index) => validateQuestionStructure(question, `$.questions[${index}]`, errors));
  }
  validateProgressStructure(snapshot.progress, "$.progress", errors);
  return !errors.any;
}

function sameAnswer(left: StudyAnswer, right: StudyAnswer): boolean {
  if (left.kind !== right.kind) return false;
  return left.kind === "dontKnow" || (right.kind === "option" && left.optionId === right.optionId);
}

function answerIsCorrect(answer: StudyAnswer, question: StudyQuestion): boolean {
  return answer.kind === "option" && answer.optionId === question.correctOptionId;
}

function expectedRunId(createdStateRevision: number, seed: number): string {
  return `run.${createdStateRevision}.${seed.toString(16).padStart(8, "0")}`;
}

interface RetainedOccurrence {
  run: CompletedRun;
  answer: StudyAnswer;
  correct: boolean;
}

function validateQuestionSemantics(
  snapshot: StudySnapshot,
  questionById: ReadonlyMap<string, StudyQuestion>,
  occurrences: Map<string, RetainedOccurrence[]>,
  errors: Errors
): void {
  const { progress } = snapshot;
  const firstRetainedRevision = progress.runs[0]?.completedStateRevision ?? null;

  for (const [questionId, questionProgress] of Object.entries(progress.questions)) {
    const path = `$.progress.questions[${JSON.stringify(questionId)}]`;
    const question = questionById.get(questionId);
    if (!question) {
      errors.add(path, "el ID no existe en $.questions");
      continue;
    }
    if (questionProgress.questionRevision !== question.revision) {
      errors.add(`${path}.questionRevision`, "debe coincidir con la revisión actual de la pregunta");
    }
    if (questionProgress.correct > questionProgress.attempts) {
      errors.add(`${path}.correct`, "no puede superar attempts");
    }

    const lastFields = [
      questionProgress.lastResult,
      questionProgress.lastAnswer,
      questionProgress.lastSubmittedAt,
      questionProgress.lastCompletedStateRevision
    ];
    if (questionProgress.attempts === 0) {
      if (lastFields.some((value) => value !== null)) {
        errors.add(path, "con cero intentos, todos los campos last* deben ser null");
      }
      continue;
    }

    if (lastFields.some((value) => value === null)) {
      errors.add(path, "con intentos, todos los campos last* deben tener evidencia");
      continue;
    }

    const lastAnswer = questionProgress.lastAnswer as StudyAnswer;
    if (lastAnswer.kind === "option" && !question.options.some((option) => option.id === lastAnswer.optionId)) {
      errors.add(`${path}.lastAnswer.optionId`, "no referencia una opción de la pregunta");
    }
    const expectedResult = answerIsCorrect(lastAnswer, question) ? "correct" : "incorrect";
    if (questionProgress.lastResult !== expectedResult) {
      errors.add(`${path}.lastResult`, `debe ser ${expectedResult} según lastAnswer`);
    }
    if ((questionProgress.lastCompletedStateRevision as number) > progress.stateRevision) {
      errors.add(`${path}.lastCompletedStateRevision`, "no puede superar stateRevision");
    }

    const retained = occurrences.get(questionId) ?? [];
    const latest = retained.at(-1);
    if (latest) {
      if (questionProgress.lastCompletedStateRevision !== latest.run.completedStateRevision) {
        errors.add(`${path}.lastCompletedStateRevision`, "debe señalar la última ejecución detallada que respondió esta pregunta");
      }
      if (!sameAnswer(lastAnswer, latest.answer)) {
        errors.add(`${path}.lastAnswer`, "no coincide con la evidencia de la última ejecución detallada");
      }
      if (questionProgress.lastSubmittedAt !== latest.run.submittedAt) {
        errors.add(`${path}.lastSubmittedAt`, "no coincide con la evidencia de la última ejecución detallada");
      }
    } else if (
      progress.priorRunSummary.runCount === 0 ||
      (firstRetainedRevision !== null &&
        (questionProgress.lastCompletedStateRevision as number) >= firstRetainedRevision)
    ) {
      errors.add(`${path}.lastCompletedStateRevision`, "no tiene evidencia terminal en el resumen compactado ni en ejecuciones detalladas");
    }
  }
}

function validateRunSemantics(
  snapshot: StudySnapshot,
  questionById: ReadonlyMap<string, StudyQuestion>,
  errors: Errors
): Map<string, RetainedOccurrence[]> {
  const { progress } = snapshot;
  const runIds = new Set<string>();
  const occurrences = new Map<string, RetainedOccurrence[]>();
  let previousCompletedRevision = 0;
  let previousCoverageAfter: number | null = null;
  const seenInDetailed = new Set<string>();

  const registerId = (runId: string, path: string): void => {
    if (runIds.has(runId)) errors.add(path, "el ID de ejecución está duplicado");
    runIds.add(runId);
  };

  for (let runIndex = 0; runIndex < progress.runs.length; runIndex += 1) {
    const run = progress.runs[runIndex] as CompletedRun;
    const path = `$.progress.runs[${runIndex}]`;
    registerId(run.id, `${path}.id`);
    const expectedId = expectedRunId(run.createdStateRevision, run.seed);
    if (run.id !== expectedId) errors.add(`${path}.id`, `debe ser ${expectedId}`);
    if (run.createdStateRevision >= run.completedStateRevision) {
      errors.add(`${path}.completedStateRevision`, "debe ser mayor que createdStateRevision");
    }
    if (run.completedStateRevision <= previousCompletedRevision) {
      errors.add(`${path}.completedStateRevision`, "debe estar estrictamente ordenada en forma ascendente");
    }
    if (runIndex > 0 && run.createdStateRevision <= previousCompletedRevision) {
      errors.add(`${path}.createdStateRevision`, "debe ser posterior a la ejecución completada anterior");
    }
    if (run.completedStateRevision > progress.stateRevision) {
      errors.add(`${path}.completedStateRevision`, "no puede superar stateRevision");
    }
    previousCompletedRevision = run.completedStateRevision;

    if (run.id.length > 64 || !ID_PATTERN.test(run.id)) {
      errors.add(`${path}.id`, "el ID derivado excede el formato permitido");
    }
    if (run.filters.acceptedSize !== run.items.length) {
      errors.add(`${path}.filters.acceptedSize`, "debe coincidir con items.length");
    }
    if (run.coverageBeforeCount > snapshot.questions.length) {
      errors.add(`${path}.coverageBeforeCount`, "no puede superar la cantidad de preguntas");
    }
    if (run.coverageAfterCount > snapshot.questions.length) {
      errors.add(`${path}.coverageAfterCount`, "no puede superar la cantidad de preguntas");
    }
    if (run.coverageAfterCount < run.coverageBeforeCount) {
      errors.add(`${path}.coverageAfterCount`, "no puede ser menor que coverageBeforeCount");
    }
    if (run.coverageAfterCount - run.coverageBeforeCount > run.items.length) {
      errors.add(`${path}.coverageAfterCount`, "la cobertura no puede crecer más que la cantidad de preguntas de la ejecución");
    }
    if (previousCoverageAfter !== null && run.coverageBeforeCount !== previousCoverageAfter) {
      errors.add(`${path}.coverageBeforeCount`, "debe coincidir con coverageAfterCount de la ejecución anterior");
    }
    if (runIndex === 0 && progress.priorRunSummary.runCount === 0 && run.coverageBeforeCount !== 0) {
      errors.add(`${path}.coverageBeforeCount`, "la primera ejecución sin resumen previo debe comenzar con cobertura cero");
    }

    const runQuestionIds = new Set<string>();
    let computedCorrect = 0;
    let maxCoverageGain = 0;
    for (let itemIndex = 0; itemIndex < run.items.length; itemIndex += 1) {
      const item = run.items[itemIndex]!;
      const itemPath = `${path}.items[${itemIndex}]`;
      if (runQuestionIds.has(item.questionId)) {
        errors.add(`${itemPath}.questionId`, "la pregunta está repetida dentro de la ejecución");
      }
      runQuestionIds.add(item.questionId);
      const question = questionById.get(item.questionId);
      if (!question) {
        errors.add(`${itemPath}.questionId`, "no referencia una pregunta del módulo");
        continue;
      }
      if (!seenInDetailed.has(item.questionId)) maxCoverageGain += 1;
      if (item.questionRevision !== question.revision) {
        errors.add(`${itemPath}.questionRevision`, "debe coincidir con la revisión actual de la pregunta");
      }
      if (run.filters.difficulty !== "mixta" && question.difficulty !== run.filters.difficulty) {
        errors.add(`${itemPath}.questionId`, "no coincide con el filtro de dificultad de la ejecución");
      }
      const expectedOptions = new Set(question.options.map((option) => option.id));
      const actualOptions = new Set(item.optionOrder);
      if (actualOptions.size !== item.optionOrder.length) {
        errors.add(`${itemPath}.optionOrder`, "no puede contener IDs duplicados");
      }
      if (
        actualOptions.size !== expectedOptions.size ||
        [...expectedOptions].some((optionId) => !actualOptions.has(optionId))
      ) {
        errors.add(`${itemPath}.optionOrder`, "debe listar exactamente todas las opciones de la pregunta");
      }
      if (item.answer === null) {
        errors.add(`${itemPath}.answer`, "una ejecución completada no puede contener respuestas null");
        continue;
      }
      if (item.answer.kind === "option" && !expectedOptions.has(item.answer.optionId)) {
        errors.add(`${itemPath}.answer.optionId`, "no referencia una opción de la pregunta");
      }
      const correct = answerIsCorrect(item.answer, question);
      if (correct) computedCorrect += 1;
      const list = occurrences.get(item.questionId) ?? [];
      list.push({ run, answer: item.answer, correct });
      occurrences.set(item.questionId, list);
    }
    if (run.coverageAfterCount - run.coverageBeforeCount > maxCoverageGain) {
      errors.add(`${path}.coverageAfterCount`, "el aumento excede las preguntas que podían ser nuevas en el historial detallado");
    }
    for (const questionId of runQuestionIds) seenInDetailed.add(questionId);
    if (run.correctCount !== computedCorrect) {
      errors.add(`${path}.correctCount`, `debe ser ${computedCorrect} según las respuestas`);
    }
    if (run.incorrectCount !== run.items.length - computedCorrect) {
      errors.add(`${path}.incorrectCount`, `debe ser ${run.items.length - computedCorrect} según las respuestas`);
    }
    if (run.correctCount + run.incorrectCount !== run.items.length) {
      errors.add(path, "correctCount + incorrectCount debe coincidir con items.length");
    }
    if (timestampMillis(run.submittedAt) < timestampMillis(run.startedAt)) {
      errors.add(`${path}.submittedAt`, "no puede ser anterior a startedAt");
    }
    previousCoverageAfter = run.coverageAfterCount;
  }

  const active = progress.activeRun;
  if (active) {
    const path = "$.progress.activeRun";
    registerId(active.id, `${path}.id`);
    const expectedId = expectedRunId(active.createdStateRevision, active.seed);
    if (active.id !== expectedId) errors.add(`${path}.id`, `debe ser ${expectedId}`);
    if (active.createdStateRevision > progress.stateRevision) {
      errors.add(`${path}.createdStateRevision`, "no puede superar stateRevision");
    }
    if (active.createdStateRevision <= previousCompletedRevision) {
      errors.add(`${path}.createdStateRevision`, "debe ser posterior a la última ejecución completada");
    }
    if (active.filters.acceptedSize !== active.items.length) {
      errors.add(`${path}.filters.acceptedSize`, "debe coincidir con items.length");
    }
    if (active.currentIndex >= active.items.length) {
      errors.add(`${path}.currentIndex`, "debe señalar un elemento existente");
    }
    const runQuestionIds = new Set<string>();
    for (let itemIndex = 0; itemIndex < active.items.length; itemIndex += 1) {
      const item = active.items[itemIndex]!;
      const itemPath = `${path}.items[${itemIndex}]`;
      if (runQuestionIds.has(item.questionId)) {
        errors.add(`${itemPath}.questionId`, "la pregunta está repetida dentro de la ejecución");
      }
      runQuestionIds.add(item.questionId);
      const question = questionById.get(item.questionId);
      if (!question) {
        errors.add(`${itemPath}.questionId`, "no referencia una pregunta del módulo");
        continue;
      }
      if (item.questionRevision !== question.revision) {
        errors.add(`${itemPath}.questionRevision`, "debe coincidir con la revisión actual de la pregunta");
      }
      if (active.filters.difficulty !== "mixta" && question.difficulty !== active.filters.difficulty) {
        errors.add(`${itemPath}.questionId`, "no coincide con el filtro de dificultad de la ejecución");
      }
      const expectedOptions = new Set(question.options.map((option) => option.id));
      const actualOptions = new Set(item.optionOrder);
      if (
        actualOptions.size !== item.optionOrder.length ||
        actualOptions.size !== expectedOptions.size ||
        [...expectedOptions].some((optionId) => !actualOptions.has(optionId))
      ) {
        errors.add(`${itemPath}.optionOrder`, "debe listar exactamente todas las opciones, sin duplicados");
      }
      if (item.answer?.kind === "option" && !expectedOptions.has(item.answer.optionId)) {
        errors.add(`${itemPath}.answer.optionId`, "no referencia una opción de la pregunta");
      }
    }
    const evaluated = Object.values(progress.questions).filter((question) => question.attempts > 0).length;
    if (active.coverageBeforeCount !== evaluated) {
      errors.add(`${path}.coverageBeforeCount`, "debe coincidir con la cobertura evaluada actual");
    }
  }

  return occurrences;
}

function validateSummarySemantics(snapshot: StudySnapshot, errors: Errors): void {
  const summary = snapshot.progress.priorRunSummary;
  const path = "$.progress.priorRunSummary";
  if (summary.correctCount > summary.attemptCount) {
    errors.add(`${path}.correctCount`, "no puede superar attemptCount");
  }
  let byDifficultyAttempts = 0;
  let byDifficultyCorrect = 0;
  for (const difficulty of DIFFICULTIES) {
    const difficultySummary = summary.byDifficulty[difficulty];
    if (difficultySummary.correct > difficultySummary.attempts) {
      errors.add(`${path}.byDifficulty.${difficulty}.correct`, "no puede superar attempts");
    }
    byDifficultyAttempts += difficultySummary.attempts;
    byDifficultyCorrect += difficultySummary.correct;
  }
  if (byDifficultyAttempts !== summary.attemptCount) {
    errors.add(`${path}.attemptCount`, "debe coincidir con la suma de byDifficulty.attempts");
  }
  if (byDifficultyCorrect !== summary.correctCount) {
    errors.add(`${path}.correctCount`, "debe coincidir con la suma de byDifficulty.correct");
  }

  if (summary.runCount === 0) {
    if (
      summary.attemptCount !== 0 ||
      summary.correctCount !== 0 ||
      summary.firstSubmittedAt !== null ||
      summary.lastSubmittedAt !== null
    ) {
      errors.add(path, "un resumen sin ejecuciones debe tener conteos cero y fechas null");
    }
  } else {
    if (summary.firstSubmittedAt === null || summary.lastSubmittedAt === null) {
      errors.add(path, "un resumen con ejecuciones requiere firstSubmittedAt y lastSubmittedAt");
    } else if (timestampMillis(summary.firstSubmittedAt) > timestampMillis(summary.lastSubmittedAt)) {
      errors.add(`${path}.lastSubmittedAt`, "no puede ser anterior a firstSubmittedAt");
    }
    if (summary.attemptCount < summary.runCount || summary.attemptCount > summary.runCount * 10) {
      errors.add(`${path}.attemptCount`, "debe representar entre 1 y 10 intentos por ejecución compactada");
    }
  }
}

function validateAggregateReconciliation(
  snapshot: StudySnapshot,
  questionById: ReadonlyMap<string, StudyQuestion>,
  occurrences: Map<string, RetainedOccurrence[]>,
  errors: Errors
): void {
  const progressAttempts: Record<Difficulty, number> = { facil: 0, medio: 0, dificil: 0, experto: 0 };
  const progressCorrect: Record<Difficulty, number> = { facil: 0, medio: 0, dificil: 0, experto: 0 };
  let totalProgressAttempts = 0;
  let totalProgressCorrect = 0;

  for (const question of snapshot.questions) {
    const questionProgress: QuestionProgress | undefined = hasOwn(snapshot.progress.questions, question.id)
      ? snapshot.progress.questions[question.id]
      : undefined;
    const attempts = questionProgress?.attempts ?? 0;
    const correct = questionProgress?.correct ?? 0;
    totalProgressAttempts += attempts;
    totalProgressCorrect += correct;
    progressAttempts[question.difficulty] += attempts;
    progressCorrect[question.difficulty] += correct;

    const retained = occurrences.get(question.id) ?? [];
    const retainedAttempts = retained.length;
    const retainedCorrect = retained.filter((entry) => entry.correct).length;
    if (attempts < retainedAttempts) {
      errors.add(`$.progress.questions[${JSON.stringify(question.id)}].attempts`, "no puede ser menor que sus intentos detallados");
    }
    if (correct < retainedCorrect) {
      errors.add(`$.progress.questions[${JSON.stringify(question.id)}].correct`, "no puede ser menor que sus aciertos detallados");
    }
    if (correct - retainedCorrect > attempts - retainedAttempts) {
      errors.add(`$.progress.questions[${JSON.stringify(question.id)}].correct`, "los aciertos compactados exceden los intentos compactados de la pregunta");
    }
    if (snapshot.progress.priorRunSummary.runCount === 0 && (attempts !== retainedAttempts || correct !== retainedCorrect)) {
      errors.add(`$.progress.questions[${JSON.stringify(question.id)}]`, "sin historial compactado, debe coincidir exactamente con las ejecuciones detalladas");
    }
  }

  let detailedAttempts = 0;
  let detailedCorrect = 0;
  const detailedAttemptsByDifficulty: Record<Difficulty, number> = { facil: 0, medio: 0, dificil: 0, experto: 0 };
  const detailedCorrectByDifficulty: Record<Difficulty, number> = { facil: 0, medio: 0, dificil: 0, experto: 0 };
  for (const [questionId, retained] of occurrences) {
    const question = questionById.get(questionId);
    if (!question) continue;
    detailedAttempts += retained.length;
    detailedCorrect += retained.filter((entry) => entry.correct).length;
    detailedAttemptsByDifficulty[question.difficulty] += retained.length;
    detailedCorrectByDifficulty[question.difficulty] += retained.filter((entry) => entry.correct).length;
  }

  const summary = snapshot.progress.priorRunSummary;
  if (totalProgressAttempts !== summary.attemptCount + detailedAttempts) {
    errors.add("$.progress.questions", "la suma de attempts no coincide con resumen + ejecuciones detalladas");
  }
  if (totalProgressCorrect !== summary.correctCount + detailedCorrect) {
    errors.add("$.progress.questions", "la suma de correct no coincide con resumen + ejecuciones detalladas");
  }
  for (const difficulty of DIFFICULTIES) {
    if (progressAttempts[difficulty] !== summary.byDifficulty[difficulty].attempts + detailedAttemptsByDifficulty[difficulty]) {
      errors.add(
        `$.progress.priorRunSummary.byDifficulty.${difficulty}.attempts`,
        "no reconcilia con el progreso y las ejecuciones detalladas de esta dificultad"
      );
    }
    if (progressCorrect[difficulty] !== summary.byDifficulty[difficulty].correct + detailedCorrectByDifficulty[difficulty]) {
      errors.add(
        `$.progress.priorRunSummary.byDifficulty.${difficulty}.correct`,
        "no reconcilia con el progreso y las ejecuciones detalladas de esta dificultad"
      );
    }
  }

  const evaluated = Object.values(snapshot.progress.questions).filter((entry) => entry.attempts > 0).length;
  const latestRun = snapshot.progress.runs.at(-1);
  if (latestRun && latestRun.coverageAfterCount !== evaluated) {
    errors.add("$.progress.runs", "coverageAfterCount de la última ejecución debe coincidir con la cobertura actual");
  }
}

function validateProgressSemantics(
  snapshot: StudySnapshot,
  questionById: ReadonlyMap<string, StudyQuestion>,
  errors: Errors
): void {
  validateSummarySemantics(snapshot, errors);
  const occurrences = validateRunSemantics(snapshot, questionById, errors);
  validateQuestionSemantics(snapshot, questionById, occurrences, errors);
  validateAggregateReconciliation(snapshot, questionById, occurrences, errors);

  if (snapshot.progress.stateRevision === 0) {
    const initialSummary = snapshot.progress.priorRunSummary;
    if (
      Object.keys(snapshot.progress.questions).length !== 0 ||
      snapshot.progress.runs.length !== 0 ||
      snapshot.progress.activeRun !== null ||
      initialSummary.runCount !== 0 ||
      initialSummary.attemptCount !== 0 ||
      initialSummary.correctCount !== 0
    ) {
      errors.add("$.progress", "stateRevision 0 requiere progreso inicial vacío");
    }
  }
}

function validateSemantics(snapshot: StudySnapshot, errors: Errors): void {
  const questionById = new Map<string, StudyQuestion>();
  for (let index = 0; index < snapshot.questions.length; index += 1) {
    const question = snapshot.questions[index]!;
    const path = `$.questions[${index}]`;
    if (questionById.has(question.id)) {
      errors.add(`${path}.id`, "el ID de pregunta está duplicado");
    } else {
      questionById.set(question.id, question);
    }
    const optionIds = new Set<string>();
    for (let optionIndex = 0; optionIndex < question.options.length; optionIndex += 1) {
      const optionId = question.options[optionIndex]!.id;
      if (optionIds.has(optionId)) {
        errors.add(`${path}.options[${optionIndex}].id`, "el ID de opción está duplicado dentro de la pregunta");
      }
      optionIds.add(optionId);
    }
    if (!optionIds.has(question.correctOptionId)) {
      errors.add(`${path}.correctOptionId`, "no referencia una opción de esta pregunta");
    }
  }

  if (timestampMillis(snapshot.module.updatedAt) < timestampMillis(snapshot.module.createdAt)) {
    errors.add("$.module.updatedAt", "no puede ser anterior a createdAt");
  }

  validateProgressSemantics(snapshot, questionById, errors);

  try {
    const moduleBytes = canonicalUtf8ByteLength({
      module: snapshot.module,
      questions: snapshot.questions
    } as unknown as CanonicalJsonValue);
    if (moduleBytes > MAX_MODULE_BYTES) {
      errors.add("$.questions", `la definición del módulo supera ${MAX_MODULE_BYTES} bytes UTF-8 canónicos`);
    }
    const progressBytes = canonicalUtf8ByteLength(snapshot.progress as unknown as CanonicalJsonValue);
    if (progressBytes > MAX_PROGRESS_BYTES) {
      errors.add("$.progress", `el estado mutable supera ${MAX_PROGRESS_BYTES} bytes UTF-8 canónicos`);
    }
    const snapshotBytes = canonicalUtf8ByteLength(snapshot as unknown as CanonicalJsonValue);
    if (snapshotBytes > MAX_SNAPSHOT_BYTES) {
      errors.add("$", `el snapshot supera ${MAX_SNAPSHOT_BYTES} bytes UTF-8 canónicos`);
    }
  } catch (error) {
    errors.add("$", error instanceof Error ? error.message : "no se pudo canonicalizar el JSON");
  }
}

export function validateSnapshot(value: unknown): ValidationResult {
  const errors = new Errors();
  if (!validateStructure(value, errors)) {
    return { ok: false, errors: errors.values };
  }
  validateSemantics(value, errors);
  return errors.any ? { ok: false, errors: errors.values } : { ok: true, value };
}

export interface TrustedModuleValidationContext {
  readonly module: StudySnapshot["module"];
  readonly questions: readonly StudyQuestion[];
  readonly questionById: ReadonlyMap<string, StudyQuestion>;
  readonly definitionBytes: number;
}

const SNAPSHOT_PROGRESS_ENVELOPE_BYTES =
  canonicalUtf8ByteLength({
    module: null,
    progress: null,
    questions: null,
    schemaVersion: 1
  }) -
  canonicalUtf8ByteLength({ module: null, questions: null }) -
  canonicalUtf8ByteLength(null);

export function createTrustedModuleValidationContext(
  snapshot: StudySnapshot
): TrustedModuleValidationContext {
  return {
    module: snapshot.module,
    questions: snapshot.questions,
    questionById: new Map(snapshot.questions.map((question) => [question.id, question])),
    definitionBytes: canonicalUtf8ByteLength({
      module: snapshot.module,
      questions: snapshot.questions
    } as unknown as CanonicalJsonValue)
  };
}

export function validateTrustedProgressSnapshot(
  value: unknown,
  context: TrustedModuleValidationContext
): ValidationResult {
  const errors = new Errors();
  const snapshot = exactObject(value, "$", ["schemaVersion", "module", "questions", "progress"], [], errors);
  if (!snapshot) return { ok: false, errors: errors.values };
  literal(snapshot.schemaVersion, 1, "$.schemaVersion", errors);
  if (snapshot.module !== context.module) {
    errors.add("$.module", "debe conservar la definición validada por referencia");
  }
  if (snapshot.questions !== context.questions) {
    errors.add("$.questions", "debe conservar las preguntas validadas por referencia");
  }
  validateProgressStructure(snapshot.progress, "$.progress", errors);
  if (errors.any) return { ok: false, errors: errors.values };

  const candidate = value as StudySnapshot;
  validateProgressSemantics(candidate, context.questionById, errors);
  try {
    const progressBytes = canonicalUtf8ByteLength(candidate.progress as unknown as CanonicalJsonValue);
    if (progressBytes > MAX_PROGRESS_BYTES) {
      errors.add("$.progress", `el estado mutable supera ${MAX_PROGRESS_BYTES} bytes UTF-8 canónicos`);
    }
    const snapshotBytes = context.definitionBytes + progressBytes + SNAPSHOT_PROGRESS_ENVELOPE_BYTES;
    if (snapshotBytes > MAX_SNAPSHOT_BYTES) {
      errors.add("$", `el snapshot supera ${MAX_SNAPSHOT_BYTES} bytes UTF-8 canónicos`);
    }
  } catch (error) {
    errors.add("$", error instanceof Error ? error.message : "no se pudo canonicalizar el JSON");
  }
  return errors.any ? { ok: false, errors: errors.values } : { ok: true, value: candidate };
}

function sourceToText(source: string | Uint8Array | ArrayBuffer): ValidationResult<string> {
  let bytes: Uint8Array;
  if (typeof source === "string") {
    bytes = new TextEncoder().encode(source);
    if (bytes.byteLength > MAX_SOURCE_FILE_BYTES) {
      return { ok: false, errors: [{ path: "$", message: `el archivo supera ${MAX_SOURCE_FILE_BYTES} bytes` }] };
    }
    return { ok: true, value: source.startsWith("\uFEFF") ? source.slice(1) : source };
  }

  bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  if (bytes.byteLength > MAX_SOURCE_FILE_BYTES) {
    return { ok: false, errors: [{ path: "$", message: `el archivo supera ${MAX_SOURCE_FILE_BYTES} bytes` }] };
  }
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    return { ok: true, value: decoded.startsWith("\uFEFF") ? decoded.slice(1) : decoded };
  } catch {
    return { ok: false, errors: [{ path: "$", message: "el archivo no contiene UTF-8 válido" }] };
  }
}

export function parseSnapshotText(source: string | Uint8Array | ArrayBuffer): ValidationResult {
  const decoded = sourceToText(source);
  if (!decoded.ok) return decoded;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded.value) as unknown;
  } catch (error) {
    const detail = error instanceof SyntaxError ? error.message : "JSON inválido";
    return { ok: false, errors: [{ path: "$", message: `no se pudo interpretar el JSON: ${detail}` }] };
  }
  return validateSnapshot(parsed);
}
