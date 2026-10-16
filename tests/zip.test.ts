import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readZip, writeZip, ZipError } from '@main/characters/zip';

const any = { maxEntries: 100, maxBytes: () => 1024 * 1024, maxTotal: 1e9 };

describe('zip', () => {
  it('reads back what it wrote, compressed or not', () => {
    const text = Buffer.from('hello '.repeat(500));
    const noise = Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 7919) % 251));
    const zip = writeZip([
      { name: 'character.json', data: text },
      { name: 'assets/ünïcode name.png', data: noise },
      { name: 'empty.txt', data: Buffer.alloc(0) }
    ]);
    const back = readZip(zip, any);
    expect(back.map((entry) => entry.name)).toEqual(['character.json', 'assets/ünïcode name.png', 'empty.txt']);
    expect(back[0]?.data.equals(text)).toBe(true);
    expect(back[1]?.data.equals(noise)).toBe(true);
    expect(back[2]?.data.length).toBe(0);
    // Repetitive text shrinks.
    expect(zip.length).toBeLessThan(text.length);
  });

  it('skips what the caller does not want, unread', () => {
    const zip = writeZip([
      { name: 'keep.txt', data: Buffer.from('a') },
      { name: 'skip.txt', data: Buffer.from('b') }
    ]);
    const back = readZip(zip, { maxEntries: 10, maxBytes: (name) => (name === 'keep.txt' ? 10 : null), maxTotal: 1e9 });
    expect(back.map((entry) => entry.name)).toEqual(['keep.txt']);
  });

  it('refuses what is not a zip, is damaged, or is too much', () => {
    expect(() => readZip(Buffer.from('not a zip at all'), any)).toThrow(ZipError);
    expect(() => readZip(Buffer.alloc(0), any)).toThrow(ZipError);

    const zip = writeZip([{ name: 'a.txt', data: Buffer.from('x'.repeat(1000)) }]);
    expect(() => readZip(zip, { maxEntries: 0, maxBytes: () => 10_000, maxTotal: 1e9 })).toThrow(/files/);
    expect(() => readZip(zip, { maxEntries: 10, maxBytes: () => 999, maxTotal: 1e9 })).toThrow(/too big/);

    // A flipped byte in the packed data: the checksum catches it.
    const broken = Buffer.from(zip);
    broken[30 + 'a.txt'.length + 2] ^= 0xff;
    expect(() => readZip(broken, any)).toThrow(ZipError);
  });

  it('refuses too much altogether, and the same name twice', () => {
    const zip = writeZip([
      { name: 'a.txt', data: Buffer.alloc(600) },
      { name: 'b.txt', data: Buffer.alloc(600) }
    ]);
    expect(() => readZip(zip, { maxEntries: 10, maxBytes: () => 1000, maxTotal: 1000 })).toThrow(/together/);
    const twice = writeZip([
      { name: 'A.png', data: Buffer.from('1') },
      { name: 'a.png', data: Buffer.from('2') }
    ]);
    expect(() => readZip(twice, any)).toThrow(/twice/);
  });

  it('stops unpacking at the limit even when the header lies about the size', () => {
    // A bomb: declares 10 bytes, inflates to 10 MB.
    const zip = writeZip([{ name: 'bomb.txt', data: Buffer.from('tiny') }]);
    const bomb = deflateRawSync(Buffer.alloc(10 * 1024 * 1024));
    const nameEnd = 30 + 'bomb.txt'.length;
    const packedOld = zip.readUInt32LE(18);
    const lying = Buffer.concat([zip.subarray(0, nameEnd), bomb, zip.subarray(nameEnd + packedOld)]);
    lying.writeUInt16LE(8, 8);
    lying.writeUInt32LE(bomb.length, 18);
    lying.writeUInt32LE(10, 22);
    // The central directory moved by the difference; point the end record and the entry at it.
    const shift = bomb.length - packedOld;
    const endAt = lying.length - 22;
    lying.writeUInt32LE(lying.readUInt32LE(endAt + 16) + shift, endAt + 16);
    const centralAt = lying.readUInt32LE(endAt + 16);
    lying.writeUInt16LE(8, centralAt + 10);
    lying.writeUInt32LE(bomb.length, centralAt + 20);
    lying.writeUInt32LE(10, centralAt + 24);
    expect(() => readZip(lying, { maxEntries: 10, maxBytes: () => 1000, maxTotal: 1e9 })).toThrow(ZipError);
  });
});
