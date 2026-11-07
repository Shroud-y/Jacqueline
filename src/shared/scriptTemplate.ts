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

export const BEHAVIOUR_NAME = 'behaviour.js';

export const BEHAVIOUR_STARTER = `/*
 * This character's behaviour script: logic of its own, alongside its rules.
 * It runs in a sandbox with no internet, no files and no other characters;
 * a saved change starts it again at once.
 *
 * Hearing what happens:
 *   on('programStarted', 'dota2.exe', (e) => …)   also 'programStopped', 'programFocused'; e.program
 *   on('clicked', () => …)
 *   on('startup', () => …)                        Jacqueline has just started
 *   on('returned', (e) => …)                      back at the computer after e.minutes away
 *   on('speechEnd', () => …)                      its line is over
 *   on('minute', (e) => …)                        every minute, e.time like "14:05"
 *   on('musicStarted', (e) => …)                  also 'musicStopped', 'trackChanged'; e.track, e.artist, e.app
 *   on('signal', 'build-ok', (e) => …)            Jacqueline.exe --signal build-ok [--text "…"]; e.name, e.text
 *                                                 on('signal', fn) hears every signal
 *   on('game', 'won', (e) => …)                   Dota 2: also 'lost', 'kill', 'death'; on('game', fn) hears all
 *                                                 e.event, e.hero, e.kills, e.deaths, e.streak
 *                                                 (game events have to be on in Settings)
 *
 * Doing things:
 *   say('greet')            a line from one of its groups (Lines tab)
 *   say({ text: 'Hi, {name}. It is {time}.' })
 *   sound('beep.wav')       one of its own files
 *   show(10) / hide(30)     come out for 10 seconds / hide for 30 minutes
 *   show(10, 'random')      come out somewhere random on the cursor's screen, for that while only
 *   setMood('sleepy')       data-mood on its window, for its stylesheet; setMood(null) clears it
 *   signal('hello', 'hi')   a signal for every character's rules and scripts; once a second at most
 *   setState('nap', 10)     wear one of its own states for 10 seconds, or until changed without a number;
 *                           setState(null) goes back. The key is shown under the state's name in Appearance
 *   log('…')                into Jacqueline's log
 *
 * And:
 *   after(5000, fn) / every(60000, fn) → id, cancel(id)   (every: once a second at most)
 *   running('obs.exe')      true / false — null the first time, while it is being looked at
 *   music()                 { playing, track, artist, app } — null the first time, while it is being looked at
 *   now()                   milliseconds, like Date.now()
 *   state                   an object kept across restarts (64 KB at most)
 *
 * Each event gets 50 ms and the script 16 MB; running into either three times
 * in a row stops it until you press Restart.
 */

// For example: it counts its clicks, and says something about every tenth.
on('clicked', () => {
  state.clicks = (state.clicks || 0) + 1;
  if (state.clicks % 10 === 0) say({ text: 'That is ' + state.clicks + ' clicks, {name} is counting.' });
});
`;
