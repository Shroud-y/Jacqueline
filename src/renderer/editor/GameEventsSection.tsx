import { useEffect, useState } from 'react';
import { GAME_PORT_MAX, GAME_PORT_MIN } from '@shared/game';
import type { GameEventsSettings, GameStatus } from '@shared/types';
import { Checkbox, Field, Group, Notice, NumberInput } from './fields';

/** What the status line says. */
function statusText(status: GameStatus, port: number): string {
  switch (status.state) {
    case 'off':
      return 'Off.';
    case 'idle':
      return 'Not listening: no rule or script waits for a game event yet.';
    case 'listening':
      return status.heardAt === null
        ? `Listening on 127.0.0.1:${port}. Nothing from Dota 2 yet — it sends once a match or the menu is open.`
        : `Listening on 127.0.0.1:${port}. Dota 2 is getting through.`;
    case 'failed':
      return `Cannot listen: ${status.error ?? 'something went wrong'}.`;
  }
}

/** Settings → Games: Dota 2's Game State Integration, off until asked for. */
export default function GameEventsSection({ value, onChange }: { value: GameEventsSettings; onChange: (next: GameEventsSettings) => void }): JSX.Element {
  const [status, setStatus] = useState<GameStatus | null>(null);
  const [written, setWritten] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const api = window.jacquelineEditor;
    if (!api) return;
    let cancelled = false;
    void api.gameStatus().then((next) => !cancelled && setStatus(next));
    const off = api.onGameStatus(setStatus);
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const setUp = async (pick: boolean): Promise<void> => {
    const api = window.jacquelineEditor;
    if (!api || busy) return;
    setBusy(true);
    try {
      const result = await api.setUpDota({ pick });
      if (result.ok) {
        setWritten(result.path);
        setProblem(null);
      } else if (result.error !== '') setProblem(result.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Group title="Games">
      <Checkbox
        label="Dota 2 game events"
        hint="Dota 2 tells Jacqueline when you win, lose, get a kill or die (Valve's Game State Integration). It sends to this computer only, 127.0.0.1 — nothing goes out. Jacqueline listens only while some rule or script waits for a game event."
        checked={value.enabled}
        onChange={(enabled) => onChange({ ...value, enabled })}
      />
      {value.enabled ? (
        <div className="game-events">
          {status ? (
            <div className="prose" data-state={status.state}>
              {statusText(status, value.port)}
            </div>
          ) : null}
          <div>
            <div className="prose">Dota 2 has to be told where to send: a small cfg file in its folder.</div>
            <div className="under-prose">
              <button type="button" className="button quiet" disabled={busy} onClick={() => void setUp(false)}>
                Set up Dota 2
              </button>{' '}
              <button type="button" className="button quiet" disabled={busy} onClick={() => void setUp(true)}>
                Choose Dota's folder…
              </button>
            </div>
          </div>
          {written ? (
            <div className="prose game-written">
              Written to <code>{written}</code>. <b>Restart Dota 2</b> to pick it up.
            </div>
          ) : null}
          {problem ? (
            <Notice kind="bad" lead="Not set up." onDismiss={() => setProblem(null)}>
              {problem}
            </Notice>
          ) : null}
          <Field label="Port" hint="Change it only if another program has it; then set up Dota 2 again.">
            <NumberInput label="Port" value={value.port} min={GAME_PORT_MIN} max={GAME_PORT_MAX} onCommit={(port) => onChange({ ...value, port: Math.round(port) })} />
          </Field>
        </div>
      ) : null}
    </Group>
  );
}
