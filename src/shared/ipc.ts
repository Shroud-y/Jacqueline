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
  editorPreview: 'editor:preview'
} as const;
