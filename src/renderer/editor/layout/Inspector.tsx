import { DEFAULT_TEXT_STYLE, type LayoutElement, type TextStyle } from '@shared/character';
import { FONT_WEIGHTS, SYSTEM_FONTS, isFontFile } from '@shared/textStyle';
import { Checkbox, ColorField, Field, Fold, NumberInput, Segmented, Select } from '../fields';

type TextElementType = Extract<LayoutElement, { type: 'speech' | 'name' }>;

const CHOOSE_FONT_FILE = '\u0000choose';

const LABEL: Record<LayoutElement['type'], string> = { character: 'Character', speech: 'Speech', name: 'Name' };

interface InspectorProps {
  element: LayoutElement | null;
  /** The character's own font files, by name. */
  fontFiles: string[];
  onChange: (element: LayoutElement) => void;
  onRemove: (element: LayoutElement) => void;
  onChooseFont: (element: TextElementType) => void;
}

/** Everything about the selected element, folded into sections. */
export default function Inspector({ element, fontFiles, onChange, onRemove, onChooseFont }: InspectorProps): JSX.Element {
  if (!element) {
    return (
      <aside className="inspector">
        <div className="inspector-empty">Select something on the canvas to change it here.</div>
      </aside>
    );
  }

  const box = (patch: Partial<Pick<LayoutElement, 'x' | 'y' | 'width' | 'height'>>): void => onChange({ ...element, ...patch });

  return (
    <aside className="inspector" aria-label={`${LABEL[element.type]} properties`}>
      <Fold title={LABEL[element.type]}>
        <div className="pair">
          <NumberInput label="X" unit="x" value={element.x} min={-4000} max={4000} onCommit={(x) => box({ x })} />
          <NumberInput label="Y" unit="y" value={element.y} min={-4000} max={4000} onCommit={(y) => box({ y })} />
          <NumberInput label="Width" unit="w" value={element.width} min={16} max={4000} onCommit={(width) => box({ width })} />
          <NumberInput label="Height" unit="h" value={element.height} min={16} max={4000} onCommit={(height) => box({ height })} />
        </div>
        {element.type === 'character' ? (
          <div className="field-hint">The character stays where it is on the desktop; moving it here moves everything else around it.</div>
        ) : null}
      </Fold>

      {element.type === 'character' ? null : (
        <TextSections element={element} fontFiles={fontFiles} onChange={onChange} onChooseFont={onChooseFont} />
      )}

      {element.type === 'character' ? null : (
        <div className="inspector-foot">
          <button type="button" className="button danger" onClick={() => onRemove(element)}>
            Remove {LABEL[element.type].toLowerCase()}
          </button>
        </div>
      )}
    </aside>
  );
}

