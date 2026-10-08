import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CooldownLedger, createDurationResolver } from '@main/core/cooldown';
import { PhraseBankIndex, parsePhraseBank } from '@main/core/phraseBank';
import { RecentHistory } from '@main/core/selector';
import { SpeechDirector, type SpeechRequest } from '@main/core/speechDirector';
import type { SuppressionState } from '@main/core/suppression';
import type { SpeakRequest, VoiceEngine } from '@main/voice/VoiceEngine';

const bank = new PhraseBankIndex(
  parsePhraseBank({
    version: 1,
    groups: [
      {
        id: 'g.ambient',
        category: 'ambient',
        phrases: [
          { id: 'p.one', segments: [{ text: 'One.', mode: 'normal' }] },
          { id: 'p.two', segments: [{ text: 'Two.', mode: 'normal' }] },
          { id: 'p.three', segments: [{ text: 'Three.', mode: 'normal' }] },
          { id: 'p.four', segments: [{ text: 'Four.', mode: 'normal' }] }
        ]
      },
      {
        id: 'g.system',
        category: 'system',
        phrases: [{ id: 's.one', segments: [{ text: 'Hot.', mode: 'normal' }] }]
      }
    ]
  })
);

class StubVoice implements VoiceEngine {
  readonly available = false;
  spoken: string[] = [];
  private resolveCurrent: (() => void) | null = null;

  speak(req: SpeakRequest): Promise<void> {
    this.spoken.push(req.phraseId);
    return new Promise<void>((resolve) => {
      this.resolveCurrent = resolve;
    });
  }

  stop(): void {
    this.resolveCurrent?.();
    this.resolveCurrent = null;
  }

  endPlayback(): void {
    this.stop();
  }
}

/**
 * `perform()` awaits `voice.prepare` before it calls `voice.speak`, so the
 * observable effects land a couple of microtasks after `submit` returns.
 */
async function flush(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
}

function clear(): SuppressionState {
  return { suppressed: false, reason: null, hardMute: false, reasons: [] };
}

function harness(options: { suppression?: () => SuppressionState; rng?: () => number } = {}) {
  let now = 1_000_000;
  const ledger = new CooldownLedger(createDurationResolver(() => 1));
  const history = new RecentHistory();
  const voice = new StubVoice();
  const overlay = { show: vi.fn(), hide: vi.fn(), interrupt: vi.fn() };

  const director = new SpeechDirector({
    bank,
    ledger,
    history,
    voice,
    overlay,
    getSuppression: options.suppression ?? clear,
    getConditionContext: () => ({ uptimeMinutes: 120, firstRun: false }),
    rng: options.rng ?? (() => 0),
    now: () => now
  });

  return {
    director,
    ledger,
    voice,
    overlay,
    advance: (ms: number) => {
      now += ms;
    },
    get now() {
      return now;
    }
  };
}

function ambient(overrides: Partial<SpeechRequest> = {}): SpeechRequest {
  return { origin: 'test', groupId: 'g.ambient', category: 'ambient', priority: 'ambient', ...overrides };
}

