import { useCallback, useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import type { AssetKind, Character, Line } from '@shared/character';
import {
  addGroup,
  addLine,
  freeGroupName,
  groupNameProblem,
  LINE_TEXT_MAX,
  LINES_PER_GROUP_MAX,
  removeGroup,
  removeLine,
  renameGroup,
  rulesUsing,
  SLOTS,
  splitSlots,
  unknownSlots,
  updateLine
} from '@shared/lines';
import { ruleTitle } from '@shared/ruleText';
import { Notice, NumberInput, TextInput } from './fields';
import type { Characters } from './useCharacters';

const SOUND_KINDS: AssetKind[] = ['audio'];

/** What the character says: groups of lines on the left, the chosen group's lines on the right. */
export default function LinesTab({ character, characters }: { character: Character; characters: Characters }): JSX.Element {
  const groups = Object.keys(character.lines);
  const [chosen, setChosen] = useState<string | null>(null);
  // Changes when another group is opened, not when this one is renamed: the
  // pane must survive its name being typed.
  const [opened, setOpened] = useState(0);
  const open = (name: string): void => {
    setChosen(name);
    setOpened((n) => n + 1);
  };
  // Something is always chosen while there is anything to choose.
  const group = chosen !== null && chosen in character.lines ? chosen : (groups[0] ?? null);

  const newGroup = (): void => {
    const name = freeGroupName(character);
    characters.update(addGroup(character, name));
    open(name);
  };

  if (group === null) {
    return (
      <div className="blank">
        <h1>No lines yet</h1>
        <p>Lines are what the character says. They come in groups: a rule picks a group, and one line from it is said.</p>
        <button type="button" className="button primary" onClick={newGroup}>
          Add a group of lines
        </button>
      </div>
    );
  }

  return (
    <div className="lines">
      <nav className="groups" aria-label="Groups of lines">
        {groups.map((name) => (
          <button key={name} type="button" className="group-item" aria-current={name === group} onClick={() => name !== group && open(name)}>
            <span className="group-name">{name}</span>
            <span className="group-count">{character.lines[name]?.length ?? 0}</span>
          </button>
        ))}
        <button type="button" className="button quiet groups-new" onClick={newGroup}>
          + New group
        </button>
      </nav>
      {/* Keyed: a half-typed new line belongs to the group it was typed in. */}
      <GroupPane key={opened} character={character} characters={characters} group={group} onRenamed={setChosen} />
    </div>
  );
}

interface GroupPaneProps {
  character: Character;
  characters: Characters;
  group: string;
  onRenamed: (name: string) => void;
}

function GroupPane({ character, characters, group, onRenamed }: GroupPaneProps): JSX.Element {
  const { id } = character;
  const lines = character.lines[group] ?? [];
  const [nameProblem, setNameProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState('');
  const [testProblem, setTestProblem] = useState<string | null>(null);
  const [busySound, setBusySound] = useState<string | null>(null);
  const users = rulesUsing(character, group);
  const full = lines.length >= LINES_PER_GROUP_MAX;

  const rename = (name: string): void => {
    const next = name.trim();
    characters.update(renameGroup(character, group, next));
    onRenamed(next);
  };

  const remove = async (): Promise<void> => {
    const sounds = lines.flatMap((line) => (line.audio ? [line.audio] : []));
    if (!(await characters.save(removeGroup(character, group)))) return;
    for (const file of new Set(sounds)) await window.shardEditor?.releaseAsset({ id, file });
  };

  const add = (): void => {
    const text = draft.trim();
    if (text === '' || full) return;
    characters.update(addLine(character, group, text));
    setDraft('');
  };

  /** A sound for a line; the one it had goes once nothing else plays it. */
  const chooseSound = async (line: Line, path?: string): Promise<void> => {
    const api = window.shardEditor;
    if (!api) return;
    setBusySound(line.id);
    try {
      const imported = await api.importAsset({ id, kinds: SOUND_KINDS, ...(path ? { path } : {}) });
      if (!imported.ok) {
        if (imported.error) characters.report(imported.error);
        return;
      }
      if (await characters.save(updateLine(character, group, line.id, { audio: imported.file }))) {
        if (line.audio && line.audio !== imported.file) await api.releaseAsset({ id, file: line.audio });
      } else {
        await api.releaseAsset({ id, file: imported.file });
      }
    } finally {
      setBusySound(null);
    }
  };

  const removeSound = async (line: Line): Promise<void> => {
    if (!line.audio) return;
    if (await characters.save(updateLine(character, group, line.id, { audio: undefined }))) {
      await window.shardEditor?.releaseAsset({ id, file: line.audio });
    }
  };

  const deleteLine = async (line: Line): Promise<void> => {
    if (!(await characters.save(removeLine(character, group, line.id)))) return;
    if (line.audio) await window.shardEditor?.releaseAsset({ id, file: line.audio });
  };

  const test = async (line: Line): Promise<void> => {
    const result = await window.shardEditor?.testLine({ id, group, line: line.id });
    setTestProblem(result && !result.ok ? result.error : null);
  };

  return (
    <section className="group-pane">
      <header className="group-head">
        <div className="group-head-name">
          <TextInput
            label="Group name"
            className="group-name-input"
            value={group}
            maxLength={64}
            validate={(value) => groupNameProblem(character, value, group)}
            onProblem={setNameProblem}
            onCommit={rename}
          />
          {nameProblem ? <div className="field-problem">{nameProblem}</div> : null}
        </div>
        {confirming ? null : (
          <button type="button" className="button danger" onClick={() => setConfirming(true)}>
            Delete group…
          </button>
        )}
      </header>

      {confirming ? (
        <div className="group-confirm">
          {users.length > 0 ? (
            <Notice kind="warn">
              {users.length === 1 ? 'A rule says' : `${users.length} rules say`} something from this group:{' '}
              {users.map(ruleTitle).join('; ')}. Without it, {users.length === 1 ? 'it has' : 'they have'} nothing to say.
            </Notice>
          ) : null}
          <div className="confirm">
            <button type="button" className="button danger armed" onClick={() => void remove()}>
              Delete the group and its {lines.length === 1 ? 'line' : `${lines.length} lines`}
            </button>
            <button type="button" className="button" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </div>
        </div>
      ) : (
        <div className="group-users">
          {users.length === 0
            ? 'No rule says anything from this group yet.'
            : `Said by: ${users.map(ruleTitle).join('; ')}.`}
        </div>
      )}

      {testProblem ? (
        <Notice kind="bad" lead="Not said." onDismiss={() => setTestProblem(null)}>
          {testProblem}
        </Notice>
      ) : null}

      <div className="line-table" role="table" aria-label={`Lines in ${group}`}>
        <div className="line-row line-head" role="row">
          <span role="columnheader">Line</span>
          <span role="columnheader">Weight</span>
          <span role="columnheader">Sound</span>
          <span role="columnheader" className="visually-hidden">
            Actions
          </span>
        </div>
        {lines.map((line) => (
          <LineRow
            key={line.id}
            line={line}
            busy={busySound === line.id}
            onText={(text) => characters.update(updateLine(character, group, line.id, { text }))}
            onWeight={(weight) => characters.update(updateLine(character, group, line.id, { weight: weight === 1 ? undefined : weight }))}
            onChooseSound={(path) => void chooseSound(line, path)}
            onRemoveSound={() => void removeSound(line)}
            onTest={() => void test(line)}
            onDelete={() => void deleteLine(line)}
          />
        ))}
        <div className="line-new" role="row">
          <input
            className="input"
            type="text"
            aria-label="New line"
            placeholder={full ? `A group holds ${LINES_PER_GROUP_MAX} lines at most.` : 'Type a line and press Enter'}
            disabled={full}
            value={draft}
            maxLength={LINE_TEXT_MAX}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              add();
            }}
          />
        </div>
      </div>

      <div className="line-help">
        <p>
          Slots are filled in when the line is said:{' '}
          {SLOTS.map((slot, index) => (
            <span key={slot.name}>
              {index > 0 ? ', ' : ''}
              <span className="slot-token">{`{${slot.name}}`}</span> {slot.hint}
            </span>
          ))}
          . A line whose slot the moment cannot fill is skipped.
        </p>
        <p>Weight is how often a line comes up: 2 twice as often as 1, 0 never. The same line is not said twice in a row.</p>
      </div>
    </section>
  );
}

