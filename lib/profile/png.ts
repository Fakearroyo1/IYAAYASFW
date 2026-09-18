// Accept the browser's normalized RGB/RGBA PNG only. Decode the compressed scan
// lines within strict bounds and rebuild without ancillary chunks or metadata.
import { RequestError } from "../security/http";
const signature = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let n = index;
  for (let bit = 0; bit < 8; bit++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  return n >>> 0;
});
function crc(bytes: Uint8Array) {
  let n = 0xffffffff;
  for (let i = 0; i < bytes.length; i++)
    n = (n >>> 8) ^ crcTable[(n ^ bytes[i]) & 255];
  return (n ^ 0xffffffff) >>> 0;
}
function join(chunks: Uint8Array[]) {
  const out = new Uint8Array(chunks.reduce((n, b) => n + b.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
function chunk(type: string, data: Uint8Array) {
  const name = new TextEncoder().encode(type),
    value = join([name, data]),
    out = new Uint8Array(data.length + 12),
    view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(value, 4);
  view.setUint32(data.length + 8, crc(value));
  return out;
}
async function bounded(stream: ReadableStream<Uint8Array>, maximum: number) {
  const reader = stream.getReader(),
    parts: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maximum)
        throw new RequestError(
          "Image dimensions exceed the upload limit.",
          413,
        );
      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return join(parts);
}
export async function safePng(input: Uint8Array, kind: string) {
  const bad = () => {
    throw new RequestError("Choose a valid photo and try again.", 400);
  };
  if (
    input.length > 2 * 1024 * 1024 ||
    input.length < 45 ||
    !signature.every((v, i) => input[i] === v)
  )
    bad();
  let at = 8,
    width = 0,
    height = 0,
    channels = 0,
    header: Uint8Array | null = null,
    ended = false,
    sawData = false,
    dataEnded = false;
  const compressed: Uint8Array[] = [];
  let chunks = 0;
  while (at < input.length) {
    if (++chunks > 512 || at + 12 > input.length) bad();
    const view = new DataView(input.buffer, input.byteOffset + at),
      length = view.getUint32(0);
    if (length > input.length - at - 12) bad();
    const type = new TextDecoder().decode(input.subarray(at + 4, at + 8)),
      data = input.subarray(at + 8, at + 8 + length);
    if (
      crc(input.subarray(at + 4, at + 8 + length)) !==
      view.getUint32(length + 8)
    )
      bad();
    if (!header && type !== "IHDR") bad();
    if (type === "IHDR") {
      if (header || length !== 13) bad();
      header = new Uint8Array(data);
      const h = new DataView(data.buffer, data.byteOffset, data.length);
      width = h.getUint32(0);
      height = h.getUint32(4);
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      if (
        data[8] !== 8 ||
        !channels ||
        data[10] !== 0 ||
        data[11] !== 0 ||
        data[12] !== 0 ||
        !width ||
        !height ||
        width > (kind === "avatar" ? 512 : 1400) ||
        height > (kind === "avatar" ? 512 : 600)
      )
        bad();
    } else if (type === "IDAT") {
      if (dataEnded) bad();
      sawData = true;
      compressed.push(new Uint8Array(data));
    } else if (type === "IEND") {
      if (length !== 0 || !sawData) bad();
      ended = true;
      at += 12;
      break;
    } else {
      if (sawData) dataEnded = true;
      if (/^[A-Z]/.test(type)) bad();
    }
    at += length + 12;
  }
  if (!ended || at !== input.length || !header) bad();
  const expected = height * (width * channels + 1);
  let decoded: Uint8Array;
  try {
    decoded = await bounded(
      new Blob([join(compressed)])
        .stream()
        .pipeThrough(new DecompressionStream("deflate")),
      expected,
    );
  } catch {
    bad();
  }
  if (decoded!.length !== expected) bad();
  for (let row = 0; row < height; row++)
    if (decoded![row * (width * channels + 1)] > 4) bad();
  const encoded = await bounded(
    new Blob([decoded!] as BlobPart[])
      .stream()
      .pipeThrough(new CompressionStream("deflate")),
    8 * 1024 * 1024,
  );
  return {
    bytes: join([
      signature,
      chunk("IHDR", header!),
      chunk("IDAT", encoded),
      chunk("IEND", new Uint8Array()),
    ]),
    width,
    height,
  };
}
