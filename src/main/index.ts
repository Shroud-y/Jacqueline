import { app } from 'electron';

import { configureLogger, createLogger } from './app/logger';
import { paths } from './app/paths';
import { AppTray } from './app/tray';

const log = createLogger('main');

if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  void bootstrap();
}

async function bootstrap(): Promise<void> {
  await app.whenReady();

  configureLogger({ directory: paths.logDir(), level: app.isPackaged ? 'info' : 'debug' });
  app.setAppUserModelId('dev.codex.companion');

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
