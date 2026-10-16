/**
 * What a character costs to keep on screen, in words a person can weigh.
 * Pure, and honest about what it knows: the figures are what was measured on
 * a real desktop (docs/REWORK.md, 1.2b and 4.1), the rest is said as a
 * direction, not a number.
 */

import { characterElement, type Character } from './character';

export type CostLevel = 'light' | 'moderate' | 'heavy';

export interface CostItem {
  text: string;
  level: CostLevel;
}

export interface CostEstimate {
  level: CostLevel;
  items: CostItem[];
}

/** The size the moving figures were measured at; larger moves more pixels. */
const MEASURED_AREA = 300 * 220;

const RANK: Record<CostLevel, number> = { light: 0, moderate: 1, heavy: 2 };

export function estimateCost(character: Character): CostEstimate {
  const items: CostItem[] = [];
  const { appearance, presence, rules } = character;
  const moving = Object.values(appearance.states).some((visual) => visual.type === 'video');
  const element = characterElement(character);
  const area = element ? element.width * element.height : 0;

  if (!moving) {
    items.push({ text: 'A still picture: about 0.5% of one CPU core while it is on screen.', level: 'light' });
  } else if (appearance.restSec <= 0) {
    items.push({ text: 'A video on a loop: about 6% of one CPU core for as long as it is on screen and you are at the computer.', level: 'heavy' });
  } else {
    items.push({
      text: `A video that rests ${appearance.restSec} s between plays: about 6% of one CPU core while it plays, 0.5% while it rests.`,
      level: 'moderate'
    });
  }
  if (moving && area > MEASURED_AREA * 2) {
    items.push({ text: `It is ${element?.width} × ${element?.height}: a video this size costs more than the figure above.`, level: 'moderate' });
  }

  // What has to be watched on its behalf. Listing running programs takes about 8 ms; the rest is close to free.
  const active = rules.filter((rule) => rule.enabled);
  const programs =
    presence.mode === 'whileRunning' ||
    active.some((rule) => rule.when.type === 'programStarted' || rule.when.type === 'programStopped' || rule.if.some((c) => c.type === 'programRunning'));
  if (programs) items.push({ text: 'Looks at the running programs every 5 seconds: about 0.2% of one core.', level: 'light' });
  if (presence.mode === 'whileFocused' || presence.hideOnFullscreen || active.some((rule) => rule.when.type === 'programFocused')) {
    items.push({ text: 'Is told when the window in front changes: next to nothing.', level: 'light' });
  }
  if (presence.mode !== 'always') {
    items.push({ text: 'Off screen whenever it is not wanted, and then it costs nothing.', level: 'light' });
  }

  const level = items.reduce<CostLevel>((worst, item) => (RANK[item.level] > RANK[worst] ? item.level : worst), 'light');
  return { level, items };
}
