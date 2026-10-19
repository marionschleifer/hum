export type CborValue =
  | number
  | bigint
  | string
  | boolean
  | undefined
  | Uint8Array
  | CborValue[]
  | Map<CborValue, CborValue>;

export function decodeCbor(bytes: Uint8Array): CborValue {
  const [value, end] = decodeCborPrefix(bytes, 0);
  if (end !== bytes.length) throw new Error("Trailing bytes after CBOR value");
  return value;
}

export function decodeCborPrefix(bytes: Uint8Array, offset: number): [CborValue, number] {
  const initial = byteAt(bytes, offset);
  const major = initial >> 5;
  const [argument, next] = readArgument(bytes, offset + 1, initial & 0x1f);
  switch (major) {
    case 0:
      return [argument, next];
    case 1:
      return [typeof argument === "bigint" ? -1n - argument : -1 - argument, next];
    case 2:
      return [bytes.slice(next, next + count(argument)), checkedEnd(bytes, next + count(argument))];
    case 3: {
      const end = checkedEnd(bytes, next + count(argument));
      return [new TextDecoder().decode(bytes.slice(next, end)), end];
    }
    case 4: {
      const items: CborValue[] = [];
      let cursor = next;
      for (let i = 0; i < count(argument); i++) {
        const [item, after] = decodeCborPrefix(bytes, cursor);
        items.push(item);
        cursor = after;
      }
      return [items, cursor];
    }
    case 5: {
      const map = new Map<CborValue, CborValue>();
      let cursor = next;
      for (let i = 0; i < count(argument); i++) {
        const [key, afterKey] = decodeCborPrefix(bytes, cursor);
        const [value, afterValue] = decodeCborPrefix(bytes, afterKey);
        map.set(key, value);
        cursor = afterValue;
      }
      return [map, cursor];
    }
    case 7:
      return [simpleValue(initial & 0x1f), next];
    default:
      throw new Error(`Unsupported CBOR major type ${major}`);
  }
}

function readArgument(bytes: Uint8Array, offset: number, info: number): [number | bigint, number] {
  if (info < 24) return [info, offset];
  if (info > 27) throw new Error("Indefinite-length CBOR is not supported");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  checkedEnd(bytes, offset + (info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : 8));
  switch (info) {
    case 24:
      return [view.getUint8(offset), offset + 1];
    case 25:
      return [view.getUint16(offset), offset + 2];
    case 26:
      return [view.getUint32(offset), offset + 4];
    default: {
      const big = view.getBigUint64(offset);
      return [big <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(big) : big, offset + 8];
    }
  }
}

function simpleValue(info: number): CborValue {
  if (info === 20) return false;
  if (info === 21) return true;
  if (info === 22 || info === 23) return undefined;
  throw new Error("Unsupported CBOR simple value");
}

function count(argument: number | bigint): number {
  if (typeof argument === "bigint") throw new Error("CBOR length too large");
  return argument;
}

function byteAt(bytes: Uint8Array, offset: number): number {
  const byte = bytes[offset];
  if (byte === undefined) throw new Error("Unexpected end of CBOR data");
  return byte;
}

function checkedEnd(bytes: Uint8Array, end: number): number {
  if (end > bytes.length) throw new Error("Unexpected end of CBOR data");
  return end;
}
