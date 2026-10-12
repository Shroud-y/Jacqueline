/**
 * Turns "which window is in front" into "what the user is doing". Pure data
 * and pure functions: no clock, no I/O, and the window title that comes in
 * never goes out — only the activity, a display name and (for a browser) the
 * site are kept.
 *
 * Extending this is editing a table: add a process to `APP_ACTIVITY`, a site
 * to `SITE_PARTS`, or a tool to `TOOLS`.
 */


/** One reading of the foreground window, as the probe reports it. */
export interface ForegroundSample {
  pid: number;
  /** Lower-cased process name, no extension: 'chrome', 'code'. */
  process: string;
  /** The window is not answering messages (`IsHungAppWindow`). */
  hung: boolean;
  windowClass: string;
  title: string;
  /** The executable's own file description, e.g. 'Google Chrome'. Often empty. */
  description: string;
}

export type Activity =
  | 'coding'
  | 'terminal'
  | 'research'
  | 'ai'
  | 'video'
  | 'social'
  | 'chat'
  | 'music'
  | 'creative'
  | 'writing'
  | 'office'
  | 'mail'
  | 'shopping'
  | 'browsing'
  | 'game'
  | 'files'
  | 'other';

/** Windows that are opened briefly and deserve a remark the moment they appear. */
export type Tool = 'taskmgr' | 'regedit' | 'calculator' | 'settings' | 'installer' | 'screenshot' | 'self';

/** Which way an activity leans, for noticing a slide from one to the other. */
export type ActivityKind = 'work' | 'leisure' | 'neutral';

export interface Classified {
  activity: Activity;
  /** Display name of the application: 'Visual Studio Code', 'Chrome'. */
  app: string;
  /** Set for a recognised site in a browser: 'YouTube', 'GitHub'. */
  site?: string;
  tool?: Tool;
  /**
   * Identity of what is in front, for telling "still the same thing" from
   * "something else". Two tabs of one site are the same thing; two sites in
   * one browser are not.
   */
  key: string;
}

const KIND: Record<Activity, ActivityKind> = {
  coding: 'work',
  terminal: 'work',
  research: 'work',
  writing: 'work',
  office: 'work',
  creative: 'work',
  mail: 'work',
  video: 'leisure',
  social: 'leisure',
  shopping: 'leisure',
  game: 'leisure',
  ai: 'neutral',
  chat: 'neutral',
  music: 'neutral',
  browsing: 'neutral',
  files: 'neutral',
  other: 'neutral'
};

export function kindOf(activity: Activity): ActivityKind {
  return KIND[activity];
}

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */

