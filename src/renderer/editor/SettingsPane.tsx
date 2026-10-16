import { useEffect, useState } from 'react';
import type { Settings, SettingsView } from '@shared/types';
import { Checkbox, ClockInput, Group, Notice } from './fields';

/** What applies to the whole app rather than to one character. */
export default function SettingsPane(): JSX.Element | null {
  const [view, setView] = useState<SettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const api = window.shardEditor;
    if (!api) return;
    let cancelled = false;
    void api.settings().then((next) => {
      if (!cancelled) setView(next);
    });
    // The tray changes some of these too.
    const off = api.onSettings(setView);
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  if (!view) return null;
  const { settings, autostartAvailable } = view;

  const update = (patch: Partial<Omit<Settings, 'version'>>): void => {
    // Shown at once, so a second change made before main answers builds on this one.
    setView((current) => (current ? { ...current, settings: { ...current.settings, ...patch } } : current));
    void window.shardEditor?.updateSettings(patch).then((result) => {
      setView((current) => (current ? { ...current, settings: result.settings } : current));
      setError(result.ok ? null : result.error);
    });
  };

  const quiet = settings.quietHours;

  return (
    <>
      <header className="pane-head">
        <h1 className="pane-title">Settings</h1>
      </header>
      <div className="pane-body">
        {error ? (
          <div className="pane-notice">
            <Notice kind="bad" lead="Not saved." onDismiss={() => setError(null)}>
              {error}
            </Notice>
          </div>
        ) : null}
        <div className="form">
          <Group title="Start">
            <Checkbox
              label="Start with Windows"
              hint={autostartAvailable ? 'SHARD starts in the tray when you sign in.' : 'Works in the installed app only, not in a development run.'}
              checked={settings.startWithSystem}
              disabled={!autostartAvailable}
              onChange={(startWithSystem) => update({ startWithSystem })}
            />
          </Group>

          <Group title="Quiet">
            <Checkbox
              label="Mute everyone"
              hint="Characters stay on screen but say and play nothing. The same as Mute in the tray."
              checked={settings.muted}
              onChange={(muted) => update({ muted })}
            />
            <div>
              <Checkbox
                label="Quiet hours"
                hint="The same, every day between these times. They may run past midnight."
                checked={quiet.enabled}
                onChange={(enabled) => update({ quietHours: { ...quiet, enabled } })}
              />
              <div className="quiet-hours" data-enabled={quiet.enabled}>
                <ClockInput label="Quiet from" value={quiet.from} onChange={(from) => update({ quietHours: { ...quiet, from } })} />
                <span className="rule-word">to</span>
                <ClockInput label="Quiet until" value={quiet.to} onChange={(to) => update({ quietHours: { ...quiet, to } })} />
              </div>
            </div>
          </Group>

          <Group title="Files">
            <div>
              <div className="prose">Every character is a folder of its own: character.json and its files.</div>
              <button type="button" className="button quiet under-prose" onClick={() => void window.shardEditor?.openRoot()}>
                Open characters folder
              </button>
            </div>
          </Group>
        </div>
      </div>
    </>
  );
}
