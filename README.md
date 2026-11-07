<img src="resources/icons/app.png" width="96" height="96" alt="Jacqueline app icon">

# Jacqueline

This is my hobby project, formerly called SHARD. It started as Ordis from Warframe living on my PC —
a little companion in the tray that noticed what I was doing and said
something about it. Now it is the thing underneath him: a way to build your
own characters for your desktop.

A character is a picture or a video that sits on your screen, says lines now
and then, and comes and goes when you tell it to. An anime clip in the corner
that is there only while Dota 2 is running. A mascot that greets you in the
morning and tells you to go to bed at midnight. Ordis again, if you write his
lines. Jacqueline ships no characters of its own — you make them.

It is built to be cheap to keep running: a still character costs about half a
percent of one CPU core, and nothing at all while it is off screen.

## Making a character

Right-click the tray icon → **Options…** opens the editor. Every change is
saved as you make it and shows on the character on your desktop straight
away; there is no Save button.

- **General** — when it is on screen: always, while a program is running,
  while a program is the window you are working in, or only when it has
  something to say. It can step aside for fullscreen games. At the bottom,
  **What it costs** says what keeping it around takes.
- **Appearance** — a picture, a GIF or a video for when it is idle, and optionally
  another while it is speaking and another while music plays. Size, opacity, mirroring. A video can **rest**
  between plays, which is the cheapest way to have a character that moves.
  **New state** adds looks of your own, under names of your own, for rules and
  scripts to switch to. A line still takes over from them, and they take over from music.
- **Appearance → Background** — takes a plain background colour out of a
  picture or a video, for files with no transparency of their own such as an
  `.mp4`: click the background to choose the colour, then set how far from it
  still counts. It needs a colour the character itself does not have, and a
  video costs about twice as much this way; a `.webm` with transparency costs
  nothing extra.
- **Appearance → Style** — a stylesheet of the character's own: shadows,
  filters, animations, how its text looks. **Start one from a template** gives
  you a commented `style.css` listing what can be styled; save it in any
  editor and the character on your desktop changes at once.
- **Appearance → Script** — a `.js` of the character's own that draws over it
  (sparks, rings, anything on a canvas) and hears when it speaks or is
  clicked; `jacqueline.setMood('…')` hands a mood to its stylesheet as
  `[data-mood]`. It runs sealed off — no internet, no files, no other
  characters — and a script that came with an imported character waits for
  you to allow it.
- **Layout** — a canvas with the character and its text on it: where the text
  sits, how big, in what font (yours too: drop in a `.ttf`), colour, outline,
  shadow, background, and how it appears (typed out, faded in, or at once).
  While this tab is open the character shows sample text on your desktop, so
  you can see it where it will be. **Crop** trims the picture or video: drag its
  edges, the file stays whole, and what is cut off takes no mouse.
- **Behaviour** — rules. Each one reads as a sentence: *When **dota2.exe**
  starts → say a line from **greet***. Open one to change it:
  - **When**: a program starts, closes or comes to the front; every day at a
    time; every so often (somewhere between N and M minutes); you come back
    after being away; Jacqueline starts; the character is clicked; music
    starts or stops; the track changes; a signal comes from outside (see
    below); something happens in Dota 2 (see below).
  - **Only if**: by chance (a percentage), between two times of day, a
    program is or is not running, music is or is not playing. "Music" is
    anything a player reports to Windows, so a video in a browser counts.
  - **Then**: say a line from a group, play a sound, come out for a while
    (even if it would not be on screen otherwise — where it usually is, or
    somewhere random on the screen the mouse is on, for that while only), hide for a while, change
    look to one of its own states, for a while or until changed.
  - **Wait at least** … before it can happen again.
  - **Test now** does what the rule does, right away.
- **Behaviour → Script** — when rules are not enough: a `behaviour.js` with
  logic of its own. It hears programs starting, clicks, the minute, you coming
  back and its own lines ending; it says, plays, shows, hides, sets a mood,
  changes state and keeps a `state` that survives restarts. **Start one from a template**
  gives you a commented file listing everything it can do. It runs in a
  sandbox (QuickJS) with no internet and no files, 50 ms per event and 16 MB
  at most; errors show in the editor with their line.
