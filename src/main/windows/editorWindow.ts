import { BrowserWindow } from 'electron';
import { createLogger } from '../app/logger';
import { loadPage } from './rendererUrl';

const log = createLogger('editor');

/**
 * Where characters are built. An ordinary window, made when it is asked for
 * and destroyed when it is closed: with it shut, none of the editor is in
 * memory.
 */
export class EditorWindow {
  private win: BrowserWindow | null = null;

  /** The editor went away: whatever it was showing on the desktop should stop. */
  onClosed: (() => void) | null = null;

  constructor(
    private readonly preloadPath: string,
    private readonly iconPath: string
  ) {}

  get browserWindow(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null;
  }

  open(): void {
    const existing = this.browserWindow;
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      return;
    }

    const win = new BrowserWindow({
      width: 1040,
      height: 700,
      minWidth: 820,
      minHeight: 520,
      title: 'Jacqueline — Characters',
      icon: this.iconPath,
      backgroundColor: '#14161b',
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    this.win = win;

    win.setMenuBarVisibility(false);
    win.once('ready-to-show', () => win.show());
    win.on('closed', () => {
      if (this.win === win) this.win = null;
      this.onClosed?.();
    });

    // Nothing in the editor may navigate or open windows.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.webContents.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) this.onClosed?.();
    });
    win.webContents.on('preload-error', (_event, preload, error) => {
      log.error(`editor preload failed (${preload}): ${error.message}`);
    });
    win.webContents.on('did-fail-load', (_event, code, description, url) => {
      log.error(`editor failed to load (${code} ${description}) ${url}`);
    });
    win.webContents.on('console-message', (event) => {
      if (event.level === 'error' || event.level === 'warning') log.warn(`editor console: ${event.message}`);
    });

    void loadPage(win, 'editor').catch((err) => log.error(`failed to load editor: ${String(err)}`));
  }

  send(channel: string, payload: unknown): void {
    this.browserWindow?.webContents.send(channel, payload);
  }

  destroy(): void {
    this.browserWindow?.destroy();
    this.win = null;
  }
}
