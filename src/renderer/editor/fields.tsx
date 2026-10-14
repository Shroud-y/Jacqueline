import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';

/* Every piece the editor's forms are made of — docs/DESIGN.md §4. */

/** A label above its control, and one line under it: the hint, or what is wrong. */
export function Field({ label, hint, problem, children }: { label?: string; hint?: string; problem?: string | null; children: ReactNode }): JSX.Element {
  return (
    <div className="field">
      {label ? <div className="field-label">{label}</div> : null}
      {children}
      {problem ? <div className="field-problem">{problem}</div> : hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  );
}

/** A group of fields under a title. Groups are told apart by space, not lines. */
export function Group({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="group">
      <h2 className="group-title">{title}</h2>
      {children}
    </section>
  );
}

interface TextInputProps {
  value: string;
  /** Called only with values `validate` accepts. */
  onCommit: (value: string) => void;
  /** A reason the value cannot be kept, or null. */
  validate?: (value: string) => string | null;
  /** Told what is wrong with the text in the box right now, so the caller can show it. */
  onProblem?: (problem: string | null) => void;
  placeholder?: string;
  maxLength?: number;
  label: string;
  className?: string;
}

/**
 * A text box that saves as it is typed in, but only what is valid. What is
 * not stays in the box and is put back to the last good value when the box is
 * left — nothing invalid ever reaches the file.
 */
export function TextInput({ value, onCommit, validate, onProblem, placeholder, maxLength, label, className }: TextInputProps): JSX.Element {
  // What is being typed, while it is being typed; otherwise the box simply
  // shows the saved value, so a change made elsewhere turns up in it.
  const [typed, setTyped] = useState<string | null>(null);
  const text = typed ?? value;
  const problem = validate ? validate(text) : null;

  return (
    <input
      className={className ? `input ${className}` : 'input'}
      type="text"
      aria-label={label}
      aria-invalid={problem !== null}
      value={text}
      placeholder={placeholder}
      maxLength={maxLength}
      onFocus={() => setTyped(value)}
      // Leaving the box drops whatever was not good enough to save.
      onBlur={() => {
        setTyped(null);
        onProblem?.(null);
      }}
      onChange={(event) => {
        const next = event.target.value;
        setTyped(next);
        const reason = validate ? validate(next) : null;
        onProblem?.(reason);
        if (reason === null) onCommit(next);
      }}
    />
  );
}

/** The one switch in the app: a character on or off, with the word beside it. */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }): JSX.Element {
  const id = useId();
  return (
    <label className="switch" htmlFor={id}>
      <input id={id} type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="switch-track" aria-hidden="true" />
      <span className="switch-text">{checked ? 'On' : 'Off'}</span>
    </label>
  );
}

/** Every other yes or no. */
export function Checkbox({ checked, onChange, label, hint }: { checked: boolean; onChange: (checked: boolean) => void; label: string; hint?: string }): JSX.Element {
  const id = useId();
  return (
    <div className="checkbox">
      <label htmlFor={id}>
        <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
        <span className="checkbox-box" aria-hidden="true" />
        <span>{label}</span>
      </label>
      {hint ? <div className="field-hint checkbox-hint">{hint}</div> : null}
    </div>
  );
}

interface OptionListProps<T extends string> {
  value: T;
  options: { value: T; label: string; hint: string; disabled?: boolean }[];
  onChange: (value: T) => void;
  name: string;
}

