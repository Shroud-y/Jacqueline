import { useEffect, useState } from 'react';
import type { Settings, SettingsView, UpdateView } from '@shared/types';
import { Checkbox, ClockInput, Group, Notice } from './fields';
import GameEventsSection from './GameEventsSection';

/** What applies to the whole app rather than to one character. */
export default function SettingsPane(): JSX.Element | null {
  const [view, setView] = useState<SettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const api = window.jacquelineEditor;
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
    void window.jacquelineEditor?.updateSettings(patch).then((result) => {
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
              hint={autostartAvailable ? 'Jacqueline starts in the tray when you sign in.' : 'Works in the installed app only, not in a development run.'}
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

          <Group title="Updates">
            <div>
              <Checkbox
                label="Look for new versions"
                hint="Once a day Jacqueline asks GitHub whether a newer version is out, and says so here and in the tray. It never downloads anything, and asks nothing else."
                checked={settings.checkForUpdates}
                disabled={!view.updates.supported}
                onChange={(checkForUpdates) => update({ checkForUpdates })}
              />
              <UpdateStatus updates={view.updates} on={settings.checkForUpdates} />
            </div>
          </Group>

          <GameEventsSection value={settings.gameEvents} onChange={(gameEvents) => update({ gameEvents })} />

          <Group title="Files">
            <div>
              <div className="prose">Every character is a folder of its own: character.json and its files.</div>
              <button type="button" className="button quiet under-prose" onClick={() => void window.jacquelineEditor?.openRoot()}>
                Open characters folder
              </button>
            </div>
          </Group>
        </div>
      </div>
    </>
  );
}

/** "14:05, 7 Nov", in the user's own clock. */
function when(at: number): string {
  const date = new Date(at);
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return `${time}, ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
}

/** What the last look found, and a way to look again. */
function UpdateStatus({ updates, on }: { updates: UpdateView; on: boolean }): JSX.Element {
  const [failed, setFailed] = useState<string | null>(null);
  if (!updates.supported) return <div className="prose update-status">Works in the installed app only, not in a development run. This is {updates.current}.</div>;
  if (!on) return <div className="prose update-status">This is {updates.current}.</div>;

  const checkNow = (): void => {
    void window.jacquelineEditor?.checkForUpdates().then((result) => setFailed(result.ok ? null : result.error));
  };
  const open = (): void => {
    void window.jacquelineEditor?.openUpdate().then((result) => setFailed(result.ok ? null : result.error));
  };

  const said = updates.checking
    ? 'Looking…'
    : updates.newer
      ? `${updates.newer.version} is out. This is ${updates.current}.`
      : updates.error
        ? `${updates.error} It will try again tomorrow.`
        : updates.checkedAt !== null
          ? `Up to date: this is ${updates.current}, the latest. Last looked at ${when(updates.checkedAt)}.`
          : `This is ${updates.current}. It has not looked yet.`;

  return (
    <div className="update-status">
      <div className="prose" aria-live="polite">
        {failed ?? said}
      </div>
      <div className="update-actions">
        {updates.newer ? (
          <button type="button" className="button primary" onClick={open}>
            Open the release page
          </button>
        ) : null}
        <button type="button" className="button quiet" disabled={updates.checking} onClick={checkNow}>
          Look now
        </button>
      </div>
    </div>
  );
}
