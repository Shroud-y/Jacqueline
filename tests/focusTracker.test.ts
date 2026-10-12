import { beforeEach, describe, expect, it } from 'vitest';
import type { Classified } from '@main/core/activity';
import {
  BREAK_MS,
  DRIFT_MIN_WORK_MS,
  FocusTracker,
  GAP_MS,
  HUNG_CONFIRM_MS,
  RESTLESS_SWITCHES,
  RETURN_MIN_LEISURE_MS,
  SETTLE_MS,
  type FocusEvent
} from '@main/core/focusTracker';

const TICK = 5_000;
const MINUTE = 60_000;

const code: Classified = { activity: 'coding', app: 'Visual Studio Code', key: 'app:code' };
const youtube: Classified = { activity: 'video', app: 'Chrome', site: 'YouTube', key: 'site:YouTube' };
const docs: Classified = { activity: 'research', app: 'Chrome', site: 'MDN', key: 'site:MDN' };
const discord: Classified = { activity: 'chat', app: 'Discord', key: 'app:discord' };
const taskmgr: Classified = { activity: 'other', app: 'Task Manager', tool: 'taskmgr', key: 'tool:taskmgr' };

/** Drives a tracker on a fake clock, one probe tick at a time. */
class Session {
  readonly tracker = new FocusTracker();
  now = 1_000_000;

  /** Holds `sample` in front for `durationMs`, returning everything it caused. */
  hold(sample: Classified | null, durationMs: number, options: { hung?: boolean; idle?: boolean } = {}): FocusEvent[] {
    const events: FocusEvent[] = [];
    for (let elapsed = 0; elapsed <= durationMs; elapsed += TICK) {
      events.push(
        ...this.tracker.update({ now: this.now, sample, hung: options.hung ?? false, idle: options.idle ?? false })
      );
      this.now += TICK;
    }
    return events;
  }
}

const types = (events: FocusEvent[]): string[] => events.map((event) => event.type);