/** Exclusive choices, each with a line saying what it means. No boxes. */
export function OptionList<T extends string>({ value, options, onChange, name }: OptionListProps<T>): JSX.Element {
  return (
    <div className="options" role="radiogroup" aria-label={name}>
      {options.map((option) => (
        <label key={option.value} className="option" data-selected={option.value === value} data-disabled={option.disabled === true}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            disabled={option.disabled}
            onChange={() => onChange(option.value)}
          />
          <span className="option-mark" aria-hidden="true" />
          <span className="option-text">
            <span className="option-label">{option.label}</span>
            <span className="option-hint">{option.hint}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

interface TagListProps {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  label: string;
  /** Two entries that mean the same thing are kept as one. */
  keyOf: (value: string) => string;
}

/** Short strings in one box: type one and press Enter; Backspace in the empty box takes the last one off. */
export function TagList({ values, onChange, placeholder, label, keyOf }: TagListProps): JSX.Element {
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const add = (): void => {
    const value = text.trim();
    if (value === '') return;
    setText('');
    if (values.some((existing) => keyOf(existing) === keyOf(value))) return;
    onChange([...values, value]);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      add();
    } else if (event.key === 'Backspace' && text === '' && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    // A click anywhere in the box is a click in the text field.
    <div className="tags" onClick={() => input.current?.focus()}>
      {values.map((value) => (
        <span key={value} className="tag">
          {value}
          <button
            type="button"
            className="tag-remove"
            aria-label={`Remove ${value}`}
            onClick={(event) => {
              event.stopPropagation();
              onChange(values.filter((existing) => existing !== value));
            }}
          >
            ×
          </button>
        </span>
      ))}
      <input
        ref={input}
        className="tags-input"
        type="text"
        aria-label={label}
        value={text}
        placeholder={values.length === 0 ? placeholder : ''}
        maxLength={260}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={add}
      />
    </div>
  );
}

/** A line of text with a bar beside it. Never a coloured box. */
export function Notice({ kind, lead, children, onDismiss }: { kind: 'warn' | 'bad'; lead?: string; children: ReactNode; onDismiss?: () => void }): JSX.Element {
  return (
    <div className="notice" data-kind={kind} role={kind === 'bad' ? 'alert' : undefined}>
      <span className="notice-text">
        {lead ? <b>{lead} </b> : null}
        {children}
      </span>
      {onDismiss ? (
        <button type="button" className="notice-close" aria-label="Dismiss" onClick={onDismiss}>
          ×
        </button>
      ) : null}
    </div>
  );
}

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  /** A line above this item. */
  divided?: boolean;
}

/** The "···" button and what it opens. Closes on a choice, Escape, or a click anywhere else. */
export function MoreMenu({ items, label }: { items: MenuItem[]; label: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="more" ref={root}>
      <button type="button" className="button quiet more-button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        ···
      </button>
      {open ? (
        <div className="menu" role="menu">
          {items.map((item) => (
            <div key={item.label}>
              {item.divided ? <hr /> : null}
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                data-danger={item.danger === true}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface NumberInputProps {
  value: number;
  onCommit: (value: number) => void;
  min: number;
  max: number;
  /** Shown inside the box on the right: "px", "s", "%". */
  unit?: string;
  label: string;
}

/**
 * A number that saves as it is typed, as long as it is one and in range. The
 * arrow keys step by 1 (10 with Shift); so does the wheel, while the box has
 * focus. Left with something that is not a usable number, it goes back.
 */
export function NumberInput({ value, onCommit, min, max, unit, label }: NumberInputProps): JSX.Element {
  const [typed, setTyped] = useState<string | null>(null);
  const text = typed ?? String(value);
  const parsed = Number(text.replace(',', '.'));
  const valid = text.trim() !== '' && Number.isFinite(parsed) && parsed >= min && parsed <= max;

  const step = (delta: number): void => {
    const base = valid ? parsed : value;
    const next = Math.min(max, Math.max(min, Math.round((base + delta) * 100) / 100));
    setTyped(String(next));
    onCommit(next);
  };

  return (
    <span className="number">
      <input
        className="input"
        type="text"
        inputMode="decimal"
        aria-label={label}
        aria-invalid={!valid}
        value={text}
        onFocus={() => setTyped(String(value))}
        onBlur={() => setTyped(null)}
        onChange={(event) => {
          const next = event.target.value;
          setTyped(next);
          const number = Number(next.replace(',', '.'));
          if (next.trim() !== '' && Number.isFinite(number) && number >= min && number <= max) onCommit(number);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          step((event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 10 : 1));
        }}
        onWheel={(event) => {
          if (document.activeElement !== event.currentTarget) return;
          step(event.deltaY < 0 ? 1 : -1);
        }}
      />
      {unit ? <span className="number-unit">{unit}</span> : null}
    </span>
  );
}

/** How often a slider being dragged saves. The character on screen follows at this rate. */
const SLIDER_SAVE_MS = 120;

/**
 * A slider with the number beside it. While it is dragged the value is saved
 * a few times a second, not on every pixel: each save is a file write and a
 * redraw of the character on the desktop.
 */
export function Slider({ value, onCommit, min, max, unit, label }: NumberInputProps): JSX.Element {
  const [dragged, setDragged] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(value);
  const shown = dragged ?? value;

  const flush = (): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    onCommit(latest.current);
  };

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const release = (): void => {
    if (dragged === null) return;
    flush();
    setDragged(null);
  };

  return (
    <div className="slider">
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        value={shown}
        style={{ '--fill': `${((shown - min) / (max - min)) * 100}%` } as CSSProperties}
        onChange={(event) => {
          const next = Number(event.target.value);
          latest.current = next;
          setDragged(next);
          timer.current ??= setTimeout(flush, SLIDER_SAVE_MS);
        }}
        onPointerUp={release}
        onKeyUp={release}
        onBlur={release}
      />
      <NumberInput label={label} value={shown} min={min} max={max} unit={unit} onCommit={onCommit} />
    </div>
  );
}

/** Two to four short, exclusive choices side by side. */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}): JSX.Element {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className="segment"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** A dropdown, as the system draws its list, dressed like the rest. */
export function Select<T extends string>({
  value,
  options,
  onChange,
  label
}: {
  value: T;
  options: { value: T; label: string; group?: string }[];
  onChange: (value: T) => void;
  label: string;
}): JSX.Element {
  const groups = [...new Set(options.map((option) => option.group ?? ''))];
  const render = (option: { value: T; label: string }): JSX.Element => (
    <option key={option.value} value={option.value}>
      {option.label}
    </option>
  );
  return (
    <span className="select">
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value as T)}>
        {groups.length === 1
          ? options.map(render)
          : groups.map((group) =>
              group === '' ? (
                options.filter((option) => !option.group).map(render)
              ) : (
                <optgroup key={group} label={group}>
                  {options.filter((option) => option.group === group).map(render)}
                </optgroup>
              )
            )}
      </select>
    </span>
  );
}

/** "#ff8800" for anything the page can read as a colour; null when it cannot. */
function toHex(color: string): string | null {
  const probe = document.createElement('canvas').getContext('2d');
  if (!probe || !CSS.supports('color', color)) return null;
  probe.fillStyle = '#000';
  probe.fillStyle = color;
  const value = probe.fillStyle;
  return value.startsWith('#') ? value : null;
}

/**
 * A colour: a swatch that opens the system picker, and the value as text for
 * anything the picker cannot say — `rgba(0, 0, 0, .6)` keeps its see-through.
 */
export function ColorField({ value, onCommit, label }: { value: string; onCommit: (value: string) => void; label: string }): JSX.Element {
  const hex = toHex(value);
  return (
    <span className="color">
      <label className="color-swatch" style={{ background: value }}>
        <input type="color" aria-label={`${label} — pick`} value={hex ?? '#000000'} onChange={(event) => onCommit(event.target.value)} />
      </label>
      <TextInput
        label={label}
        className="color-text"
        value={value}
        maxLength={64}
        validate={(text) => (CSS.supports('color', text.trim()) ? null : 'Not a colour.')}
        onCommit={(text) => onCommit(text.trim())}
      />
    </span>
  );
}

/** A titled part of an inspector that folds away. */
export function Fold({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="fold" data-open={open}>
      <button type="button" className="fold-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="fold-mark" aria-hidden="true" />
        {title}
      </button>
      {open ? <div className="fold-body">{children}</div> : null}
    </section>
  );
}
