<img src="resources/icons/app.png" width="96" height="96" alt="SHARD app icon">

# SHARD

This is my hobby project. I got inspired by Ordis from Warframe and wanted
something like him living on my own PC, a little companion that sits in the
tray, notices what's going on with your machine, and pops up now and then to
say something about it. Nothing serious.

![Speaking over the desktop](resources/screenshots/overlay.gif)

It reacts to stuff like games/apps opening and closing, your PC running hot or
low on space, locking/unlocking, waking up from sleep, the time of day, a
download finishing, etc. It also knows when to shut up: quiet
hours, fullscreen games, and while you're on a call, it won't interrupt.

It also notices what you're actually doing, not just what's running: which app
or site is in front, how long you've been at it, when you slide from work into
YouTube (and when you come back), when you can't settle on a window, when
something freezes, and when you open Task Manager to check on it.

By default it shows up to say something and leaves again. If you'd rather it
lived on your screen, tick **Keep on screen** in the tray menu:

- it stays where you put it and **rests** between lines — half-lidded, dimmer,
  blinking now and then — and wakes up to speak;
- **drag** it anywhere; the text finds the side with room, so the bottom-right
  corner works as well as the middle of the screen;
- **click** it and it answers; click while it's talking to dismiss the line;
- **right-click** it for the same menu the tray has;
- when it's muted, snoozed or in quiet hours it **closes its eye** instead of
  vanishing, so you can see at a glance why it's quiet;
- it steps aside for fullscreen apps, and it never takes focus or blocks
  clicks anywhere but on the eye itself.

Resting costs about half a percent of one CPU core; asleep, about a third of
one.

<details>
<summary>What it reads to do that, and what it doesn't keep</summary>

Every few seconds SHARD asks Windows which window is in front: the program it
belongs to and its title. A browser's title is how it tells YouTube from
GitHub. That is all it reads — no screenshots, no page content, no keystrokes.

The title is used on the spot to work out the activity (`coding`, `video`,
`social`…) and, for a browser, the site, and is then dropped. It is never
written to disk, never logged and never leaves your machine; SHARD makes no
network requests at all. What a line can mention is the app's name, the site's
name and a number of minutes.

Turn it off under **Settings… - Monitors - Active window**.

</details>

<details>
<summary>Watched programs by default</summary>

SHARD only reacts to processes on this list (add or remove your own anytime
from **Settings… - Watched processes**):

```
Code.exe
devenv.exe
idea64.exe
pycharm64.exe
WebStorm64.exe
rider64.exe
chrome.exe
firefox.exe
msedge.exe
Discord.exe
Steam.exe
EpicGamesLauncher.exe
Battle.net.exe
obs64.exe
blender.exe
photoshop.exe
RiotClientServices.exe
GalaxyClient.exe
EADesktop.exe
Spotify.exe
Docker Desktop.exe
ms-teams.exe
Zoom.exe
dota2.exe
cs2.exe
VALORANT-Win64-Shipping.exe
LeagueClientUx.exe
GTA5.exe
Mindustry.exe
FactoryGameSteam.exe
CivilizationVI.exe
Risk of Rain 2.exe
Terraria.exe
```

Game launchers, well-known apps and specific games each get their own flavor
of reaction — everything else on the list just gets a generic one.

</details>

## Download

Grab the latest build from the [Releases page](https://github.com/Shroud-y/codex/releases), 
download the setup `.exe` and run it. It installs, starts with Windows, and
lives in your tray from then on. Closing its windows doesn't quit it,  right-click
the tray icon and hit **Quit** if you actually want it gone.

## Build it yourself

Want to build it from source instead? You'll need [Node.js](https://nodejs.org)
and [pnpm](https://pnpm.io).

```sh
git clone https://github.com/Shroud-y/codex.git
cd codex
pnpm install
pnpm build
```

That spits out an installer under `release/`. If you just want to run it
without packaging anything:

```sh
pnpm dev
```

## Customizing the character

You're not stuck with just standart presets. Open the tray icon **Settings…** - **Presets**.

- **Add a new preset** with the button at the bottom - gives you a fresh
  character you can rename and switch to anytime (the radio button next to it
  picks which one is currently active).
- Each preset lets you drop in your own files, no code or restart needed:
  - **Phrase bank (.json)** - your own lines. Easiest way to start is copying
    [`resources/phrases/bank.json`](resources/phrases/bank.json) and editing
    the text, you only need to include the groups you actually want to
    change. A line can name what triggered it with a placeholder: `{app}`,
    `{subject}` (the site if there is one, otherwise the app), `{minutes}`
    and `{count}` — see the `focus.*` groups for which ones each group gets.
    A line whose placeholder can't be filled is skipped, never shown with a
    hole in it.
  - **Appear / disappear sound** - swap the little cue sounds it makes when it
    shows up or leaves.
  - **Appearance video (.webm/.mp4)** - replace how it looks. Use a video, not
    a GIF - GIFs actually stutter here since the browser engine has to decode
    them frame by frame instead of just playing them.
- Hit **Reset to default** on any of those to go back to stock.

Presets you build live under `%APPDATA%\codex\presets\<presetId>\`, so they
survive updates and reinstalls.
