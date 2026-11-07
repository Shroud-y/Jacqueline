import { useEffect, useState } from 'react';
import type { Character } from '@shared/character';
import { ruleTitle } from '@shared/ruleText';
import type { ActivityEntry } from '@shared/types';

/** At most this many shown; main keeps a few hundred for the whole app. */
const SHOWN_MAX = 200;

const OUTCOME_MARK: Record<ActivityEntry['outcome'], string> = {
  fired: '✓',
  skipped: '✗',
  note: '·',
  problem: '!'
};

/**
 * What happened to this character lately, and what came of it: which rule
 * fired on what, and why one that matched did not. The answer to "why does
 * my rule not fire?" — newest first, as it happens.
 */
export default function ActivityTab({ character }: { character: Character }): JSX.Element {
  const { id } = character;
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);

  useEffect(() => {
    const api = window.jacquelineEditor;
    if (!api) return;
    let cancelled = false;
    void api.activity({ id }).then((view) => {
      if (!cancelled) setEntries((current) => merge(view.entries, current ?? []));
    });
    void api.watchActivity({ id });
    const off = api.onActivity((entry) => setEntries((current) => merge(current ?? [], [entry])));
    return () => {
      cancelled = true;
      off();
      void api.watchActivity({ id: null });
    };
  }, [id]);

  if (entries === null) return <div className="activity" />;

  const rules = new Map(character.rules.map((rule) => [rule.id, rule]));
  const shown = [...entries].reverse().slice(0, SHOWN_MAX);

  return (
    <div className="activity">
      <p className="prose activity-intro">
        What set its rules off, and why one that matched did not fire — since Jacqueline started, newest first. Open a rule in Behaviour and press
        Check now to see what would stop it right now.
      </p>
      {shown.length === 0 ? (
        <div className="blank activity-blank">
          <p>Nothing yet. Whatever its rules wait for shows up here when it happens.</p>
        </div>
      ) : (
        <ol className="activity-list" aria-label={`What happened to ${character.name}`}>
          {shown.map((entry) => {
            const rule = entry.ruleId ? rules.get(entry.ruleId) : undefined;
            return (
              <li key={entry.id} className="activity-row" data-outcome={entry.outcome}>
                <time className="activity-time" dateTime={new Date(entry.at).toISOString()}>
                  {clockOf(entry.at)}
                </time>
                <span className="activity-mark" aria-label={entry.outcome}>
                  {OUTCOME_MARK[entry.outcome]}
                </span>
                <span className="activity-text">
                  {entry.event ? <span className="activity-event">{entry.event}</span> : null}
                  {/* What came of a rule follows the line that names it, so only fired and skipped name it again. */}
                  {rule && (entry.outcome === 'fired' || entry.outcome === 'skipped') ? <b className="activity-rule">{ruleTitle(rule)}</b> : null}
                  {/* A fired entry's text is the rule's title, already shown — unless the rule is gone since. */}
                  {entry.outcome !== 'fired' || !rule ? <span className="activity-why">{entry.text}</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/** Both lists, each entry once, oldest first: what was asked for and what arrived meanwhile may overlap. */
function merge(a: ActivityEntry[], b: ActivityEntry[]): ActivityEntry[] {
  const byId = new Map<number, ActivityEntry>();
  for (const entry of [...a, ...b]) byId.set(entry.id, entry);
  return [...byId.values()].sort((x, y) => x.id - y.id);
}

function clockOf(at: number): string {
  const date = new Date(at);
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}
