import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import type { Character } from '@shared/character';
import type { Rule, RuleAction, RuleCondition, Trigger } from '@shared/rules';
import {
  ACTION_LABELS,
  CONDITION_LABELS,
  defaultAction,
  defaultCondition,
  defaultTrigger,
  newRule,
  ruleDetail,
  ruleProblems,
  ruleSentence,
  TRIGGER_LABELS
} from '@shared/ruleText';
import { ClockInput, Field, Notice, NumberInput, Segmented, Select, TextInput } from './fields';
import type { Characters } from './useCharacters';

const PROGRAMS_LIST = 'running-programs';
const MAX_CONDITIONS = 16;
const MAX_ACTIONS = 16;

const programProblem = (text: string): string | null => (text.trim() === '' ? "A program's file name, like dota2.exe." : null);

/** What the character does, and when: a list of rules, one open at a time. */
export default function BehaviourTab({ character, characters }: { character: Character; characters: Characters }): JSX.Element {
  const { id, rules } = character;
  const [openId, setOpenId] = useState<string | null>(null);
  const [assets, setAssets] = useState<Set<string> | undefined>(undefined);
  const [programs, setPrograms] = useState<string[] | null>(null);

  const loadAssets = useCallback((): void => {
    void window.shardEditor?.assets({ id }).then((list) => setAssets(new Set(list.map((entry) => entry.file))));
  }, [id]);
  useEffect(loadAssets, [loadAssets]);

  // What is running is asked once, when a rule is first opened — never watched.
  useEffect(() => {
    if (openId === null || programs !== null) return;
    void window.shardEditor?.runningPrograms().then(setPrograms);
  }, [openId, programs]);

  const add = (): void => {
    const rule = newRule(character);
    characters.update({ ...character, rules: [...rules, rule] });
    setOpenId(rule.id);
  };

  if (rules.length === 0) {
    return (
      <div className="blank">
        <h1>No rules yet</h1>
        <p>A rule says when the character does something: when a program starts, at a time of day, when it is clicked.</p>
        <button type="button" className="button primary" onClick={add}>
          Add a rule
        </button>
      </div>
    );
  }

  return (
    <div className="behaviour">
      <datalist id={PROGRAMS_LIST}>
        {programs?.map((program) => <option key={program} value={program} />)}
      </datalist>
      <div className="rules">
        {rules.map((rule) => (
          <RuleItem
            key={rule.id}
            character={character}
            characters={characters}
            rule={rule}
            assets={assets}
            open={rule.id === openId}
            onToggle={() => setOpenId(rule.id === openId ? null : rule.id)}
            onAssetsChanged={loadAssets}
          />
        ))}
      </div>
      <button type="button" className="button primary rules-add" onClick={add}>
        Add a rule
      </button>
    </div>
  );
}

interface RuleItemProps {
  character: Character;
  characters: Characters;
  rule: Rule;
  assets: Set<string> | undefined;
  open: boolean;
  onToggle: () => void;
  onAssetsChanged: () => void;
}

function RuleItem({ character, characters, rule, assets, open, onToggle, onAssetsChanged }: RuleItemProps): JSX.Element {
  const checkId = useId();
  const problems = ruleProblems(character, rule, assets);
  const detail = ruleDetail(rule);

  const setRule = (next: Rule): void => characters.update({ ...character, rules: character.rules.map((entry) => (entry.id === rule.id ? next : entry)) });

  return (
    <div className="rule" data-open={open} data-enabled={rule.enabled}>
      <div className="rule-row">
        <div className="checkbox">
          <label htmlFor={checkId}>
            <input id={checkId} type="checkbox" checked={rule.enabled} onChange={(event) => setRule({ ...rule, enabled: event.target.checked })} />
            <span className="checkbox-box" aria-hidden="true" />
            <span className="visually-hidden">Rule on</span>
          </label>
        </div>
        <button type="button" className="rule-summary" aria-expanded={open} onClick={onToggle}>
          <span className="rule-text">
            {rule.name.trim() ? <span className="rule-name">{rule.name.trim()}</span> : null}
            <span className="rule-sentence">
              {ruleSentence(rule).map((part, index) => (part.strong ? <b key={index}>{part.text}</b> : <span key={index}>{part.text}</span>))}
            </span>
            {problems.map((problem) => (
              <span key={problem} className="rule-problem">
                {problem}
              </span>
            ))}
          </span>
          {detail ? <span className="rule-detail">{detail}</span> : null}
        </button>
      </div>
      {open ? <RuleEditor character={character} characters={characters} rule={rule} setRule={setRule} onAssetsChanged={onAssetsChanged} /> : null}
    </div>
  );
}

