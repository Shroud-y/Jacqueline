<img src="resources/icons/app.png" width="96" height="96" alt="SHARD app icon">

# SHARD

This is my hobby project. It started as Ordis from Warframe living on my PC —
a little companion in the tray that noticed what I was doing and said
something about it. Now it is the thing underneath him: a way to build your
own characters for your desktop.

A character is a picture or a video that sits on your screen, says lines now
and then, and comes and goes when you tell it to. An anime clip in the corner
that is there only while Dota 2 is running. A mascot that greets you in the
morning and tells you to go to bed at midnight. Ordis again, if you write his
lines. SHARD ships no characters of its own — you make them.

It is built to be cheap to keep running: a still character costs about half a
percent of one CPU core, and nothing at all while it is off screen.

## Making a character

Right-click the tray icon → **Characters…** opens the editor. Every change is
saved as you make it and shows on the character on your desktop straight
away; there is no Save button.

- **General** — when it is on screen: always, while a program is running,
  while a program is the window you are working in, or only when it has
  something to say. It can step aside for fullscreen games. At the bottom,
  **What it costs** says what keeping it around takes.
- **Appearance** — a picture or a video for when it is idle, and optionally
  another while it is speaking. Size, opacity, mirroring. A video can **rest**
  between plays, which is the cheapest way to have a character that moves.
- **Layout** — a canvas with the character and its text on it: where the text
  sits, how big, in what font (yours too: drop in a `.ttf`), colour, outline,
  shadow, background, and how it appears (typed out, faded in, or at once).
  While this tab is open the character shows sample text on your desktop, so
  you can see it where it will be.
- **Behaviour** — rules. Each one reads as a sentence: *When **dota2.exe**
  starts → say a line from **greet***. Open one to change it:
  - **When**: a program starts, closes or comes to the front; every day at a
    time; every so often (somewhere between N and M minutes); you come back
    after being away; SHARD starts; the character is clicked.
  - **Only if**: by chance (a percentage), between two times of day, a
    program is or is not running.
  - **Then**: say a line from a group, play a sound, come out for a while
    (even if it would not be on screen otherwise), hide for a while.
  - **Wait at least** … before it can happen again.
  - **Test now** does what the rule does, right away.
- **Lines** — groups of lines a rule can pick from. Each line can have a
  weight (how often it comes up) and a sound. The same line is never said
  twice in a row. A line can mention what happened with a slot: `{name}`
  (the character's), `{time}`, `{program}` (for rules about a program) and
  `{minutes}` (how long you were away). A line whose slot cannot be filled
  is skipped, never shown with a hole in it. **Test** says it on your desktop.
- **Audio** — volume, and sounds for coming on screen and leaving.

On the desktop: **drag** a character anywhere (other monitors too), **click**
it to set off its "clicked" rules, click while it is talking to dismiss the
line, **right-click** to hide it for a while or turn it off.

**Settings** at the bottom of the editor's list: start with Windows, mute
everyone, quiet hours (nobody says anything between two times; characters stay
where they are).

## Sharing a character

**···** → **Export…** saves a character as one `.zip` with every file it uses.
**Import…** under the list (or dropping a `.zip` on it) makes a new character
from one. Importing never overwrites anything; the same zip twice gives two
characters.

<details>
<summary>What is in a character</summary>

A character is a folder under `%APPDATA%\shard\characters\` (tray →
**Open characters folder** takes you there):

```
<id>/
  character.json   everything about it
  assets/          its pictures, videos, sounds and fonts, by plain file name
```

You can copy a folder there by hand — its name has to be lowercase letters,
digits and dashes — and SHARD picks it up the next time it starts. A `character.json` that cannot be read shows in the editor with the
reason, and its files are left alone.

Files it takes: pictures `.png .webp .jpg`, video `.webm .mp4`, sound
`.ogg .wav .mp3`, fonts `.ttf .otf .woff .woff2`. For a moving character use a
video, not a GIF — a video is decoded by the graphics card, a GIF frame by
frame.

</details>

<details>
<summary>What it reads, and what it doesn't</summary>

Only what the characters you have made actually need, and only while they
need it:

- the **file names of running programs** (every 5 seconds), for characters and
  rules tied to a program;
- **which program is in front** — told by Windows when it changes, not polled;
- whether that window **covers the whole screen**, for "step aside";
- how long since you last **touched the mouse or keyboard**, so a video stops
  moving while nobody is watching and "you come back" rules know when you did.

No window titles, no screenshots, no page content, no keystrokes. Nothing is
written to disk except your characters and settings, and SHARD makes no
network requests at all.

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

Grab the latest build from the [Releases page](https://github.com/Shroud-y/codex/releases),
download the setup `.exe` and run it. It installs, starts with Windows, and
lives in your tray from then on. Closing the editor doesn't quit it —
right-click the tray icon and hit **Quit** if you actually want it gone.

## Build it yourself

You'll need [Node.js](https://nodejs.org) and [pnpm](https://pnpm.io).

```sh
git clone https://github.com/Shroud-y/codex.git
cd codex
pnpm install
pnpm build
```

That spits out an installer under `release/`. To run it without packaging:

```sh
pnpm dev
```

`pnpm test`, `pnpm lint` and `pnpm typecheck` check it.
