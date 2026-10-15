import { app, dialog, powerMonitor, screen, shell } from 'electron';
import { join } from 'node:path';

import { ASSET_EXTENSIONS, type Character } from '@shared/character';
import { IPC } from '@shared/ipc';

import { configureLogger, createLogger } from './app/logger';
import { characterMenu, trayMenu, trayTooltip, type MenuAction, type MenuState } from './app/menus';
import { paths } from './app/paths';
import { SettingsStore } from './app/settings';
import { AppTray } from './app/tray';
import { handleAssetProtocol, registerAssetScheme } from './characters/assetProtocol';
import { registerEditorIpc } from './characters/editorIpc';
import { isPresent } from './characters/presence';
import { isWithinClockWindow, minutesOfDay } from './engine/timeOfDay';
import { runActions } from './engine/actions';
import { SpeechDirector } from './engine/director';
import { RuleRunner } from './engine/ruleRunner';
import { RecentHistory } from './engine/selector';
import { CharacterStore } from './characters/store';
import { Visibility } from './characters/visibility';
import { PresenceWatcher } from './sensors/presenceWatcher';
import { loadDesktopSensors } from './sensors/win32';
import { CharacterWindows } from './windows/characterWindows';
import { EditorWindow } from './windows/editorWindow';

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
    },
    // A click while it is talking is "enough, thank you"; otherwise it is a click.
    onClick: (id) => (director.isSpeaking(id) ? director.dismiss(id) : rules.event({ type: 'clicked', characterId: id })),
    speechFor: (id) => director.current(id),
    isOnStage: (id) => director.isOnStage(id)
  });

  const director = new SpeechDirector();
  director.onChange(() => windows.refresh());

  // Behaviour: rules fire, their actions run, lines go to the director.
  const history = new RecentHistory();
  const isSilenced = (): boolean => {
    const { muted, quietHours } = settings.current;
    return muted || (quietHours.enabled && isWithinClockWindow(minutesOfDay(Date.now()), quietHours.from, quietHours.to));
  };
  const rules = new RuleRunner({
    loadSensors: loadDesktopSensors,
    idleSeconds: () => powerMonitor.getSystemIdleTime(),
    onFired: (fired) =>
      runActions(fired, {
        isSilenced,
        say: (character, text) => {
          log.info(`"${character.name}" says: ${text}`);
          director.say(character.id, text);
        },
        playSound: (character, file) => windows.playSound(character.id, file, character.audio.volume),
        show: (character, ms) => windows.showFor(character.id, ms),
        hide: (character, ms) => visibility.hideFor(character.id, ms),
        log: (message) => log.info(message),
        history,
        rng: Math.random
      })
  });
  // Someone hidden for now does nothing either.
  const acting = (): Character[] =>
    characters.list().flatMap((entry) => (entry.ok && entry.character.enabled && !visibility.isHidden(entry.id) ? [entry.character] : []));
  rules.setCharacters(acting());
  presence.onChange(() => windows.refresh());
  presence.setCharacters(watched());
  windows.start();

  reconcileAutostart(settings.current.startWithSystem);
  settings.onChange((next) => reconcileAutostart(next.startWithSystem));

  const editor = new EditorWindow(join(__dirname, '../preload/editor.js'), join(paths.iconsDir(), 'app.ico'));
  registerEditorIpc(characters, {
    pickFile: async (kinds) => {
      const options = {
        properties: ['openFile' as const],
        filters: [{ name: 'Files', extensions: kinds.flatMap((kind) => ASSET_EXTENSIONS[kind].map((ext) => ext.slice(1))) }]
      };
      const parent = editor.browserWindow;
      const picked = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
      return picked.canceled ? null : (picked.filePaths[0] ?? null);
    },
    openFolder: async (id) => {
      const failure = await shell.openPath(paths.characterDir(id));
      return failure ? { ok: false, error: failure } : { ok: true };
    },
    setPreview: (id) => windows.setPreview(id),
    // Tried from the editor: now, in place of whatever it was saying, mute or not.
    sayNow: (character, text, line) => {
      director.dismiss(character.id);
      director.say(character.id, text);
      if (line.audio) windows.playSound(character.id, line.audio, character.audio.volume);
    }
  });
  editor.onClosed = () => windows.setPreview(null);

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
      case 'openEditor':
        return editor.open();
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
    const active = acting();
    rules.setCharacters(active);
    // Whoever is off, gone or hidden stops mid-sentence.
    const activeIds = new Set(active.map((character) => character.id));
    for (const entry of characters.list()) if (!activeIds.has(entry.id)) director.forget(entry.id);
    windows.refresh();
    tray.refresh();
    editor.send(IPC.editorChanged, characters.list());
  };
  characters.onChange(resync);
  visibility.onChange(resync);
  settings.onChange((next) => {
    if (next.muted) director.silenceAll();
    tray.refresh();
  });

  // Started again while already running: that is someone looking for the
  // app, and the editor is the only window it has to show them.
  app.on('second-instance', () => editor.open());
  if (process.argv.includes('--editor')) editor.open();

  // The app lives in the tray; it never quits from window state.
  app.on('window-all-closed', () => {
    /* no-op by design */
  });

  app.on('before-quit', () => {
    editor.destroy();
    rules.stop();
    director.silenceAll();
    windows.stop();
    presence.stop();
    visibility.stop();
    tray.destroy();
  });

  // Once the windows have had a moment to come up, so a sound has somewhere to play.
  setTimeout(() => rules.event({ type: 'startup' }), 3_000).unref?.();

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
