import { screen, type Display } from 'electron';

/* Where the window goes is arithmetic, and lives in `shared/overlayLayout.ts`
   where it can be tested without Electron. This file is the one thing that
   needs Electron to answer: which screen. */

/** The display under the cursor, which is where the user is looking. */
export function displayUnderCursor(): Display {
  try {
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  } catch {
    return screen.getPrimaryDisplay();
  }
}
