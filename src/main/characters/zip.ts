/**
 * Just enough of the zip format to pass a character around: write one, and
 * read one back — ours, or a folder zipped by Explorer or any other ordinary
 * tool. Stored and deflated entries; no zip64, no encryption, no spanning.
 *
 * Reading is defensive, because a zip from someone else is someone else's
 * file: every size is checked against the caller's limit before anything is
 * inflated, inflating itself stops at that limit, and each entry's checksum
 * has to match.
 */

import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

export interface ZipEntry {
  name: string;
  data: Buffer;
}

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const UTF8_FLAG = 0x0800;
const ENCRYPTED_FLAG = 0x0001;
const STORED = 0;
const DEFLATED = 8;

/** The DOS date and time zip wants: 2-second resolution, local time. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

export function writeZip(entries: readonly ZipEntry[], now = new Date()): Buffer {
  const { time, date } = dosDateTime(now);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const deflated = deflateRawSync(entry.data);
    // Already-compressed files (video, png) come out bigger: keep those as they are.
    const method = deflated.length < entry.data.length ? DEFLATED : STORED;
    const body = method === DEFLATED ? deflated : entry.data;
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    // Extra, comment, disk, internal and external attributes: all zero.
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** A zip that cannot be read, in words for the person who chose it. */
export class ZipError extends Error {}

export interface ReadLimits {
  /** Most entries, folders included. */
  maxEntries: number;
  /** Largest any one entry may unpack to; null skips the entry unread. */
  maxBytes: (name: string) => number | null;
  /** Most bytes everything read may unpack to, together. */
  maxTotal: number;
}

/** Every file in the zip whose name `maxBytes` accepts, unpacked and checked. */
export function readZip(zip: Buffer, limits: ReadLimits): ZipEntry[] {
  const endAt = findEnd(zip);
  const count = zip.readUInt16LE(endAt + 10);
  const size = zip.readUInt32LE(endAt + 12);
  const start = zip.readUInt32LE(endAt + 16);
  if (count === 0xffff || size === 0xffffffff || start === 0xffffffff) throw new ZipError('That zip is too large a kind to read (zip64).');
  if (count > limits.maxEntries) throw new ZipError(`That zip has ${count} files in it — more than a character could need.`);
  if (start + size > endAt) throw new ZipError('That zip is damaged.');

  const entries: ZipEntry[] = [];
  // Names as Windows sees them: two that differ only in case are one file.
  const seen = new Set<string>();
  let total = 0;
  let at = start;
  for (let i = 0; i < count; i += 1) {
    if (at + 46 > zip.length || zip.readUInt32LE(at) !== CENTRAL) throw new ZipError('That zip is damaged.');
    const flags = zip.readUInt16LE(at + 8);
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const packed = zip.readUInt32LE(at + 20);
    const unpacked = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const localAt = zip.readUInt32LE(at + 42);
    const rawName = zip.subarray(at + 46, at + 46 + nameLength);
    const name = rawName.toString(flags & UTF8_FLAG ? 'utf8' : 'latin1').replace(/\\/g, '/');
    at += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith('/')) continue;
    const max = limits.maxBytes(name);
    if (max === null) continue;
    if (flags & ENCRYPTED_FLAG) throw new ZipError(`${name} is encrypted.`);
    if (method !== STORED && method !== DEFLATED) throw new ZipError(`${name} is packed in a way SHARD cannot read.`);
    if (unpacked > max) throw new ZipError(`${name} is too big.`);
    total += unpacked;
    if (total > limits.maxTotal) throw new ZipError('Everything in that zip together is too big.');
    const key = name.toLowerCase();
    if (seen.has(key)) throw new ZipError(`${name} is in that zip twice.`);
    seen.add(key);

    if (localAt + 30 > zip.length || zip.readUInt32LE(localAt) !== LOCAL) throw new ZipError('That zip is damaged.');
    const dataAt = localAt + 30 + zip.readUInt16LE(localAt + 26) + zip.readUInt16LE(localAt + 28);
    if (dataAt + packed > zip.length) throw new ZipError('That zip is damaged.');
    const body = zip.subarray(dataAt, dataAt + packed);

    let data: Buffer;
    if (method === STORED) {
      data = Buffer.from(body);
    } else {
      try {
        // Stops at the limit whatever the header claimed: a lying size cannot make it unpack more.
        data = inflateRawSync(body, { maxOutputLength: Math.max(1, max) });
      } catch {
        throw new ZipError(`${name} could not be unpacked.`);
      }
    }
    if (data.length !== unpacked || crc32(data) !== crc) throw new ZipError(`${name} is damaged.`);
    entries.push({ name, data });
  }
  return entries;
}

/** The end-of-directory record: the last thing in the file, before a comment of up to 64 KB. */
function findEnd(zip: Buffer): number {
  const floor = Math.max(0, zip.length - 22 - 0xffff);
  for (let at = zip.length - 22; at >= floor; at -= 1) {
    if (zip.readUInt32LE(at) === END) return at;
  }
  throw new ZipError('That is not a zip file.');
}
