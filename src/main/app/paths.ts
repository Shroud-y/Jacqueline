import { app } from 'electron';
import { join } from 'node:path';

/**
 * Resource lookup differs between `electron-vite dev` (repo layout) and a
 * packaged build (electron-builder `extraResources`).
 */
function resourceRoot(): string {
  return app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources');
}

export const paths = {
  iconsDir: (): string => join(resourceRoot(), 'icons'),
  settingsFile: (): string => join(app.getPath('userData'), 'settings.json'),
  charactersRoot: (): string => join(app.getPath('userData'), 'characters'),
  stateFile: (): string => join(app.getPath('userData'), 'state.json'),
  logDir: (): string => join(app.getPath('userData'), 'logs')
};
