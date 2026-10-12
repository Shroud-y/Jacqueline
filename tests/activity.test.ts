import { describe, expect, it } from 'vitest';
import { classify, kindOf, parseForeground, type ForegroundSample } from '@main/core/activity';

function sample(overrides: Partial<ForegroundSample>): ForegroundSample {
  return { pid: 100, process: 'chrome', hung: false, windowClass: 'Chrome_WidgetWin_1', title: '', description: '', ...overrides };
}

const b64 = (text: string): string => Buffer.from(text, 'utf8').toString('base64');

describe('classify', () => {
  it('knows applications by process, with or without the extension', () => {
    expect(classify(sample({ process: 'code' }))).toMatchObject({ activity: 'coding', app: 'Visual Studio Code', key: 'app:code' });
    expect(classify(sample({ process: 'Code.exe' }))).toMatchObject({ activity: 'coding', key: 'app:code' });
    expect(classify(sample({ process: 'discord' }))).toMatchObject({ activity: 'chat', app: 'Discord' });
  });

  it('reads the site out of a browser title', () => {
    expect(classify(sample({ title: 'Lo-fi beats to compile to - YouTube - Google Chrome' }))).toMatchObject({
      activity: 'video',
      app: 'Chrome',
      site: 'YouTube',
      key: 'site:YouTube'
    });
    expect(classify(sample({ process: 'firefox', title: 'javascript - Why is my regex slow? - Stack Overflow — Mozilla Firefox' }))).toMatchObject({
      activity: 'research',
      site: 'Stack Overflow'
    });
    expect(classify(sample({ process: 'msedge', title: 'Inbox (3) - someone@example.com - Gmail - Personal - Microsoft​ Edge' }))).toMatchObject({
      activity: 'mail',
      site: 'Gmail'
    });
    expect(classify(sample({ title: '(2) Home / X - Google Chrome' }))).toMatchObject({ activity: 'social', site: 'X' });
    expect(classify(sample({ title: 'Why does this work? : r/programming - Google Chrome' }))).toMatchObject({ site: 'Reddit' });
    expect(classify(sample({ title: 'Refactoring help - Claude - Google Chrome' }))).toMatchObject({ activity: 'ai', site: 'Claude' });
  });

  it('goes by where the site names itself, not by words in the page title', () => {
    // A video about Reddit is still YouTube.
    expect(classify(sample({ title: 'The best of Reddit this week - YouTube - Google Chrome' }))).toMatchObject({ site: 'YouTube' });
    // A page that merely mentions a site is just the browser.
    expect(classify(sample({ title: 'How YouTube changed everything, a long read - Some Blog - Google Chrome' }))).toMatchObject({
      activity: 'browsing',
      app: 'Chrome',
      key: 'app:chrome'
    });
    expect(classify(sample({ title: 'New Tab - Google Chrome' }))?.site).toBeUndefined();
  });

  it('gives two tabs of one site the same key and two sites different ones', () => {
    const a = classify(sample({ title: 'First - YouTube - Google Chrome' }));
    const b = classify(sample({ title: 'Second - YouTube - Google Chrome' }));
    const c = classify(sample({ title: 'Third - Twitch - Google Chrome' }));
    expect(a?.key).toBe(b?.key);
    expect(a?.key).not.toBe(c?.key);
  });

  it('recognises short-lived tools, including Store apps behind the shared host', () => {
    expect(classify(sample({ process: 'taskmgr', title: 'Task Manager' }))).toMatchObject({ tool: 'taskmgr', app: 'Task Manager' });
    expect(classify(sample({ process: 'applicationframehost', title: 'Calculator' }))).toMatchObject({ tool: 'calculator' });
    expect(classify(sample({ process: 'applicationframehost', title: 'Параметри' }))).toMatchObject({ tool: 'settings' });
    expect(classify(sample({ process: 'vs_setup_bootstrapper', title: 'Visual Studio Installer' }))).toMatchObject({ tool: 'installer' });
    // "setup" has to be a word of its own in the process name.
    expect(classify(sample({ process: 'setupdiagnostics' }))?.tool).toBeUndefined();
  });

  it('recognises its own settings window by pid', () => {
    expect(classify(sample({ pid: 4242, process: 'electron', title: 'SHARD — Settings' }), 4242)).toMatchObject({ tool: 'self' });
    expect(classify(sample({ pid: 4243, process: 'electron' }), 4242)?.tool).toBeUndefined();
  });

  it('is nothing at all for the desktop, the lock screen and the shell', () => {
    expect(classify(sample({ process: 'explorer', windowClass: 'Progman' }))).toBeNull();
    expect(classify(sample({ process: 'explorer', windowClass: 'Shell_TrayWnd' }))).toBeNull();
    expect(classify(sample({ process: 'lockapp' }))).toBeNull();
    expect(classify(sample({ process: 'applicationframehost', title: 'Some Store App' }))).toBeNull();
    expect(classify(sample({ process: '' }))).toBeNull();
    // Explorer with a real folder window is the file manager.
    expect(classify(sample({ process: 'explorer', windowClass: 'CabinetWClass' }))).toMatchObject({ activity: 'files' });
  });

  it('names an unknown application from its file description, or failing that its process', () => {
    expect(classify(sample({ process: 'aseprite2', description: 'Aseprite Pixel Editor' }))).toMatchObject({
      activity: 'other',
      app: 'Aseprite Pixel Editor'
    });
    expect(classify(sample({ process: 'weirdtool', description: '' }))).toMatchObject({ app: 'Weirdtool' });
    // A description that is a sentence, or just the file name, reads worse than the process name.
    expect(classify(sample({ process: 'weirdtool', description: 'weirdtool.exe' }))?.app).toBe('Weirdtool');
    expect(classify(sample({ process: 'weirdtool', description: 'A helper process for the thing that does the other thing' }))?.app).toBe('Weirdtool');
  });

  it('never carries the window title out', () => {
    const title = 'my-secret-project — passwords.txt - Visual Studio Code';
    const result = classify(sample({ process: 'code', title }));
    expect(JSON.stringify(result)).not.toContain('secret');
  });
});

describe('kindOf', () => {
  it('sorts activities into work, leisure and neither', () => {
    expect(kindOf('coding')).toBe('work');
    expect(kindOf('video')).toBe('leisure');
    expect(kindOf('chat')).toBe('neutral');
  });
});

describe('parseForeground', () => {
  it('decodes a probe reply, including non-ASCII titles', () => {
    const reply = `5028|chrome|0|Chrome_WidgetWin_1|${b64('Привіт — YouTube')}|${b64('Google Chrome')}`;
    expect(parseForeground(reply)).toEqual({
      pid: 5028,
      process: 'chrome',
      hung: false,
      windowClass: 'Chrome_WidgetWin_1',
      title: 'Привіт — YouTube',
      description: 'Google Chrome'
    });
  });

  it('reads the hung flag', () => {
    expect(parseForeground(`7|app|1|Cls|${b64('x')}|`)).toMatchObject({ hung: true, description: '' });
  });

  it('tells "no window in front" from "no reading"', () => {
    expect(parseForeground('')).toBe('none');
    expect(parseForeground(null)).toBeNull();
    expect(parseForeground('garbage')).toBeNull();
    expect(parseForeground('0||0|||')).toBeNull();
  });
});
