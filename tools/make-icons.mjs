/**
 * Generates resources/icons/app.ico, tray.ico and app.png from icon.svg.
 *
 * Runs under Electron (`pnpm icons`), which is what draws the SVG: each size
 * is rasterised from the vector itself, not scaled down from a big bitmap, so
 * 16 px stays as crisp as 16 px can be. The ICO is packed here by hand — PNG
 * entries, which Windows has read since Vista — so the repo needs no image
 * dependency.
 */
import { app, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', 'resources', 'icons');
const svg = readFileSync(join(dir, 'icon.svg'), 'utf8');

/** One PNG per size, drawn by the page from the SVG. */
async function rasterise(win, sizes) {
  const url = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const pngs = await win.webContents.executeJavaScript(`(async () => {
    const image = new Image();
    image.src = ${JSON.stringify(url)};
    await image.decode();
    return ${JSON.stringify(sizes)}.map((size) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      canvas.getContext('2d').drawImage(image, 0, 0, size, size);
      return canvas.toDataURL('image/png').split(',')[1];
    });
  })()`);
  return new Map(sizes.map((size, i) => [size, Buffer.from(pngs[i], 'base64')]));
}

/** An ICO of PNG entries: a 6-byte header, a 16-byte entry per image, then the images. */
function ico(images) {
  const sizes = [...images.keys()];
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, i) => {
    const at = 6 + i * 16;
    const png = images.get(size);
    header.writeUInt8(size >= 256 ? 0 : size, at);
    header.writeUInt8(size >= 256 ? 0 : size, at + 1);
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(png.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...sizes.map((size) => images.get(size))]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('about:blank');
  const images = await rasterise(win, [16, 20, 24, 32, 40, 48, 64, 128, 256]);
  const pick = (sizes) => new Map(sizes.map((size) => [size, images.get(size)]));
  writeFileSync(join(dir, 'tray.ico'), ico(pick([16, 20, 24, 32, 40])));
  writeFileSync(join(dir, 'app.ico'), ico(pick([16, 24, 32, 48, 64, 128, 256])));
  writeFileSync(join(dir, 'app.png'), images.get(256));
  console.log('wrote tray.ico, app.ico, app.png');
  app.exit(0);
});