interface LineRowProps {
  line: Line;
  busy: boolean;
  onText: (text: string) => void;
  onWeight: (weight: number) => void;
  onChooseSound: (path?: string) => void;
  onRemoveSound: () => void;
  onTest: () => void;
  onDelete: () => void;
}

function LineRow({ line, busy, onText, onWeight, onChooseSound, onRemoveSound, onTest, onDelete }: LineRowProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const unknown = unknownSlots(line.text);

  return (
    <div className="line-row" role="row">
      <span role="cell" className="line-cell">
        {editing ? (
          <LineEditor
            text={line.text}
            onDone={(text) => {
              setEditing(false);
              if (text !== null && text !== line.text) onText(text);
            }}
          />
        ) : (
          <button type="button" className="line-text" aria-label={`Edit line: ${line.text}`} onClick={() => setEditing(true)}>
            {splitSlots(line.text).map((part, index) =>
              part.slot === null ? (
                part.text
              ) : (
                <span key={index} className="slot-token" data-known={part.known}>
                  {part.text}
                </span>
              )
            )}
          </button>
        )}
        {unknown.length > 0 ? (
          <span className="field-problem line-problem">
            Nothing fills {unknown.map((slot) => `{${slot}}`).join(', ')}, so this line is never said.
          </span>
        ) : null}
      </span>
      <span role="cell">
        <NumberInput label="Weight" value={line.weight ?? 1} min={0} max={100} onCommit={onWeight} />
      </span>
      <span role="cell">
        <SoundCell file={line.audio ?? null} busy={busy} onChoose={onChooseSound} onRemove={onRemoveSound} />
      </span>
      <span role="cell" className="line-actions">
        <button type="button" className="button quiet" onClick={onTest}>
          Test
        </button>
        <button type="button" className="tag-remove line-delete" aria-label="Delete line" onClick={onDelete}>
          ×
        </button>
      </span>
    </div>
  );
}

