import { app } from 'electron';

import { configureLogger, createLogger } from './app/logger';
import { paths } from './app/paths';
import { SettingsStore } from './app/settings';
import { AppTray } from './app/tray';
import { handleAssetProtocol, registerAssetScheme } from './characters/assetProtocol';
import { CharacterStore } from './characters/store';

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
  log.info(`characters: ${entries.length}${broken > 0 ? ` (${broken} unreadable)` : ''}`);

  reconcileAutostart(settings.current.startWithSystem);
  settings.onChange((next) => reconcileAutostart(next.startWithSystem));

  const tray = new AppTray(AppTray.defaultIconPath(paths.iconsDir()), {
    quit: () => app.quit()
  });
  tray.create();

  // The app lives in the tray; it never quits from window state.
  app.on('window-all-closed', () => {
    /* no-op by design */
  });

  app.on('before-quit', () => tray.destroy());

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
