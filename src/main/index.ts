import { app, powerMonitor, screen, shell } from 'electron';
import { join } from 'node:path';

import type { Character } from '@shared/character';

import { configureLogger, createLogger } from './app/logger';
import { characterMenu, trayMenu, trayTooltip, type MenuAction, type MenuState } from './app/menus';
import { paths } from './app/paths';
import { SettingsStore } from './app/settings';
import { AppTray } from './app/tray';
import { handleAssetProtocol, registerAssetScheme } from './characters/assetProtocol';
import { isPresent } from './characters/presence';
import { CharacterStore } from './characters/store';
import { Visibility } from './characters/visibility';
import { PresenceWatcher } from './sensors/presenceWatcher';
import { loadDesktopSensors } from './sensors/win32';
import { CharacterWindows } from './windows/characterWindows';

const log = createLogger('main');

// Must run before `app.whenReady` — character windows load their assets through it.
registerAssetScheme();

if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  void bootstrap();
}

async function bootstrap(): Promise<void> {
  await app.whenReady();

  configureLogger({ directory: paths.logDir(), level: app.isPackaged ? 'info' : 'debug' });
  app.setAppUserModelId('dev.codex.companion');

  const settings = new SettingsStore(paths.settingsFile());
  const characters = new CharacterStore(paths.charactersRoot());
  handleAssetProtocol(characters);

  const entries = characters.list();
  const broken = entries.filter((entry) => !entry.ok).length;
  log.info(`characters: ${entries.length}${broken > 0 ? ` (${broken} unreadable)` : ''} in ${paths.charactersRoot()}`);

  const presence = new PresenceWatcher({
    loadSensors: loadDesktopSensors,
    activity: {
      idleSeconds: () => powerMonitor.getSystemIdleTime(),
      onLockChange: (listener) => {
        const lock = (): void => listener(true);
        const unlock = (): void => listener(false);
        powerMonitor.on('lock-screen', lock);
        powerMonitor.on('unlock-screen', unlock);
        return () => {
          powerMonitor.off('lock-screen', lock);
          powerMonitor.off('unlock-screen', unlock);
        };
      }
    },
    // Windows answers in physical pixels; the windows are placed in Electron's scaled ones.
    toScreen: (rect) => screen.screenToDipRect(null, rect)
  });
  const visibility = new Visibility();
  // Someone hidden for now needs nothing watched on their behalf: with
  // everyone hidden, every sensor and timer goes with them.
  const watched = (): Character[] =>
    characters.list().flatMap((entry) => (entry.ok && !visibility.isHidden(entry.id) ? [entry.character] : []));

  const windows = new CharacterWindows(characters, join(__dirname, '../preload/stage.js'), {
    isPresent: (character, anchor) =>
      !visibility.isHidden(character.id) && isPresent(character, presence.facts, anchor),
    isWatching: () => presence.watching,
    onMenu: (id) => {
      const character = characters.get(id);
      if (character) tray.popUp(characterMenu(character), screen.getCursorScreenPoint());
    }
  });
  presence.onChange(() => windows.refresh());
  presence.setCharacters(watched());
  windows.start();

  reconcileAutostart(settings.current.startWithSystem);
  settings.onChange((next) => reconcileAutostart(next.startWithSystem));

  const menuState = (): MenuState => ({
    everyoneHidden: visibility.everyoneHidden,
    muted: settings.current.muted,
    isSnoozed: (id) => visibility.isSnoozed(id)
  });

  const dispatch = (action: MenuAction): void => {
    switch (action.type) {
      case 'setEnabled': {
        const character = characters.get(action.id);
        if (!character) return;
        // Switched on by hand means wanted now, whatever it was hidden for.
        if (action.enabled) visibility.show(action.id);
        const result = characters.save({ ...character, enabled: action.enabled });
        if (!result.ok) log.warn(`could not switch "${action.id}": ${result.error}`);
        return;
      }
      case 'hide':
        return visibility.hide(action.id, action.choice);
      case 'show':
        return visibility.show(action.id);
      case 'setEveryoneHidden':
        return visibility.setEveryoneHidden(action.hidden);
      case 'setMuted':
        settings.update({ muted: action.muted });
        return;
      case 'openCharactersFolder':
        void shell.openPath(paths.charactersRoot()).then((failure) => {
          if (failure) log.warn(`cannot open the characters folder: ${failure}`);
        });
        return;
      case 'quit':
        return app.quit();
    }
  };

  const tray = new AppTray({
    iconPath: AppTray.defaultIconPath(paths.iconsDir()),
    menu: () => trayMenu(characters.list(), menuState()),
    tooltip: () => trayTooltip(menuState()),
    dispatch,
    // The quick way to clear the screen, and to get everyone back.
    onClick: () => visibility.toggleEveryone()
  });
  tray.create();

  const resync = (): void => {
    presence.setCharacters(watched());
    windows.refresh();
    tray.refresh();
  };
  characters.onChange(resync);
  visibility.onChange(resync);
  settings.onChange(() => tray.refresh());

  // The app lives in the tray; it never quits from window state.
  app.on('window-all-closed', () => {
    /* no-op by design */
  });

  app.on('before-quit', () => {
    windows.stop();
    presence.stop();
    visibility.stop();
    tray.destroy();
  });

  log.info('SHARD ready');
}

/** Reads the real value and reconciles, rather than assuming. */
function reconcileAutostart(wanted: boolean): void {
  // A development run is `electron.exe` with the project as an argument. The
  // login item it would register is the bare binary — which opens Electron's
  // welcome window at every login — under the same name as the installed
  // app's entry, which it would overwrite.
  if (!app.isPackaged) return;
  try {
    const current = app.getLoginItemSettings({ args: ['--hidden'] });
    if (current.openAtLogin === wanted) return;
    app.setLoginItemSettings({ openAtLogin: wanted, args: ['--hidden'] });
    log.info(`autostart set to ${wanted}`);
  } catch (err) {
    log.warn(`cannot reconcile autostart: ${String(err)}`);
  }
}