/** The line's text in a box: Enter or leaving keeps it, Escape puts it back. Null means unchanged. */
function LineEditor({ text, onDone }: { text: string; onDone: (text: string | null) => void }): JSX.Element {
  const [value, setValue] = useState(text);
  const done = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const finish = useCallback(
    (keep: boolean): void => {
      if (done.current) return;
      done.current = true;
      // An emptied line is not a line: it goes back to what it was.
      const trimmed = value.trim();
      onDone(keep && trimmed !== '' ? trimmed : null);
    },
    [value, onDone]
  );

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
    }
  };

  return (
    <input
      ref={input}
      className="input"
      type="text"
      aria-label="Line"
      aria-invalid={value.trim() === ''}
      value={value}
      maxLength={LINE_TEXT_MAX}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => finish(true)}
    />
  );
}

/** A line's sound: its file, or a way to give it one. A file dropped here is taken too. */
function SoundCell({ file, busy, onChoose, onRemove }: { file: string | null; busy: boolean; onChoose: (path?: string) => void; onRemove: () => void }): JSX.Element {
  const [over, setOver] = useState(false);
  const drop = {
    onDragOver: (event: DragEvent): void => {
      if (!event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (event: DragEvent): void => {
      event.preventDefault();
      setOver(false);
      const dropped = event.dataTransfer.files[0];
      const path = dropped ? window.shardEditor?.pathForFile(dropped) : '';
      if (path) onChoose(path);
    }
  };

  if (busy) return <span className="sound-cell sound-busy">Copying…</span>;
  return (
    <span className="sound-cell" data-over={over} {...drop}>
      {file ? (
        <>
          <button type="button" className="sound-name" title={`${file} — choose another`} onClick={() => onChoose()}>
            {file}
          </button>
          <button type="button" className="tag-remove" aria-label={`Remove sound ${file}`} onClick={onRemove}>
            ×
          </button>
        </>
      ) : (
        <button type="button" className="button quiet sound-add" onClick={() => onChoose()}>
          Add…
        </button>
      )}
    </span>
  );
}
