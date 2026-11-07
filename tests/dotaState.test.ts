import { describe, expect, it } from 'vitest';
import { heroName } from '@shared/game';
import { dotaPayloadSchema, DotaTracker, tokenMatches, type DotaPayload } from '@main/engine/dotaState';

const IN_PROGRESS = 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS';
const POST_GAME = 'DOTA_GAMERULES_STATE_POST_GAME';

/** What Dota sends while one plays, trimmed to what is read. */
function state(over: { match?: string; game?: string; win?: string; team?: string; kills?: number; deaths?: number; streak?: number } = {}): DotaPayload {
  return {
    provider: { appid: 570 },
    map: { matchid: over.match ?? '7000000001', game_state: over.game ?? IN_PROGRESS, win_team: over.win ?? 'none' },
    player: { team_name: over.team ?? 'radiant', kills: over.kills ?? 0, deaths: over.deaths ?? 0, kill_streak: over.streak ?? 0 },
    hero: { name: 'npc_dota_hero_pudge' }
  };
}

const names = (tracker: DotaTracker, payload: DotaPayload): string[] => tracker.update(payload).map((event) => event.event);

describe('DotaTracker', () => {
  it('takes the first look at a match as where it stands, not as news', () => {
    const tracker = new DotaTracker();
    expect(tracker.update(state({ kills: 5, deaths: 3 }))).toEqual([]);
  });

  it('reports a win once, however often Dota repeats the results screen', () => {
    const tracker = new DotaTracker();
    tracker.update(state({ kills: 4, deaths: 1 }));
    const won = tracker.update(state({ game: POST_GAME, win: 'radiant', kills: 4, deaths: 1 }));
    expect(won).toEqual([{ event: 'won', hero: 'npc_dota_hero_pudge', kills: 4, deaths: 1, streak: 0, streakBefore: 0 }]);
    expect(names(tracker, state({ game: POST_GAME, win: 'radiant', kills: 4, deaths: 1 }))).toEqual([]);
    expect(names(tracker, state({ game: POST_GAME, win: 'radiant', kills: 4, deaths: 1 }))).toEqual([]);
  });

  it('knows a loss from the team that won', () => {
    const tracker = new DotaTracker();
    tracker.update(state({ team: 'dire' }));
    expect(names(tracker, state({ team: 'dire', game: POST_GAME, win: 'radiant' }))).toEqual(['lost']);
  });

  it('does not cheer when it first sees a match already over, nor when it comes back to one it has', () => {
    const tracker = new DotaTracker();
    expect(names(tracker, state({ game: POST_GAME, win: 'radiant' }))).toEqual([]);
    tracker.update(state({ match: '2' }));
    tracker.update(state({ match: '2', game: POST_GAME, win: 'radiant' }));
    // Back to the first match's results, and into them again from in progress: still not twice.
    tracker.update(state({ match: '1' }));
    expect(names(tracker, state({ match: '1', game: POST_GAME, win: 'radiant' }))).toEqual(['won']);
    tracker.update(state({ match: '1' }));
    expect(names(tracker, state({ match: '1', game: POST_GAME, win: 'radiant' }))).toEqual([]);
  });

  it('reports kills and deaths as their counts go up, with the streak before and after', () => {
    const tracker = new DotaTracker();
    tracker.update(state({ kills: 1, streak: 1 }));
    expect(tracker.update(state({ kills: 3, streak: 3 }))).toEqual([{ event: 'kill', hero: 'npc_dota_hero_pudge', kills: 3, deaths: 0, streak: 3, streakBefore: 1 }]);
    expect(names(tracker, state({ kills: 3, streak: 3 }))).toEqual([]);
    expect(names(tracker, state({ kills: 3, deaths: 1, streak: 0 }))).toEqual(['death']);
  });

  it('starts counting afresh in a new match', () => {
    const tracker = new DotaTracker();
    tracker.update(state({ match: '1', kills: 9 }));
    expect(names(tracker, state({ match: '2', kills: 0 }))).toEqual([]);
    expect(names(tracker, state({ match: '2', kills: 1 }))).toEqual(['kill']);
  });

  it('ignores the menus, someone else\'s match and another game', () => {
    const tracker = new DotaTracker();
    expect(tracker.update({ provider: { appid: 570 } })).toEqual([]);
    const watching = { ...state(), player: {} };
    tracker.update(watching);
    expect(tracker.update({ ...watching, map: { matchid: '7000000001', game_state: POST_GAME, win_team: 'radiant' } })).toEqual([]);
    tracker.update({ ...state(), provider: { appid: 730 } });
    expect(tracker.update({ ...state({ kills: 2 }), provider: { appid: 730 } })).toEqual([]);
  });

  it('keeps a count Dota left out as it was', () => {
    const tracker = new DotaTracker();
    tracker.update(state({ kills: 2 }));
    expect(tracker.update({ ...state(), player: { team_name: 'radiant' } })).toEqual([]);
    expect(names(tracker, state({ kills: 2 }))).toEqual([]);
  });
});

describe('dotaPayloadSchema', () => {
  it('keeps what is read and drops the rest', () => {
    const parsed = dotaPayloadSchema.parse({ ...state(), items: { slot0: { name: 'item_blink' } }, previously: { player: { kills: 0 } } });
    expect(parsed).toEqual(state());
  });

  it('refuses what is not shaped like Dota', () => {
    expect(dotaPayloadSchema.safeParse({ player: { kills: 'many' } }).success).toBe(false);
    expect(dotaPayloadSchema.safeParse({ map: { matchid: 'x'.repeat(500) } }).success).toBe(false);
  });
});

describe('tokenMatches', () => {
  it('takes only the exact token, and never an empty one', () => {
    expect(tokenMatches('abc123', 'abc123')).toBe(true);
    expect(tokenMatches('abc124', 'abc123')).toBe(false);
    expect(tokenMatches('abc12', 'abc123')).toBe(false);
    expect(tokenMatches(undefined, 'abc123')).toBe(false);
    expect(tokenMatches(42, 'abc123')).toBe(false);
    expect(tokenMatches('', '')).toBe(false);
  });
});

describe('heroName', () => {
  it('reads like a name', () => {
    expect(heroName('npc_dota_hero_shadow_shaman')).toBe('Shadow Shaman');
    expect(heroName('npc_dota_hero_pudge')).toBe('Pudge');
  });
});
