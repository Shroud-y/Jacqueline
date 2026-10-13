import { join } from 'node:path';

/** `host` is the empty page every character window is opened from. */
export type RendererPage = 'host' | 'stage' | 'editor';

const devUrl = (): string | undefined => process.env['ELECTRON_RENDERER_URL'];

/** Dev serves the pages over HTTP; packaged builds load them from disk. */
export function loadPage(
  win: Electron.BrowserWindow,
  page: RendererPage
): Promise<void> {
  const base = devUrl();
  if (base) return win.loadURL(`${base}/${page}.html`);
  return win.loadFile(join(__dirname, `../renderer/${page}.html`));
}