describe('FocusTracker', () => {
  let s: Session;

  beforeEach(() => {
    s = new Session();
  });

  describe('settling', () => {
    it('says nothing about a window that was only passed through', () => {
      expect(s.hold(code, SETTLE_MS - TICK)).toEqual([]);
    });

    it('announces a window once it has been in front long enough', () => {
      const events = s.hold(code, SETTLE_MS);
      expect(events).toEqual([
        { type: 'focus.enter', payload: { activity: 'coding', app: 'Visual Studio Code', subject: 'Visual Studio Code' } }
      ]);
    });

    it('names the site, not the browser, as the subject', () => {
      const [event] = s.hold(youtube, SETTLE_MS);
      expect(event?.payload).toMatchObject({ app: 'Chrome', site: 'YouTube', subject: 'YouTube' });
    });

    it('announces it once, however long it stays', () => {
      s.hold(code, SETTLE_MS);
      expect(types(s.hold(code, 10 * MINUTE))).toEqual([]);
    });

    it('does not re-announce after a glance elsewhere', () => {
      s.hold(code, SETTLE_MS);
      s.hold(discord, TICK);
      expect(types(s.hold(code, SETTLE_MS))).toEqual([]);
    });

    it('reports where the user came from', () => {
      s.hold(code, SETTLE_MS);
      const events = s.hold(discord, SETTLE_MS);
      expect(events[0]).toMatchObject({ type: 'focus.enter', payload: { activity: 'chat', from: 'coding' } });
    });

    it('treats the desktop as a gap, not as somewhere to settle', () => {
      s.hold(code, SETTLE_MS);
      expect(s.hold(null, MINUTE)).toEqual([]);
      // Back to the same place: nothing new to say.
      expect(types(s.hold(code, SETTLE_MS))).toEqual([]);
    });
  });

  describe('drift and return', () => {
    it('calls leaving a long stretch of work a drift, with the minutes worked', () => {
      s.hold(code, DRIFT_MIN_WORK_MS + 5 * MINUTE);
      const events = s.hold(youtube, SETTLE_MS).filter((event) => event.type !== 'focus.long');
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe('focus.drift');
      expect(events[0]?.payload).toMatchObject({ subject: 'YouTube', from: 'coding' });
      expect(events[0]?.payload.minutes).toBeGreaterThanOrEqual(30);
    });

    it('calls it a plain enter when the work was short', () => {
      s.hold(code, 5 * MINUTE);
      expect(types(s.hold(youtube, SETTLE_MS))).toEqual(['focus.enter']);
    });

    it('does not let a neutral activity in between break the stretch of work', () => {
      s.hold(code, DRIFT_MIN_WORK_MS);
      s.hold(discord, 2 * MINUTE);
      expect(types(s.hold(youtube, SETTLE_MS))).toContain('focus.drift');
    });

    it('notices coming back to work after a long break', () => {
      s.hold(code, 5 * MINUTE);
      s.hold(youtube, RETURN_MIN_LEISURE_MS + 2 * MINUTE);
      const events = s.hold(code, SETTLE_MS);
      expect(events[0]).toMatchObject({ type: 'focus.return', payload: { activity: 'coding', from: 'video' } });
      expect(events[0]?.payload.minutes).toBeGreaterThanOrEqual(10);
    });
  });

  describe('long focus', () => {
    it('marks 45 and 90 minutes in one activity, once each', () => {
      const events = s.hold(code, 100 * MINUTE).filter((event) => event.type === 'focus.long');
      expect(events.map((event) => event.payload.minutes)).toEqual([45, 90]);
      expect(events[0]?.payload).toMatchObject({ activity: 'coding', subject: 'Visual Studio Code' });
    });

    it('survives a short look at something else', () => {
      s.hold(code, 40 * MINUTE);
      s.hold(docs, BREAK_MS - MINUTE);
      const events = s.hold(code, 10 * MINUTE).filter((event) => event.type === 'focus.long');
      expect(events.map((event) => event.payload.minutes)).toEqual([45]);
    });

    it('starts over once something else has held for long enough', () => {
      s.hold(code, 40 * MINUTE);
      s.hold(docs, BREAK_MS + 2 * MINUTE);
      const events = s.hold(code, 10 * MINUTE).filter((event) => event.type === 'focus.long');
      expect(events).toEqual([]);
    });

    it('does not count time in front of a window nobody is at', () => {
      s.hold(code, 30 * MINUTE);
      s.hold(code, 30 * MINUTE, { idle: true });
      const events = s.hold(code, 20 * MINUTE).filter((event) => event.type === 'focus.long');
      expect(events).toEqual([]);
    });

    it('keeps counting a video through idleness, because that is what watching is', () => {
      const events = s.hold(youtube, 50 * MINUTE, { idle: true }).filter((event) => event.type === 'focus.long');
      expect(events.map((event) => event.payload.minutes)).toEqual([45]);
    });
  });

  describe('restlessness', () => {
    const thrash = (session: Session, switches: number): FocusEvent[] => {
      const events: FocusEvent[] = [];
      for (let i = 0; i <= switches; i += 1) events.push(...session.hold(i % 2 === 0 ? code : discord, 0));
      return events;
    };

    it('fires once when the windows will not stay still', () => {
      const events = thrash(s, RESTLESS_SWITCHES + 4).filter((event) => event.type === 'focus.restless');
      expect(events).toHaveLength(1);
      expect(events[0]?.payload.count).toBe(RESTLESS_SWITCHES);
    });

    it('stays quiet for ordinary back-and-forth', () => {
      expect(types(thrash(s, RESTLESS_SWITCHES - 2))).not.toContain('focus.restless');
    });

    it('can fire again only after things have calmed down', () => {
      thrash(s, RESTLESS_SWITCHES + 2);
      s.hold(code, 5 * MINUTE);
      const again = thrash(s, RESTLESS_SWITCHES + 2).filter((event) => event.type === 'focus.restless');
      expect(again).toHaveLength(1);
    });
  });

  describe('hung windows', () => {
    it('waits before calling a window frozen', () => {
      expect(types(s.hold(code, HUNG_CONFIRM_MS - TICK, { hung: true }))).not.toContain('focus.hung');
    });

    it('reports a window that stays frozen, once', () => {
      const events = s.hold(code, HUNG_CONFIRM_MS + 6 * TICK, { hung: true }).filter((event) => event.type === 'focus.hung');
      expect(events).toHaveLength(1);
      expect(events[0]?.payload.app).toBe('Visual Studio Code');
    });

    it('reports it again if it recovers and freezes a second time', () => {
      s.hold(code, HUNG_CONFIRM_MS + TICK, { hung: true });
      s.hold(code, 2 * TICK);
      expect(types(s.hold(code, HUNG_CONFIRM_MS + TICK, { hung: true }))).toContain('focus.hung');
    });
  });

  describe('tools', () => {
    it('remarks on a tool the moment it appears, without waiting for it to settle', () => {
      const events = s.hold(taskmgr, 0);
      expect(events).toEqual([
        { type: 'focus.tool', payload: { activity: 'other', app: 'Task Manager', subject: 'Task Manager', tool: 'taskmgr' } }
      ]);
    });

    it('does not repeat while the tool stays open, and never treats it as settled', () => {
      s.hold(taskmgr, 0);
      expect(s.hold(taskmgr, 2 * MINUTE)).toEqual([]);
    });

    it('remarks again when the tool is reopened', () => {
      s.hold(taskmgr, 0);
      s.hold(code, TICK);
      expect(types(s.hold(taskmgr, 0))).toEqual(['focus.tool']);
    });
  });

  describe('gaps', () => {
    it('starts a fresh sitting after a long silence from the probe', () => {
      s.hold(code, 40 * MINUTE);
      s.now += GAP_MS + 10 * MINUTE; // asleep
      const events = s.hold(code, 10 * MINUTE).filter((event) => event.type === 'focus.long');
      // Fifty minutes on the wall clock, but not fifty minutes of focus.
      expect(events).toEqual([]);
    });
  });
});