interface RuleEditorProps {
  character: Character;
  characters: Characters;
  rule: Rule;
  setRule: (rule: Rule) => void;
  onAssetsChanged: () => void;
}

function RuleEditor({ character, characters, rule, setRule, onAssetsChanged }: RuleEditorProps): JSX.Element {
  const { id } = character;
  const [confirming, setConfirming] = useState(false);
  const [testProblem, setTestProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const withRule = (patch: Partial<Rule>): void => setRule({ ...rule, ...patch });

  /** Saves the rule with a file let go: the file goes once nothing else plays it. */
  const saveReleasing = async (next: Rule, released: (string | undefined)[]): Promise<void> => {
    const ok = await characters.save({ ...character, rules: character.rules.map((entry) => (entry.id === rule.id ? next : entry)) });
    if (!ok) return;
    const kept = new Set(next.then.flatMap((action) => (action.type === 'sound' ? [action.file] : [])));
    for (const file of new Set(released)) if (file && !kept.has(file)) await window.shardEditor?.releaseAsset({ id, file });
    onAssetsChanged();
  };

  /** A sound picked for action `index` — a new action when `index` is the end of the list. */
  const chooseSound = async (index: number): Promise<void> => {
    const api = window.shardEditor;
    if (!api) return;
    setBusy(true);
    try {
      const imported = await api.importAsset({ id, kinds: ['audio'] });
      if (!imported.ok) {
        if (imported.error) characters.report(imported.error);
        return;
      }
      const old = rule.then[index];
      const then = [...rule.then];
      then[index] = { type: 'sound', file: imported.file };
      const saved = await characters.save({ ...character, rules: character.rules.map((entry) => (entry.id === rule.id ? { ...rule, then } : entry)) });
      if (!saved) {
        await api.releaseAsset({ id, file: imported.file });
        return;
      }
      if (old?.type === 'sound' && old.file !== imported.file) await api.releaseAsset({ id, file: old.file });
      onAssetsChanged();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    const ok = await characters.save({ ...character, rules: character.rules.filter((entry) => entry.id !== rule.id) });
    if (!ok) return;
    for (const action of rule.then) if (action.type === 'sound') await window.shardEditor?.releaseAsset({ id, file: action.file });
    onAssetsChanged();
  };

  const test = async (): Promise<void> => {
    const result = await window.shardEditor?.testRule({ id, rule: rule.id });
    setTestProblem(result && !result.ok ? result.error : null);
  };

  const setCondition = (index: number, condition: RuleCondition): void => withRule({ if: rule.if.map((entry, i) => (i === index ? condition : entry)) });
  const setAction = (index: number, action: RuleAction): void => {
    const old = rule.then[index];
    const next = { ...rule, then: rule.then.map((entry, i) => (i === index ? action : entry)) };
    if (old?.type === 'sound') void saveReleasing(next, [old.file]);
    else setRule(next);
  };
  const removeAction = (index: number): void => {
    const old = rule.then[index];
    const next = { ...rule, then: rule.then.filter((_, i) => i !== index) };
    if (old?.type === 'sound') void saveReleasing(next, [old.file]);
    else setRule(next);
  };

  const sayDefault = defaultAction('say', character);

  return (
    <div className="rule-editor">
      <Field label="Name" hint="Optional. Shown wherever the rule is mentioned.">
        <TextInput
          className="rule-name-input"
          label="Rule name"
          value={rule.name}
          maxLength={80}
          placeholder="Greeting"
          onCommit={(name) => withRule({ name })}
        />
      </Field>

      <Block title="When">
        <TriggerEditor character={character} trigger={rule.when} onChange={(when) => withRule({ when })} />
      </Block>

      <Block title="Only if">
        {rule.if.length === 0 ? <div className="rule-none">Always — nothing has to be true as well.</div> : null}
        {rule.if.map((condition, index) => (
          <Part key={index} onRemove={() => withRule({ if: rule.if.filter((_, i) => i !== index) })} removeLabel="Remove condition">
            <ConditionEditor character={character} condition={condition} onChange={(next) => setCondition(index, next)} />
          </Part>
        ))}
        {rule.if.length < MAX_CONDITIONS ? (
          <button type="button" className="button quiet rule-more" onClick={() => withRule({ if: [...rule.if, defaultCondition('chance', character)] })}>
            + Add a condition
          </button>
        ) : null}
      </Block>

      <Block title="Then">
        {rule.then.map((action, index) => (
          <Part key={index} onRemove={rule.then.length > 1 ? () => removeAction(index) : undefined} removeLabel="Remove action">
            <ActionEditor
              character={character}
              action={action}
              busy={busy}
              onChange={(next) => setAction(index, next)}
              onChooseSound={() => void chooseSound(index)}
            />
          </Part>
        ))}
        {rule.then.length < MAX_ACTIONS ? (
          <button
            type="button"
            className="button quiet rule-more"
            onClick={() => withRule({ then: [...rule.then, sayDefault ?? { type: 'show', seconds: 10 }] })}
          >
            + Add an action
          </button>
        ) : null}
      </Block>

      <Block title="Wait at least">
        <CooldownEditor seconds={rule.cooldownSec} onChange={(cooldownSec) => withRule({ cooldownSec })} />
      </Block>

      {testProblem ? (
        <Notice kind="bad" lead="Not done." onDismiss={() => setTestProblem(null)}>
          {testProblem}
        </Notice>
      ) : null}

      <div className="rule-foot">
        {confirming ? (
          <>
            <button type="button" className="button danger armed" onClick={() => void remove()}>
              Delete the rule
            </button>
            <button type="button" className="button" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </>
        ) : (
          <>
            <button type="button" className="button" onClick={() => void test()}>
              Test now
            </button>
            <button type="button" className="button danger" onClick={() => setConfirming(true)}>
              Delete rule…
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="rule-block">
      <h3 className="rule-block-title">{title}</h3>
      {children}
    </section>
  );
}

/** One condition or action: its controls, and a way to take it out. */
function Part({ children, onRemove, removeLabel }: { children: ReactNode; onRemove?: () => void; removeLabel: string }): JSX.Element {
  return (
    <div className="rule-part">
      <div className="rule-part-fields">{children}</div>
      {onRemove ? (
        <button type="button" className="tag-remove" aria-label={removeLabel} onClick={onRemove}>
          ×
        </button>
      ) : null}
    </div>
  );
}

function ProgramInput({ value, onChange, autoFocus }: { value: string; onChange: (program: string) => void; autoFocus?: boolean }): JSX.Element {
  return (
    <span className="rule-program">
      <TextInput
        label="Program"
        value={value}
        maxLength={260}
        list={PROGRAMS_LIST}
        placeholder="dota2.exe"
        validate={programProblem}
        autoFocus={autoFocus}
        onCommit={(text) => onChange(text.trim())}
      />
    </span>
  );
}

const TRIGGER_OPTIONS = (Object.keys(TRIGGER_LABELS) as Trigger['type'][]).map((value) => ({ value, label: TRIGGER_LABELS[value] }));

function TriggerEditor({ character, trigger, onChange }: { character: Character; trigger: Trigger; onChange: (trigger: Trigger) => void }): JSX.Element {
  // Just switched to a program trigger: its program is what to type next.
  const [picked, setPicked] = useState(false);
  const pick = (type: Trigger['type']): void => {
    if (type === trigger.type) return;
    const next = defaultTrigger(type, character);
    // From one program trigger to another, the program stays.
    onChange('program' in next && 'program' in trigger ? { ...next, program: trigger.program } : next);
    setPicked(true);
  };
  return (
    <div className="rule-fields">
      <Select label="When" value={trigger.type} options={TRIGGER_OPTIONS} onChange={pick} />
      {trigger.type === 'programStarted' || trigger.type === 'programStopped' || trigger.type === 'programFocused' ? (
        <ProgramInput value={trigger.program} autoFocus={picked} onChange={(program) => onChange({ ...trigger, program })} />
      ) : trigger.type === 'time' ? (
        <ClockInput label="At" value={trigger.at} onChange={(at) => onChange({ ...trigger, at })} />
      ) : trigger.type === 'every' ? (
        <>
          <span className="rule-word">from</span>
          <span className="rule-number">
            <NumberInput
              label="Shortest wait"
              value={trigger.minMinutes}
              min={1}
              max={1440}
              unit="min"
              onCommit={(minMinutes) => onChange({ ...trigger, minMinutes, maxMinutes: Math.max(minMinutes, trigger.maxMinutes) })}
            />
          </span>
          <span className="rule-word">to</span>
          <span className="rule-number">
            <NumberInput
              label="Longest wait"
              value={trigger.maxMinutes}
              min={1}
              max={1440}
              unit="min"
              onCommit={(maxMinutes) => onChange({ ...trigger, maxMinutes, minMinutes: Math.min(maxMinutes, trigger.minMinutes) })}
            />
          </span>
        </>
      ) : trigger.type === 'returned' ? (
        <>
          <span className="rule-word">after at least</span>
          <span className="rule-number">
            <NumberInput label="Away for" value={trigger.afterMinutes} min={1} max={1440} unit="min" onCommit={(afterMinutes) => onChange({ ...trigger, afterMinutes })} />
          </span>
          <span className="rule-word">away</span>
        </>
      ) : null}
    </div>
  );
}

const CONDITION_OPTIONS = (Object.keys(CONDITION_LABELS) as RuleCondition['type'][]).map((value) => ({ value, label: CONDITION_LABELS[value] }));

function ConditionEditor({ character, condition, onChange }: { character: Character; condition: RuleCondition; onChange: (condition: RuleCondition) => void }): JSX.Element {
  return (
    <div className="rule-fields">
      <Select label="Condition" value={condition.type} options={CONDITION_OPTIONS} onChange={(type) => type !== condition.type && onChange(defaultCondition(type, character))} />
      {condition.type === 'chance' ? (
        <span className="rule-number">
          <NumberInput label="Chance" value={condition.percent} min={0} max={100} unit="%" onCommit={(percent) => onChange({ ...condition, percent })} />
        </span>
      ) : condition.type === 'timeBetween' ? (
        <>
          <ClockInput label="From" value={condition.from} onChange={(from) => onChange({ ...condition, from })} />
          <span className="rule-word">to</span>
          <ClockInput label="To" value={condition.to} onChange={(to) => onChange({ ...condition, to })} />
        </>
      ) : (
        <>
          <ProgramInput value={condition.program} onChange={(program) => onChange({ ...condition, program })} />
          <Segmented<'yes' | 'no'>
            label="Running"
            value={condition.running ? 'yes' : 'no'}
            options={[
              { value: 'yes', label: 'runs' },
              { value: 'no', label: 'does not run' }
            ]}
            onChange={(value) => onChange({ ...condition, running: value === 'yes' })}
          />
        </>
      )}
    </div>
  );
}

interface ActionEditorProps {
  character: Character;
  action: RuleAction;
  busy: boolean;
  onChange: (action: RuleAction) => void;
  onChooseSound: () => void;
}

function ActionEditor({ character, action, busy, onChange, onChooseSound }: ActionEditorProps): JSX.Element {
  const groups = Object.keys(character.lines);
  // A line can be picked only once there are groups; a sound only by choosing its file.
  const options = (Object.keys(ACTION_LABELS) as RuleAction['type'][])
    .filter((type) => type !== 'say' || groups.length > 0 || action.type === 'say')
    .map((value) => ({ value, label: ACTION_LABELS[value] }));

  const pick = (type: RuleAction['type']): void => {
    if (type === action.type) return;
    if (type === 'sound') return onChooseSound();
    const next = defaultAction(type, character);
    if (next) onChange(next);
  };

  return (
    <div className="rule-fields">
      <Select label="Action" value={action.type} options={options} onChange={pick} />
      {action.type === 'say' ? (
        <>
          <span className="rule-word">from</span>
          <Select
            label="Group of lines"
            value={action.group}
            options={[...(groups.includes(action.group) ? [] : [{ value: action.group, label: `${action.group} (missing)` }]), ...groups.map((group) => ({ value: group, label: group }))]}
            onChange={(group) => onChange({ ...action, group })}
          />
        </>
      ) : action.type === 'sound' ? (
        <>
          <span className="rule-file" title={action.file}>
            {action.file}
          </span>
          <button type="button" className="button quiet" disabled={busy} onClick={onChooseSound}>
            {busy ? 'Copying…' : 'Replace'}
          </button>
        </>
      ) : action.type === 'show' ? (
        <>
          <span className="rule-word">for</span>
          <span className="rule-number">
            <NumberInput label="Seconds" value={action.seconds} min={1} max={3600} unit="s" onCommit={(seconds) => onChange({ ...action, seconds })} />
          </span>
        </>
      ) : (
        <>
          <span className="rule-word">for</span>
          <span className="rule-number">
            <NumberInput label="Minutes" value={action.minutes} min={1} max={1440} unit="min" onCommit={(minutes) => onChange({ ...action, minutes })} />
          </span>
        </>
      )}
    </div>
  );
}

const UNITS = [
  { value: 's', label: 'seconds', seconds: 1 },
  { value: 'min', label: 'minutes', seconds: 60 },
  { value: 'h', label: 'hours', seconds: 3600 }
] as const;
type Unit = (typeof UNITS)[number]['value'];
const MAX_COOLDOWN = 7 * 24 * 3600;

/** The largest unit the value is a whole number of. */
const unitFor = (seconds: number): Unit => (seconds > 0 && seconds % 3600 === 0 ? 'h' : seconds > 0 && seconds % 60 === 0 ? 'min' : seconds === 0 ? 'min' : 's');

function CooldownEditor({ seconds, onChange }: { seconds: number; onChange: (seconds: number) => void }): JSX.Element {
  const [unit, setUnit] = useState<Unit>(() => unitFor(seconds));
  const size = UNITS.find((entry) => entry.value === unit)?.seconds ?? 60;
  const value = Math.round((seconds / size) * 100) / 100;
  return (
    <div className="rule-fields">
      <span className="rule-number">
        <NumberInput label="Wait" value={value} min={0} max={MAX_COOLDOWN / size} onCommit={(next) => onChange(Math.round(next * size))} />
      </span>
      <Select<Unit>
        label="Unit"
        value={unit}
        options={UNITS.map((entry) => ({ value: entry.value, label: entry.label }))}
        onChange={(next) => {
          setUnit(next);
          const nextSize = UNITS.find((entry) => entry.value === next)?.seconds ?? 60;
          // The number stays; it now counts something else.
          onChange(Math.min(MAX_COOLDOWN, Math.round(value * nextSize)));
        }}
      />
      <span className="rule-word">before it can happen again. 0 lets it happen every time.</span>
    </div>
  );
}