/** Process stem → [activity, display name]. Stems are lower-case, no `.exe`. */
const APP_ACTIVITY: Record<string, [Activity, string]> = {
  code: ['coding', 'Visual Studio Code'],
  'code - insiders': ['coding', 'Visual Studio Code'],
  cursor: ['coding', 'Cursor'],
  windsurf: ['coding', 'Windsurf'],
  zed: ['coding', 'Zed'],
  devenv: ['coding', 'Visual Studio'],
  idea64: ['coding', 'IntelliJ IDEA'],
  pycharm64: ['coding', 'PyCharm'],
  webstorm64: ['coding', 'WebStorm'],
  rider64: ['coding', 'Rider'],
  clion64: ['coding', 'CLion'],
  goland64: ['coding', 'GoLand'],
  phpstorm64: ['coding', 'PhpStorm'],
  rustrover64: ['coding', 'RustRover'],
  datagrip64: ['coding', 'DataGrip'],
  studio64: ['coding', 'Android Studio'],
  sublime_text: ['coding', 'Sublime Text'],
  'notepad++': ['coding', 'Notepad++'],
  unity: ['coding', 'Unity'],
  godot: ['coding', 'Godot'],

  windowsterminal: ['terminal', 'the terminal'],
  powershell: ['terminal', 'PowerShell'],
  pwsh: ['terminal', 'PowerShell'],
  cmd: ['terminal', 'the command prompt'],
  conhost: ['terminal', 'the console'],
  openconsole: ['terminal', 'the console'],
  'wezterm-gui': ['terminal', 'WezTerm'],
  alacritty: ['terminal', 'Alacritty'],

  discord: ['chat', 'Discord'],
  telegram: ['chat', 'Telegram'],
  slack: ['chat', 'Slack'],
  'ms-teams': ['chat', 'Teams'],
  teams: ['chat', 'Teams'],
  zoom: ['chat', 'Zoom'],
  whatsapp: ['chat', 'WhatsApp'],
  signal: ['chat', 'Signal'],
  viber: ['chat', 'Viber'],
  skype: ['chat', 'Skype'],
  element: ['chat', 'Element'],

  spotify: ['music', 'Spotify'],
  foobar2000: ['music', 'foobar2000'],
  aimp: ['music', 'AIMP'],
  musicbee: ['music', 'MusicBee'],
  itunes: ['music', 'iTunes'],

  vlc: ['video', 'VLC'],
  mpv: ['video', 'mpv'],
  'mpc-hc64': ['video', 'Media Player Classic'],
  'mpc-be64': ['video', 'Media Player Classic'],
  potplayermini64: ['video', 'PotPlayer'],

  blender: ['creative', 'Blender'],
  photoshop: ['creative', 'Photoshop'],
  illustrator: ['creative', 'Illustrator'],
  afterfx: ['creative', 'After Effects'],
  'adobe premiere pro': ['creative', 'Premiere Pro'],
  resolve: ['creative', 'DaVinci Resolve'],
  figma: ['creative', 'Figma'],
  krita: ['creative', 'Krita'],
  inkscape: ['creative', 'Inkscape'],
  aseprite: ['creative', 'Aseprite'],
  paintdotnet: ['creative', 'Paint.NET'],
  mspaint: ['creative', 'Paint'],
  audacity: ['creative', 'Audacity'],
  fl64: ['creative', 'FL Studio'],
  obs64: ['creative', 'OBS'],

  winword: ['writing', 'Word'],
  obsidian: ['writing', 'Obsidian'],
  notion: ['writing', 'Notion'],
  onenote: ['writing', 'OneNote'],
  notepad: ['writing', 'Notepad'],

  excel: ['office', 'Excel'],
  powerpnt: ['office', 'PowerPoint'],

  outlook: ['mail', 'Outlook'],
  olk: ['mail', 'Outlook'],
  thunderbird: ['mail', 'Thunderbird'],

  explorer: ['files', 'File Explorer'],
  totalcmd64: ['files', 'Total Commander'],
  doublecmd: ['files', 'Double Commander'],

  steam: ['game', 'Steam'],
  steamwebhelper: ['game', 'Steam'],
  epicgameslauncher: ['game', 'the Epic launcher'],
  'battle.net': ['game', 'Battle.net'],
  riotclientservices: ['game', 'the Riot client'],
  riotclientux: ['game', 'the Riot client'],
  galaxyclient: ['game', 'GOG Galaxy'],
  eadesktop: ['game', 'the EA app'],
  dota2: ['game', 'Dota 2'],
  cs2: ['game', 'Counter-Strike 2'],
  'valorant-win64-shipping': ['game', 'Valorant'],
  leagueclientux: ['game', 'League of Legends'],
  'league of legends': ['game', 'League of Legends'],
  gta5: ['game', 'GTA V'],
  mindustry: ['game', 'Mindustry'],
  factorygamesteam: ['game', 'Satisfactory'],
  civilizationvi: ['game', 'Civilization VI'],
  'risk of rain 2': ['game', 'Risk of Rain 2'],
  terraria: ['game', 'Terraria'],
  'warframe.x64': ['game', 'Warframe'],
  'minecraft.windows': ['game', 'Minecraft'],
  javaw: ['game', 'Minecraft'],
  robloxplayerbeta: ['game', 'Roblox']
};

const BROWSERS: Record<string, string> = {
  chrome: 'Chrome',
  msedge: 'Edge',
  firefox: 'Firefox',
  opera: 'Opera',
  brave: 'Brave',
  vivaldi: 'Vivaldi',
  zen: 'Zen',
  arc: 'Arc',
  browser: 'Yandex Browser'
};

/**
 * Sites that name themselves as one whole part of the page title — which is
 * most of them: 'Some video - YouTube - Google Chrome'. Matching a whole part
 * rather than a substring is what keeps a video *about* Reddit on YouTube.
 */
