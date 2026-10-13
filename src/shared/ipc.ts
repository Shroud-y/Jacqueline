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
  stageDragEnd: 'stage:dragEnd'
} as const;