function TextSections({
  element,
  fontFiles,
  onChange,
  onChooseFont
}: {
  element: TextElementType;
  fontFiles: string[];
  onChange: (element: LayoutElement) => void;
  onChooseFont: (element: TextElementType) => void;
}): JSX.Element {
  const { style } = element;
  const set = (patch: Partial<TextStyle>): void => onChange({ ...element, style: { ...style, ...patch } });

  const fonts = [
    ...SYSTEM_FONTS.map((font) => ({ value: font, label: font, group: 'Fonts' })),
    // A file the style names that has since gone stays listed, so the select does not lie.
    ...[...new Set([...fontFiles, ...(isFontFile(style.font) ? [style.font] : [])])].map((file) => ({ value: file, label: file, group: 'Its own files' })),
    ...(SYSTEM_FONTS.includes(style.font) || isFontFile(style.font) ? [] : [{ value: style.font, label: style.font, group: 'Fonts' }]),
    { value: CHOOSE_FONT_FILE, label: 'Choose a font file…', group: 'Its own files' }
  ];

  return (
    <>
      <Fold title="Text">
        <Select
          label="Font"
          value={style.font}
          options={fonts}
          onChange={(font) => (font === CHOOSE_FONT_FILE ? onChooseFont(element) : set({ font }))}
        />
        <div className="pair">
          <NumberInput label="Size" unit="px" value={style.size} min={6} max={200} onCommit={(size) => set({ size })} />
          <Select
            label="Weight"
            value={String(style.weight)}
            options={FONT_WEIGHTS.map((weight) => ({ value: String(weight.value), label: weight.label }))}
            onChange={(weight) => set({ weight: Number(weight) })}
          />
        </div>
        <Segmented
          label="Align"
          value={style.align}
          onChange={(align) => set({ align })}
          options={[
            { value: 'left', label: 'Left' },
            { value: 'center', label: 'Centre' },
            { value: 'right', label: 'Right' }
          ]}
        />
        <Field label="Colour">
          <ColorField label="Colour" value={style.color} onCommit={(color) => set({ color })} />
        </Field>
        <Field label="Line height">
          <NumberInput label="Line height" value={style.lineHeight} min={0.8} max={3} onCommit={(lineHeight) => set({ lineHeight })} />
        </Field>
      </Fold>

      <Fold title="Behind the text">
        <Checkbox label="Shadow" checked={style.shadow !== null} onChange={(on) => set({ shadow: on ? (DEFAULT_TEXT_STYLE.shadow ?? null) : null })} />
        {style.shadow ? (
          <div className="sub">
            <ColorField label="Shadow colour" value={style.shadow.color} onCommit={(color) => style.shadow && set({ shadow: { ...style.shadow, color } })} />
            <div className="pair">
              <NumberInput label="Shadow blur" unit="blur" value={style.shadow.blur} min={0} max={100} onCommit={(blur) => style.shadow && set({ shadow: { ...style.shadow, blur } })} />
              <NumberInput label="Shadow drop" unit="drop" value={style.shadow.y} min={-100} max={100} onCommit={(y) => style.shadow && set({ shadow: { ...style.shadow, y } })} />
            </div>
          </div>
        ) : null}

        <Checkbox label="Outline" checked={style.stroke !== null} onChange={(on) => set({ stroke: on ? { color: '#000000', width: 1 } : null })} />
        {style.stroke ? (
          <div className="sub">
            <ColorField label="Outline colour" value={style.stroke.color} onCommit={(color) => style.stroke && set({ stroke: { ...style.stroke, color } })} />
            <NumberInput label="Outline width" unit="px" value={style.stroke.width} min={0} max={20} onCommit={(width) => style.stroke && set({ stroke: { ...style.stroke, width } })} />
          </div>
        ) : null}

        <Checkbox
          label="Background"
          checked={style.background !== null}
          onChange={(on) => set({ background: on ? { color: 'rgba(0, 0, 0, 0.6)', radius: 8, padding: 8 } : null })}
        />
        {style.background ? (
          <div className="sub">
            <ColorField label="Background colour" value={style.background.color} onCommit={(color) => style.background && set({ background: { ...style.background, color } })} />
            <div className="pair">
              <NumberInput label="Corner radius" unit="r" value={style.background.radius} min={0} max={200} onCommit={(radius) => style.background && set({ background: { ...style.background, radius } })} />
              <NumberInput label="Padding" unit="pad" value={style.background.padding} min={0} max={200} onCommit={(padding) => style.background && set({ background: { ...style.background, padding } })} />
            </div>
          </div>
        ) : null}
      </Fold>

      {element.type === 'speech' ? (
        <Fold title="Arrives" defaultOpen={false}>
          <Segmented
            label="How a line arrives"
            value={element.reveal}
            onChange={(reveal) => onChange({ ...element, reveal })}
            options={[
              { value: 'typewriter', label: 'Typed' },
              { value: 'fade', label: 'Fades in' },
              { value: 'instant', label: 'At once' }
            ]}
          />
          <div className="field-hint">How each line appears once the character speaks.</div>
        </Fold>
      ) : null}
    </>
  );
}
