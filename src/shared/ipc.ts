/** Every IPC channel, in one place. */
export const IPC = {
  /** renderer → main, invoke: what this window should draw. */
  stageGet: 'stage:get',
  /** main → renderer: the same, whenever it changes. */
  stageUpdate: 'stage:update',
  /** renderer → main: the first frame is up, the window may be shown. */
  stagePainted: 'stage:painted',
  /** renderer → main: the character has been picked up / put down. */
  stageDragStart: 'stage:dragStart',
  stageDragEnd: 'stage:dragEnd',
  /** renderer → main: the character was right-clicked. */
  stageMenu: 'stage:menu',
  /** renderer → main: the character was clicked (pressed and let go without dragging). */
  stageClick: 'stage:click',
  /** main → renderer: play this sound. */
  stageSound: 'stage:sound',

  /** editor → main, invoke: every character, usable or not. */
  editorList: 'editor:list',
  /** main → editor: the same, whenever anything about any of them changes. */
  editorChanged: 'editor:changed',
  editorCreate: 'editor:create',
  editorSave: 'editor:save',
  editorDuplicate: 'editor:duplicate',
  editorRemove: 'editor:remove',
  /** Opens a file picker and copies the chosen file into the character's assets. */
  editorImportAsset: 'editor:importAsset',
  editorOpenFolder: 'editor:openFolder',
  editorAssets: 'editor:assets',
  editorReleaseAsset: 'editor:releaseAsset',
  /** editor → main: which character is being laid out right now, or nobody. */
  editorPreview: 'editor:preview',
  /** editor → main: say this line now, to see and hear it where it will be. */
  editorTestLine: 'editor:testLine',
  /** editor → main: do what a rule does, now. */
  editorTestRule: 'editor:testRule',
  /** editor → main, invoke: the programs running right now, for suggestions. */
  editorRunningPrograms: 'editor:runningPrograms',
  /** Opens the folder every character lives in. */
  editorOpenRoot: 'editor:openRoot',
  /** Saves a character as a zip, where the user picks. */
  editorExport: 'editor:export',
  /** Makes a new character from a zip: dropped, or picked. */
  editorImport: 'editor:import',

  /** editor → main, invoke: the app's settings, and what this build can do with them. */
  editorSettingsGet: 'settings:get',
  editorSettingsUpdate: 'settings:update',
  /** main → editor: the settings changed — from the editor, or from the tray. */
  editorSettingsChanged: 'settings:changed'
} as const;
