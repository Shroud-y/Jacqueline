/** What a character's visual script starts as: what it can do, and something small that works. */

export const SCRIPT_NAME = 'script.js';

export const SCRIPT_STARTER = `/*
 * This character's own script. It runs in a sealed layer laid over the
 * character's window: it can draw there (canvas, elements, animations), and a
 * saved change shows on the desktop at once.
 *
 * It cannot reach the internet, the disk, other characters, or the window
 * itself — only through what \`jacqueline\` offers:
 *
 *   jacqueline.on('speech', (line) => …)   a line starts: { id, text, durationMs }
 *   jacqueline.on('speechEnd', () => …)    it is over
 *   jacqueline.on('click', () => …)        the character was clicked
 *   jacqueline.on('pause' | 'resume', …)   nobody watching / back again: stop and start animations
 *   jacqueline.on('state', (state) => …)   any of the above, as { speaking, line, preview, playing }
 *   jacqueline.setMood('happy')            sets data-mood="happy" on the window, for its stylesheet
 *   jacqueline.asset('spark.png')          the address of one of its own files
 *
 * The layer sits above the character and never takes the mouse. To put it
 * underneath, add to the stylesheet:  .script-layer { z-index: -1; }
 *
 * Anything that keeps animating costs CPU for as long as it runs — as much as
 * a video does. Stop on 'pause'.
 */

// For example: a soft ring that pulses once each time the character speaks.
const ring = document.createElement('div');
ring.style.cssText =
  'position:fixed;left:50%;top:50%;width:40px;height:40px;margin:-20px;border-radius:50%;' +
  'border:3px solid #e8a33d;opacity:0;pointer-events:none';
document.body.append(ring);

jacqueline.on('speech', () => {
  ring.animate(
    [
      { opacity: 0.9, transform: 'scale(1)' },
      { opacity: 0, transform: 'scale(5)' }
    ],
    { duration: 900, easing: 'ease-out' }
  );
  jacqueline.setMood('talking');
});

jacqueline.on('speechEnd', () => jacqueline.setMood(null));
`;
