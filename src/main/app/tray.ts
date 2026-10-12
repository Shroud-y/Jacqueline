import { Menu, Tray, nativeImage } from 'electron';
import { join } from 'node:path';
import { createLogger } from './logger';

const log = createLogger('tray');

export interface TrayActions {
  quit(): void;
}

export class AppTray {
  private tray: Tray | null = null;

  constructor(
    private readonly iconPath: string,
    private readonly actions: TrayActions
  ) {}

  create(): void {
    const image = nativeImage.createFromPath(this.iconPath);
    this.tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
    this.tray.setToolTip('SHARD');
    this.refresh();
    log.info('tray created');
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }

  refresh(): void {
    this.tray?.setContextMenu(this.buildMenu());
  }

  private buildMenu(): Menu {
    return Menu.buildFromTemplate([
      { label: 'SHARD', enabled: false },
      { type: 'separator' },
      { label: 'Quit', click: () => this.actions.quit() }
    ]);
  }

  static defaultIconPath(iconsDir: string): string {
    return join(iconsDir, 'tray.ico');
  }
}
