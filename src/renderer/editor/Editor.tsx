import { useEffect, useState, type DragEvent } from 'react';
import type { Character, CharacterEntry } from '@shared/character';
import type { LiveView } from '@shared/types';
import ActivityTab from './ActivityTab';
import AppearanceTab from './AppearanceTab';
import AudioTab from './AudioTab';
import BehaviourTab from './BehaviourTab';
import GeneralTab from './GeneralTab';
import LayoutTab from './layout/LayoutTab';
import LinesTab from './LinesTab';
import SettingsPane from './SettingsPane';
import Thumbnail from './Thumbnail';
import { MoreMenu, Notice, Switch, TextInput } from './fields';
import { useCharacters, type Characters } from './useCharacters';

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'layout', label: 'Layout' },
  { id: 'behaviour', label: 'Behaviour' },
  { id: 'lines', label: 'Lines' },
  { id: 'audio', label: 'Audio' },
  { id: 'activity', label: 'Activity' }
] as const;

type TabId = (typeof TABS)[number]['id'];

const NEW_NAME = 'New character';

/** Where characters are built: who there is on the left, the chosen one on the right. */
export default function Editor(): JSX.Element {
  const characters = useCharacters();
  const { entries } = characters;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The app's own settings take the place of a character while they are open.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const select = (id: string): void => {
    setSelectedId(id);
    setSettingsOpen(false);
  };

  // Who is on screen and talking now, for the marks beside their names.
  const [live, setLive] = useState<LiveView>({ visible: [], speaking: [] });
  useEffect(() => {
    const api = window.jacquelineEditor;
    if (!api) return;
    let cancelled = false;
    void api.live().then((view) => {
      if (!cancelled) setLive(view);
    });
    const off = api.onLive(setLive);
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  // Something is always selected while there is anything to select.
  const selected = entries?.find((entry) => entry.id === selectedId) ?? entries?.[0] ?? null;

  const create = async (): Promise<void> => {
    const created = await characters.create(NEW_NAME);
    if (created) select(created.id);
  };

  const importZip = async (path?: string): Promise<void> => {
    const imported = await characters.importCharacter(path);
    if (imported) select(imported.id);
  };

  // A zip dropped anywhere on the list of characters is imported.
  const [dropping, setDropping] = useState(false);
  const onDragOver = (event: DragEvent): void => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDropping(true);
  };
  const onDrop = (event: DragEvent): void => {
    event.preventDefault();
    setDropping(false);
    const file = event.dataTransfer.files[0];
    const path = file ? window.jacquelineEditor?.pathForFile(file) : '';
    if (path) void importZip(path);
  };

  return (
    <div className="editor">
      <aside className="sidebar" data-dropping={dropping} onDragOver={onDragOver} onDragLeave={() => setDropping(false)} onDrop={onDrop}>
        <div className="sidebar-head">Characters</div>
        <nav className="sidebar-list" aria-label="Characters">
          {entries?.map((entry) => (
            <SidebarItem
              key={entry.id}
              entry={entry}
              selected={!settingsOpen && entry.id === selected?.id}
              live={live.speaking.includes(entry.id) ? 'speaking' : live.visible.includes(entry.id) ? 'visible' : null}
              onSelect={() => select(entry.id)}
            />
          ))}
        </nav>
        <button type="button" className="button quiet sidebar-new" onClick={() => void create()}>
          + New character
        </button>
        <button type="button" className="button quiet sidebar-new sidebar-import" title="Or drop a character's .zip here" onClick={() => void importZip()}>
          Import…
        </button>
        <button type="button" className="sidebar-settings" aria-current={settingsOpen} onClick={() => setSettingsOpen(true)}>
          Settings
        </button>
      </aside>

      <main className="pane">
        {settingsOpen ? (
          <SettingsPane />
        ) : entries === null ? null : selected === null ? (
          <div className="blank">
            <h1>No characters yet</h1>
            <p>A character lives on your desktop: a picture or a video, where it sits, and when it shows up.</p>
            {characters.error ? (
              <Notice kind="bad" lead={characters.errorLead} onDismiss={characters.dismissError}>
                {characters.error}
              </Notice>
            ) : null}
            <button type="button" className="button primary" onClick={() => void create()}>
              Make the first one
            </button>
          </div>
        ) : selected.ok ? (
          // Keyed: switching character must not carry one's half-typed name over to the next.
          <CharacterPane key={selected.id} character={selected.character} characters={characters} onSelect={select} />
        ) : (
          <BrokenPane id={selected.id} error={selected.error} characters={characters} />
        )}
      </main>
    </div>
  );
}

interface SidebarItemProps {
  entry: CharacterEntry;
  selected: boolean;
  /** On screen right now, or talking. */
  live: 'visible' | 'speaking' | null;
  onSelect: () => void;
}