describe('SpeechDirector', () => {
  let h: ReturnType<typeof harness>;

  beforeEach(() => {
    h = harness();
  });

  it('speaks and stamps global, category and phrase cooldowns', () => {
    const decision = h.director.submit(ambient());
    expect(decision.said).toBe(true);
    expect(h.ledger.canFire('global', h.now)).toBe(false);
    expect(h.ledger.canFire('category:ambient', h.now)).toBe(false);
    if (decision.said) expect(h.ledger.canFire(`phrase:${decision.phraseId}`, h.now)).toBe(false);
  });

  it('pushes the resolved line to the overlay', async () => {
    h.director.submit(ambient());
    await Promise.resolve();
    expect(h.overlay.show).toHaveBeenCalledOnce();
    expect(h.overlay.show.mock.calls[0]?.[0].segments).toEqual([{ text: 'One.', mode: 'normal' }]);
  });

  it('drops everything under hard mute, including urgent', () => {
    const muted = harness({
      suppression: () => ({ suppressed: true, reason: 'muted', hardMute: true, reasons: ['muted'] })
    });
    expect(muted.director.submit(ambient({ priority: 'urgent' }))).toEqual({
      said: false,
      reason: 'muted',
      deferred: false
    });
  });

  it('drops ambient while suppressed but lets urgent through', () => {
    const quiet = harness({
      suppression: () => ({
        suppressed: true,
        reason: 'quietHours',
        hardMute: false,
        reasons: ['quietHours']
      })
    });
    expect(quiet.director.submit(ambient()).said).toBe(false);
    expect(quiet.director.submit(ambient({ priority: 'urgent' })).said).toBe(true);
  });

  it('drops a second ambient inside the global cooldown', () => {
    h.director.submit(ambient());
    h.voice.endPlayback();
    const second = h.director.submit(ambient());
    expect(second).toMatchObject({ said: false, reason: 'globalCooldown' });
  });

  it('lets urgent bypass both global and category cooldowns', () => {
    h.director.submit(ambient());
    h.voice.endPlayback();
    const urgent = h.director.submit({
      origin: 'test',
      groupId: 'g.system',
      category: 'system',
      priority: 'urgent'
    });
    expect(urgent.said).toBe(true);
  });

  it('drops a same-priority candidate while speaking, and interrupts for a higher one', () => {
    h.director.submit(ambient());
    expect(h.director.speaking).toBe(true);

    // Same priority, cooldowns bypassed so we reach the busy check.
    expect(
      h.director.submit(ambient({ bypassCooldowns: true }))
    ).toMatchObject({ said: false, reason: 'busy' });

    const urgent = h.director.submit({
      origin: 'test',
      groupId: 'g.system',
      category: 'system',
      priority: 'urgent'
    });
    expect(urgent.said).toBe(true);
    expect(h.overlay.interrupt).toHaveBeenCalledOnce();
  });

  it('never repeats a phrase while its per-phrase cooldown holds', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 4; i += 1) {
      const decision = h.director.submit(ambient({ bypassCooldowns: false, priority: 'ambient' }));
      if (decision.said) {
        expect(seen.has(decision.phraseId)).toBe(false);
        seen.add(decision.phraseId);
        await flush();
        h.voice.endPlayback();
        await flush();
      }
      // Past the 45 min ambient category cooldown, but well inside the
      // 4 h per-phrase cooldown that anti-repeat relies on.
      h.advance(46 * 60_000);
    }
    expect(seen.size).toBe(4);
  });

  it('drops when the group is unknown', () => {
    expect(h.director.submit(ambient({ groupId: 'nope' }))).toMatchObject({
      said: false,
      reason: 'unknownGroup'
    });
  });

  it('defers a notable candidate and fires it once the block clears', async () => {
    let suppressed = true;
    const deferring = harness({
      suppression: () =>
        suppressed
          ? { suppressed: true, reason: 'fullscreen', hardMute: false, reasons: ['fullscreen'] }
          : clear()
    });

    expect(deferring.director.submit(ambient({ priority: 'notable' })).said).toBe(false);
    suppressed = false;
    deferring.director.flushDeferred();
    await flush();
    expect(deferring.voice.spoken).toHaveLength(1);
  });

  it('keeps a deferred item queued across ticks while the block persists', async () => {
    let suppressed = true;
    const deferring = harness({
      suppression: () =>
        suppressed
          ? { suppressed: true, reason: 'fullscreen', hardMute: false, reasons: ['fullscreen'] }
          : clear()
    });

    deferring.director.submit(ambient({ priority: 'notable' }));
    // The 5 s flush timer ticks several times while the game is still fullscreen.
    for (let i = 0; i < 6; i += 1) {
      deferring.advance(5_000);
      deferring.director.flushDeferred();
    }
    expect(deferring.director.deferredSnapshot()).toHaveLength(1);

    suppressed = false;
    deferring.advance(5_000);
    deferring.director.flushDeferred();
    await flush();
    expect(deferring.voice.spoken).toHaveLength(1);
    expect(deferring.director.deferredSnapshot()).toHaveLength(0);
  });

  it('discards deferred items past their 90 second TTL', async () => {
    const deferring = harness({
      suppression: () => ({
        suppressed: true,
        reason: 'fullscreen',
        hardMute: false,
        reasons: ['fullscreen']
      })
    });
    deferring.director.submit(ambient({ priority: 'notable' }));
    expect(deferring.director.deferredSnapshot()).toHaveLength(1);
    deferring.advance(91_000);
    deferring.director.flushDeferred();
    await flush();
    expect(deferring.voice.spoken).toHaveLength(0);
    expect(deferring.director.deferredSnapshot()).toHaveLength(0);
  });

  it('never queues more than three deferred items', () => {
    const deferring = harness({
      suppression: () => ({
        suppressed: true,
        reason: 'fullscreen',
        hardMute: false,
        reasons: ['fullscreen']
      })
    });
    for (let i = 0; i < 5; i += 1) deferring.director.submit(ambient({ priority: 'notable' }));
    expect(deferring.director.deferredSnapshot()).toHaveLength(3);
  });

  it('lets the tray bypass cooldowns and suppression', () => {
    const quiet = harness({
      suppression: () => ({
        suppressed: true,
        reason: 'quietHours',
        hardMute: false,
        reasons: ['quietHours']
      })
    });
    const decision = quiet.director.submit(
      ambient({ priority: 'notable', bypassCooldowns: true, bypassSuppression: true })
    );
    expect(decision.said).toBe(true);
  });

  it('hides the overlay when playback finishes', async () => {
    const decision = h.director.submit(ambient());
    await Promise.resolve();
    h.voice.endPlayback();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.overlay.hide).toHaveBeenCalled();
    expect(h.director.speaking).toBe(false);
    expect(decision.said).toBe(true);
  });
});
