import type { Character, Presence } from '@shared/character';
import { estimateCost } from '@shared/cost';
import { Checkbox, Field, Group, Notice, OptionList, TagList } from './fields';

const LEVEL_LABEL = { light: 'Light', moderate: 'Moderate', heavy: 'Heavy' } as const;

type Mode = Presence['mode'];

/** 'Dota2.exe' and 'dota2' are the same program — as main matches them. */
const programKey = (name: string): string => {
  const lower = name.trim().toLowerCase();
  return lower.endsWith('.exe') ? lower.slice(0, -'.exe'.length) : lower;
};

const TIED: readonly Mode[] = ['whileRunning', 'whileFocused'];

/** When the character is on screen at all, and where. */
export default function GeneralTab({ character, onChange }: { character: Character; onChange: (next: Character) => void }): JSX.Element {
  const { presence } = character;
  const setPresence = (patch: Partial<Presence>): void => onChange({ ...character, presence: { ...presence, ...patch } });
  const tied = TIED.includes(presence.mode);
  const cost = estimateCost(character);

  return (
    <div className="form">
      <Group title="On screen">
        <OptionList<Mode>
          name="When it is on screen"
          value={presence.mode}
          onChange={(mode) => setPresence({ mode })}
          options={[
            { value: 'always', label: 'Always', hint: 'As long as it is switched on.' },
            { value: 'whileRunning', label: 'While a program is running', hint: 'Appears when one of the programs below starts, leaves when the last one closes.' },
            { value: 'whileFocused', label: 'While a program is in front', hint: 'Only while one of the programs below is the window you are working in.' },
            { value: 'onSpeech', label: 'Only when it speaks', hint: 'Comes out with each line and leaves when it is done. Its rules decide when that is.' }
          ]}
        />

        {tied ? (
          <Field
            label="Programs"
            hint={
              presence.apps.length === 0
                ? 'It will not appear until there is a program here. Type its file name, like dota2.exe, and press Enter.'
                : "The name of the program's file. Case and the .exe do not matter."
            }
          >
            <TagList label="Programs" values={presence.apps} onChange={(apps) => setPresence({ apps })} placeholder="Add a program…" keyOf={programKey} />
          </Field>
        ) : null}

        <Checkbox
          label="Step aside while something is fullscreen"
          hint="Only for the screen the character is on."
          checked={presence.hideOnFullscreen}
          onChange={(hideOnFullscreen) => setPresence({ hideOnFullscreen })}
        />
      </Group>

      <Group title="Place">
        <div>
          <div className="prose">
            {presence.position
              ? `At ${Math.round(presence.position.x)}, ${Math.round(presence.position.y)}. Drag the character to move it.`
              : 'In the bottom-right corner of the main screen. Drag the character to move it.'}
          </div>
          {presence.position ? (
            <button type="button" className="button quiet under-prose" onClick={() => setPresence({ position: null })}>
              Back to the corner
            </button>
          ) : null}
        </div>
      </Group>

      <Group title="What it costs">
        <div className="cost">
          <div className="cost-level">{LEVEL_LABEL[cost.level]}</div>
          <ul className="cost-items">
            {cost.items.map((item) => (
              <li key={item.text}>{item.text}</li>
            ))}
          </ul>
          {cost.level === 'heavy' ? (
            <Notice kind="warn">A rest between plays (Appearance → Motion) brings a moving character down to a fraction of this.</Notice>
          ) : null}
        </div>
      </Group>
    </div>
  );
}