const SITE_PARTS: [RegExp, Activity, string][] = [
  [/^YouTube$/i, 'video', 'YouTube'],
  [/^Twitch$/i, 'video', 'Twitch'],
  [/^Netflix$/i, 'video', 'Netflix'],
  [/^Kick$/i, 'video', 'Kick'],

  [/^Stack Overflow$/i, 'research', 'Stack Overflow'],
  [/^GitHub$/i, 'research', 'GitHub'],
  [/^GitLab$/i, 'research', 'GitLab'],
  [/^MDN(?: Web Docs)?$/i, 'research', 'MDN'],
  [/^Wikipedia$/i, 'research', 'Wikipedia'],

  [/^ChatGPT$/i, 'ai', 'ChatGPT'],
  [/^Claude$/i, 'ai', 'Claude'],
  [/^(?:Google )?Gemini$/i, 'ai', 'Gemini'],
  [/^Perplexity$/i, 'ai', 'Perplexity'],
  [/^(?:Microsoft )?Copilot$/i, 'ai', 'Copilot'],
  [/^DeepSeek$/i, 'ai', 'DeepSeek'],
  [/^Grok$/i, 'ai', 'Grok'],

  [/^Reddit$/i, 'social', 'Reddit'],
  [/^(?:Twitter|X)$/, 'social', 'X'],
  [/^Facebook$/i, 'social', 'Facebook'],
  [/^Instagram$/i, 'social', 'Instagram'],
  [/^TikTok$/i, 'social', 'TikTok'],
  [/^Threads$/i, 'social', 'Threads'],
  [/^Bluesky$/i, 'social', 'Bluesky'],

  [/^Gmail$/i, 'mail', 'Gmail'],
  [/^Outlook$/i, 'mail', 'Outlook'],
  [/^Proton Mail$/i, 'mail', 'Proton Mail'],

  [/^Google Docs$/i, 'writing', 'Google Docs'],
  [/^Notion$/i, 'writing', 'Notion'],
  [/^Google Sheets$/i, 'office', 'Google Sheets'],
  [/^Google Slides$/i, 'office', 'Google Slides'],
  [/^Figma$/i, 'creative', 'Figma'],

  [/^AliExpress$/i, 'shopping', 'AliExpress'],
  [/^eBay$/i, 'shopping', 'eBay'],
  [/^OLX(?:\.\w+)?$/i, 'shopping', 'OLX'],

  [/^Telegram(?: Web)?$/i, 'chat', 'Telegram'],
  [/^WhatsApp(?: Web)?$/i, 'chat', 'WhatsApp'],
  [/^Discord$/i, 'chat', 'Discord'],
  [/^Spotify(?: . Web Player)?$/i, 'music', 'Spotify']
];

/** Sites that only show up as a pattern inside a part of the title, not as a whole part. */
const SITE_PATTERNS: [RegExp, Activity, string][] = [
  [/(?:^|\s)r\/\w+/, 'social', 'Reddit'],
  [/\/ X$/, 'social', 'X'],
  [/^Amazon\.\w+/i, 'shopping', 'Amazon'],
  [/rozetka/i, 'shopping', 'Rozetka']
];

/** How far from the end of the title a site's own name is looked for. */
const SITE_PART_DEPTH = 3;

