/** Every IPC channel name used in the app. No string literals elsewhere. */

export const IPC = {
  // main → renderer (overlay)
  speechShow: 'speech:show',
  speechHide: 'speech:hide',
  speechInterrupt: 'speech:interrupt',
  stateUpdate: 'state:update',

  // renderer (overlay) → main
  overlaySetInteractive: 'overlay:setInteractive',
  /** Where the pinned character can be clicked and dragged, or null for nowhere. */
  overlaySetHotRect: 'overlay:setHotRect',
  overlayDragStart: 'overlay:dragStart',
  overlayDragEnd: 'overlay:dragEnd',
  /** The character was clicked while it had nothing to say. */
  overlayPoke: 'overlay:poke',
  /** The character was right-clicked. */
  overlayMenu: 'overlay:menu',
  speechFinished: 'speech:finished',
  speechDismissed: 'speech:dismissed',

  // main ↔ debug window
  debugSnapshot: 'debug:snapshot',
  debugRequestSnapshot: 'debug:requestSnapshot',
  debugFireEvent: 'debug:fireEvent',

  // main ↔ settings window
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsUpdated: 'settings:updated',
  /** The stock settings, for "restore defaults". */
  settingsDefaults: 'settings:defaults',
  settingsReset: 'settings:reset',

  // main ↔ settings window: live state and the switches that are not stored
  statusGet: 'status:get',
  statusUpdated: 'status:updated',
  statusSetMuted: 'status:setMuted',
  statusSetSnooze: 'status:setSnooze',
  /** Speak a line now, to check volume, sounds or placement. */
  sayNow: 'companion:sayNow',
  /** Native folder picker for the watched-folders list. */
  foldersPick: 'folders:pick',

  // main ↔ settings window: preset asset management
  presetsPickAsset: 'presets:pickAsset',
  presetsClearAsset: 'presets:clearAsset',
  presetsAssetStatus: 'presets:assetStatus',
  presetsDelete: 'presets:delete',
  presetsDuplicate: 'presets:duplicate',
  presetsOpenFolder: 'presets:openFolder',
  /** Writes the stock phrase bank somewhere the user picks, as a starting point. */
  bankSaveTemplate: 'bank:saveTemplate'
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