- **Lines** — groups of lines a rule can pick from. Each line can have a
  weight (how often it comes up) and a sound. The same line is never said
  twice in a row. A line can mention what happened with a slot: `{name}`
  (the character's), `{time}`, `{program}` (for rules about a program) and
  `{minutes}` (how long you were away), `{track}` and `{artist}` (what is
  playing), `{text}` (what came with a signal), `{hero}`, `{kills}`, `{deaths}`
  and `{streak}` (in a Dota 2 match). A line whose slot cannot be filled
  is skipped, never shown with a hole in it. **Test** says it on your desktop.
- **Audio** — volume, a video's own sound (on unless you turn it off), an
  ambient sound that loops while the character is on screen, and sounds for
  coming on screen and leaving.

### Signals from outside

Anything that can start a program can poke a character: a build script, a
VS Code task, a scheduled job.

```bat
"%LOCALAPPDATA%\Programs\Jacqueline\Jacqueline.exe" --signal build-ok
"%LOCALAPPDATA%\Programs\Jacqueline\Jacqueline.exe" --signal build-failed --text "3 errors"
```

(That is where the installer puts it unless you chose another folder.)

A rule *When signal **build-ok** comes* fires on the first; a line on the
second can say `Broke again: {text}`. **Copy command** next to the signal's
name puts the exact command for your install on the clipboard. In PowerShell,
put `&` in front of it. A name is letters, digits, `-`, `_` and `.`; the text
is up to 200 characters.

The command hands the signal to Jacqueline and is gone at once; it never opens
the editor. If Jacqueline is not running, nothing happens — a build script
never starts it for you. A behaviour script hears the same with
`on('signal', 'build-ok', (e) => …)`.

A VS Code task (PowerShell is its shell on Windows) that reports how a build went:

```json
{
  "label": "build",
  "type": "shell",
  "command": "npm run build; $ok = $?; $j = \"$env:LOCALAPPDATA/Programs/Jacqueline/Jacqueline.exe\"; if ($ok) { & $j --signal build-ok } else { & $j --signal build-failed }"
}
```

### Dota 2

A character can react to your Dota 2 matches: come out clapping when you win,
sulk when you lose, cheer a kill streak. Dota itself tells Jacqueline what is
going on, through Valve's own Game State Integration — nothing reads the
game's memory or the screen.

1. **Settings** → **Games** → switch on **Dota 2 game events**.
2. **Set up Dota 2** writes `gamestate_integration_jacqueline.cfg` into Dota's
   `game\dota\cfg\gamestate_integration\` folder (found through Steam; if it is
   not, **Choose Dota's folder…** and pick `dota 2 beta`). It shows where it wrote it.
3. **Restart Dota 2** — it reads the file only when it starts.
4. A rule: *When* **Something happens in Dota 2** → you win the match, you lose
   it, you get a kill, you die, or your kill streak reaches a number. A line can
   say `GG with {hero}: {kills} kills, {deaths} deaths.`

A win or a loss is told once per match, however long you sit on the results
screen, and not at all if Jacqueline starts while the match is already over.
Matches you watch rather than play do not count. A behaviour script hears the
same with `on('game', 'won', (e) => …)` (also `'lost'`, `'kill'`, `'death'`,
or `on('game', fn)` for all; `e.hero`, `e.kills`, `e.deaths`, `e.streak`).

Dota sends to `127.0.0.1` only, with a token of its own that Jacqueline checks
on every update. Jacqueline listens only while game events are on **and** some
rule or script waits for one; otherwise the port is closed. If another program
has the port, change it under **Port** and set up Dota 2 again.

On the desktop: **drag** a character anywhere (other monitors too), **click**
it to set off its "clicked" rules, click while it is talking to dismiss the
line, **right-click** to hide it for a while or turn it off.

**Settings** at the bottom of the editor's list: start with Windows, mute
everyone, quiet hours (nobody says anything between two times; characters stay
where they are), looking for new versions — once a day, and when there is
one it says so in the tray and in Settings; it never downloads anything itself —
and Dota 2 game events.

## Sharing a character

**···** → **Export…** saves a character as one `.zip` with every file it uses.
**Import…** under the list (or dropping a `.zip` on it) makes a new character
from one. Importing never overwrites anything; the same zip twice gives two
characters.

<details>
<summary>What is in a character</summary>

A character is a folder under `%APPDATA%\jacqueline\characters\` (tray →
**Open characters folder** takes you there):

```
<id>/
  character.json   everything about it
  assets/          its pictures, videos, sounds and fonts, by plain file name
```

You can copy a folder there by hand — its name has to be lowercase letters,
digits and dashes — and Jacqueline picks it up the next time it starts. A `character.json` that cannot be read shows in the editor with the
reason, and its files are left alone.

Files it takes: pictures `.png .webp .jpg .gif`, video `.webm .mp4`, sound
`.ogg .wav .mp3`, fonts `.ttf .otf .woff .woff2`. A GIF, or an animated PNG or
WebP, moves and rests like a video and stops when nobody is there. A small one
costs about what a video does; for anything big use a video, because a video is
decoded by the graphics card and a GIF is not.

</details>

<details>
<summary>What it reads, and what it doesn't</summary>

Only what the characters you have made actually need, and only while they
need it:

- the **file names of running programs** (every 5 seconds), for characters and
  rules tied to a program;
- **which program is in front** — told by Windows when it changes, not polled;
- whether that window **covers the whole screen**, for "step aside";
- **what is playing** — the player, track and artist Windows reports, told when
  it changes, only for characters whose rules, lines or scripts ask;
- how long since you last **touched the mouse or keyboard**, so a video stops
  moving while nobody is watching and "you come back" rules know when you did.

No window titles, no screenshots, no page content, no keystrokes. Nothing is
written to disk except your characters and settings (and, when you ask for it,
the one cfg file in Dota's folder).

Jacqueline makes one network request: once a day it asks GitHub for the
latest release's description (`api.github.com/repos/Shroud-y/Jacqueline/releases/latest`),
to tell you when a newer version is out. It sends nothing about you, and
downloads nothing. **Settings → Look for new versions** turns it off, and then
it makes no requests at all.

One more thing you can switch on: **Dota 2 game events** (off unless you
turn it on). Then Jacqueline opens a port on `127.0.0.1` — this computer only,
never the network — for Dota to post its match state to, and only while a rule
or script waits for a game event. It keeps nothing of what Dota sends beyond
the last kills, deaths and streak of the match being played.

</details>

<details>
<summary>What it costs</summary>

Measured on a desktop, in percent of one CPU core:

| | CPU | Memory |
|---|---|---|
| Nobody on screen | ~0 % | ~80 MB |
| One still character | ~0.2–0.5 % | ~120 MB |
| One video character, playing | ~6 % | ~180 MB |
| One video character, resting or nobody at the computer | ~0.5 % | ~180 MB |

Every character on screen shares one renderer process, so a second one costs
far less than the first. A character that is off screen has no window at all.

</details>

## Download

Grab the latest build from the [Releases page](https://github.com/Shroud-y/Jacqueline/releases),
download the setup `.exe` and run it. It installs, starts with Windows, and
lives in your tray from then on. Closing the editor doesn't quit it —
right-click the tray icon and hit **Quit** if you actually want it gone.

## Build it yourself

You'll need [Node.js](https://nodejs.org) and [pnpm](https://pnpm.io).

```sh
git clone https://github.com/Shroud-y/jacqueline.git
cd jacqueline
pnpm install
pnpm build
```

That spits out an installer under `release/`. To run it without packaging:

```sh
pnpm dev
```

`pnpm test`, `pnpm lint` and `pnpm typecheck` check it.