function findSite(title: string): { activity: Activity; site: string } | null {
  const parts = title
    .split(/\s+[-–—|·]\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  // From the end: the browser's own name is last, the site's just before it.
  for (let i = parts.length - 1; i >= Math.max(0, parts.length - SITE_PART_DEPTH); i -= 1) {
    const part = parts[i] ?? '';
    for (const [test, activity, site] of SITE_PARTS) {
      if (test.test(part)) return { activity, site };
    }
    // Per part as well as over the whole title: the browser's own name comes
    // last, so a pattern anchored to the end of the page title has to be
    // tried against the page's part, not the window's.
    for (const [test, activity, site] of SITE_PATTERNS) {
      if (test.test(part)) return { activity, site };
    }
  }
  return null;
}

/** Process stem → tool. */
const TOOLS: Record<string, [Tool, string]> = {
  taskmgr: ['taskmgr', 'Task Manager'],
  procexp64: ['taskmgr', 'Process Explorer'],
  procexp: ['taskmgr', 'Process Explorer'],
  systeminformer: ['taskmgr', 'System Informer'],
  processhacker: ['taskmgr', 'Process Hacker'],
  regedit: ['regedit', 'the Registry Editor'],
  calc: ['calculator', 'Calculator'],
  calculatorapp: ['calculator', 'Calculator'],
  systemsettings: ['settings', 'Settings'],
  control: ['settings', 'Control Panel'],
  msiexec: ['installer', 'an installer'],
  snippingtool: ['screenshot', 'the Snipping Tool'],
  screenclippinghost: ['screenshot', 'the Snipping Tool'],
  sharex: ['screenshot', 'ShareX']
};

/**
 * Store apps all present as one host process; the window title is the only
 * thing that says which app it is, and it is localised.
 */
const HOSTED_TOOLS: { test: RegExp; tool: Tool; app: string }[] = [
  { test: /^(?:Calculator|Калькулятор)$/i, tool: 'calculator', app: 'Calculator' },
  { test: /^(?:Settings|Параметри|Настройки)$/i, tool: 'settings', app: 'Settings' },
  { test: /^(?:Snipping Tool|Ножиці|Ножницы)$/i, tool: 'screenshot', app: 'the Snipping Tool' }
];

/** Shell surfaces: in front all the time, and never something the user is "doing". */
const IGNORED_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd']);
const IGNORED_PROCESSES = new Set([
  'lockapp',
  'logonui',
  'searchhost',
  'searchapp',
  'startmenuexperiencehost',
  'shellexperiencehost',
  'textinputhost',
  'dwm',
  'idle'
]);

const INSTALLER_NAME = /(?:^|[\s_.-])(?:setup|install(?:er)?|unins\d*)(?:$|[\s_.-])/i;

/* ------------------------------------------------------------------ */
/* Classification                                                      */
/* ------------------------------------------------------------------ */

/** 'Chrome.exe' and 'chrome' are the same process. */
function processStem(name: string): string {
  const lower = name.trim().toLowerCase();
  return lower.endsWith('.exe') ? lower.slice(0, -'.exe'.length) : lower;
}

/** A readable name for a process nothing in the tables knows about. */
function displayName(sample: ForegroundSample): string {
  const description = sample.description.trim();
  // File descriptions are mostly the product name, but some are a sentence or
  // a bare file name; those read worse than the process name does.
  if (description.length > 1 && description.length <= 32 && !/\.exe$/i.test(description)) {
    return description;
  }
  const stem = sample.process;
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

/**
 * `selfPid` is this app's own main process: its settings window is a tool
 * like any other, and the one the character has the most to say about.
 *
 * Returns null for the desktop, the lock screen and other shell surfaces —
 * "nothing in particular", which the tracker treats as a gap, not an activity.
 */
export function classify(sample: ForegroundSample, selfPid?: number): Classified | null {
  const stem = processStem(sample.process);
  if (stem.length === 0) return null;
  if (IGNORED_CLASSES.has(sample.windowClass) || IGNORED_PROCESSES.has(stem)) return null;

  if (selfPid !== undefined && sample.pid === selfPid) {
    return { activity: 'other', app: 'my settings', tool: 'self', key: 'tool:self' };
  }

  const tool = TOOLS[stem];
  if (tool) return { activity: 'other', app: tool[1], tool: tool[0], key: `tool:${tool[0]}` };

  if (stem === 'applicationframehost') {
    const hosted = HOSTED_TOOLS.find((entry) => entry.test.test(sample.title.trim()));
    if (hosted) return { activity: 'other', app: hosted.app, tool: hosted.tool, key: `tool:${hosted.tool}` };
    // Some other Store app. The host's own name says nothing; the title is
    // the app's name often enough to be worth showing, but it is still a
    // window title, so it is not used.
    return null;
  }

  const browser = BROWSERS[stem];
  if (browser) {
    const match = findSite(sample.title);
    if (match) {
      return { activity: match.activity, app: browser, site: match.site, key: `site:${match.site}` };
    }
    return { activity: 'browsing', app: browser, key: `app:${stem}` };
  }

  const known = APP_ACTIVITY[stem];
  if (known) return { activity: known[0], app: known[1], key: `app:${stem}` };

  if (INSTALLER_NAME.test(stem)) {
    return { activity: 'other', app: 'an installer', tool: 'installer', key: 'tool:installer' };
  }

  return { activity: 'other', app: displayName(sample), key: `app:${stem}` };
}

/* ------------------------------------------------------------------ */
/* Probe reply                                                         */
/* ------------------------------------------------------------------ */

function decode(value: string | undefined): string {
  if (!value) return '';
  try {
    return Buffer.from(value, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

/**
 * `pid|process|hung|class|title|description` — see `ForegroundInfo` in
 * `resources/probe/CodexProbe.cs`. `'none'` is the probe answering that no
 * window is in front; null is no usable answer at all.
 */
export function parseForeground(reply: string | null): ForegroundSample | 'none' | null {
  if (reply === null) return null;
  if (reply.trim().length === 0) return 'none';
  const parts = reply.trim().split('|');
  if (parts.length < 6) return null;
  const pid = Number(parts[0]);
  const process = (parts[1] ?? '').trim();
  if (!Number.isInteger(pid) || pid <= 0 || process.length === 0) return null;
  return {
    pid,
    process,
    hung: parts[2] === '1',
    windowClass: parts[3] ?? '',
    title: decode(parts[4]),
    description: decode(parts[5])
  };
}
