import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

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