function SidebarItem({ entry, selected, live, onSelect }: SidebarItemProps): JSX.Element {
  const state = !entry.ok ? 'broken' : entry.character.enabled ? 'on' : 'off';
  const name = entry.ok ? entry.character.name : entry.id;
  const status = (state === 'off' ? ', off' : state === 'broken' ? ', cannot be read' : '') + (live === 'speaking' ? ', talking' : live === 'visible' ? ', on screen' : '');
  return (
    <button
      type="button"
      className="sidebar-item"
      data-selected={selected}
      data-state={state}
      aria-current={selected}
      aria-label={`${name}${status}`}
      onClick={onSelect}
    >
      {entry.ok ? <Thumbnail character={entry.character} /> : <span className="thumb thumb-broken" aria-hidden="true">!</span>}
      <span className="sidebar-name">{name}</span>
      {live ? <span className="sidebar-live" data-live={live} title={live === 'speaking' ? 'Talking' : 'On screen'} aria-hidden="true" /> : null}
    </button>
  );
}

interface CharacterPaneProps {
  character: Character;
  characters: Characters;
  onSelect: (id: string) => void;
}

function CharacterPane({ character, characters, onSelect }: CharacterPaneProps): JSX.Element {
  const [tab, setTab] = useState<TabId>('general');

  // Ctrl+Z / Ctrl+Y (and Ctrl+Shift+Z) undo and redo the last change to this character — except in a text
  // field, where they undo typing, as they do everywhere else.
  const { undo, redo } = characters;
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) void undo(character.id);
      else if (key === 'y' || (key === 'z' && event.shiftKey)) void redo(character.id);
      else return;
      event.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [character.id, undo, redo]);
  const [confirming, setConfirming] = useState(false);
  const [nameProblem, setNameProblem] = useState<string | null>(null);

  const duplicate = async (): Promise<void> => {
    const copy = await characters.duplicate(character.id);
    if (copy) onSelect(copy.id);
  };

  return (
    <>
      <header className="pane-head">
        <div className="pane-name">
          <TextInput
            label="Name"
            className="name-input"
            value={character.name}
            maxLength={60}
            validate={(value) => (value.trim() === '' ? 'A name cannot be empty.' : null)}
            onProblem={setNameProblem}
            onCommit={(name) => characters.update({ ...character, name: name.trim() })}
          />
          {nameProblem ? <div className="field-problem name-problem">{nameProblem}</div> : null}
        </div>
        {confirming ? (
          <div className="confirm">
            <button type="button" className="button danger armed" onClick={() => void characters.remove(character.id)}>
              Delete it and its files
            </button>
            <button type="button" className="button" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </div>
        ) : (
          <>
            <Switch label="On" checked={character.enabled} onChange={(enabled) => characters.update({ ...character, enabled })} />
            <MoreMenu
              label="More"
              items={[
                { label: 'Undo  Ctrl+Z', onSelect: () => void characters.undo(character.id) },
                { label: 'Redo  Ctrl+Y', onSelect: () => void characters.redo(character.id) },
                { label: 'Open folder', onSelect: () => characters.openFolder(character.id), divided: true },
                { label: 'Duplicate', onSelect: () => void duplicate() },
                { label: 'Export…', onSelect: () => characters.exportCharacter(character.id) },
                { label: 'Delete…', onSelect: () => setConfirming(true), danger: true, divided: true }
              ]}
            />
          </>
        )}
      </header>

      <div className="tabs" role="tablist">
        {TABS.map((entry) => (
          <button key={entry.id} type="button" role="tab" className="tab" aria-selected={entry.id === tab} onClick={() => setTab(entry.id)}>
            {entry.label}
          </button>
        ))}
      </div>

      <div className="pane-body" role="tabpanel">
        {characters.error ? (
          <div className="pane-notice">
            <Notice kind="bad" lead={characters.errorLead} onDismiss={characters.dismissError}>
              {characters.error}
            </Notice>
          </div>
        ) : null}
        {tab === 'general' ? (
          <GeneralTab character={character} onChange={characters.update} />
        ) : tab === 'appearance' ? (
          <AppearanceTab character={character} characters={characters} />
        ) : tab === 'layout' ? (
          <LayoutTab character={character} characters={characters} />
        ) : tab === 'behaviour' ? (
          <BehaviourTab character={character} characters={characters} />
        ) : tab === 'lines' ? (
          <LinesTab character={character} characters={characters} />
        ) : tab === 'audio' ? (
          <AudioTab character={character} characters={characters} />
        ) : (
          <ActivityTab character={character} />
        )}
      </div>
    </>
  );
}

function BrokenPane({ id, error, characters }: { id: string; error: string; characters: Characters }): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="blank">
      <h1>This character cannot be read</h1>
      <p>{error}</p>
      <p>Its files are still in its folder. Fix character.json there, or delete the character.</p>
      <div className="blank-actions">
        <button type="button" className="button" onClick={() => characters.openFolder(id)}>
          Open folder
        </button>
        {confirming ? (
          <>
            <button type="button" className="button danger armed" onClick={() => void characters.remove(id)}>
              Delete it and its files
            </button>
            <button type="button" className="button" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </>
        ) : (
          <button type="button" className="button danger" onClick={() => setConfirming(true)}>
            Delete…
          </button>
        )}
      </div>
    </div>
  );
}
