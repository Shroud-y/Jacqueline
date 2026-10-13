import { Menu, Tray, nativeImage, type MenuItemConstructorOptions, type Point } from 'electron';
import { join } from 'node:path';
import { createLogger } from './logger';
import type { MenuAction, MenuEntry } from './menus';

const log = createLogger('tray');

export interface TrayDeps {
  iconPath: string;
  /** Asked for every time the menu is rebuilt, so it is never out of date. */
  menu: () => MenuEntry[];
  tooltip: () => string;
  dispatch: (action: MenuAction) => void;
  /** The icon itself was clicked. */
  onClick: () => void;
}

export class AppTray {
  private tray: Tray | null = null;

  constructor(private readonly deps: TrayDeps) {}

  create(): void {
    const image = nativeImage.createFromPath(this.deps.iconPath);
    this.tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
    this.tray.on('click', () => this.deps.onClick());
    this.refresh();
    log.info('tray created');
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }

  refresh(): void {
    if (!this.tray) return;
    this.tray.setContextMenu(this.build(this.deps.menu()));
    this.tray.setToolTip(this.deps.tooltip());
  }

  /**
   * A menu somewhere other than the tray — under the cursor, when a character
   * is right-clicked. Shown through the tray because a character's own window
   * cannot take focus, and a menu needs an owner that can.
   */
  popUp(entries: MenuEntry[], point: Point): void {
    this.tray?.popUpContextMenu(this.build(entries), point);
  }

  private build(entries: MenuEntry[]): Menu {
    return Menu.buildFromTemplate(
      entries.map((entry): MenuItemConstructorOptions => {
        switch (entry.kind) {
          case 'separator':
            return { type: 'separator' };
          case 'label':
            return { label: entry.label, enabled: false };
          case 'action':
            return { label: entry.label, click: () => this.deps.dispatch(entry.action) };
          case 'check':
            return {
              label: entry.label,
              type: 'checkbox',
              checked: entry.checked,
              click: () => this.deps.dispatch(entry.action)
            };
        }
      })
    );
  }

  static defaultIconPath(iconsDir: string): string {
    return join(iconsDir, 'tray.ico');
  }
}
