import { useEffect, useState } from 'react';
import type { TextStyle } from '@shared/character';
import { DEFAULT_MS_PER_CHAR } from '@shared/speechTiming';
import TextElement from '../shared/TextElement';

interface SpeechTextProps {
  characterId: string;
  text: string;
  style: TextStyle;
  reveal: 'typewriter' | 'fade' | 'instant';
  box: { left: number; top: number; width: number; height: number };
}

/**
 * A line arriving the way its layout says: typed out at the pace the speech
 * timing assumes, faded in, or there at once. Mounted afresh for every line
 * (keyed by the caller), so each one starts from nothing.
 */
export default function SpeechText({ characterId, text, style, reveal, box }: SpeechTextProps): JSX.Element {
  const [shown, setShown] = useState(reveal === 'typewriter' ? 0 : text.length);

  useEffect(() => {
    if (reveal !== 'typewriter') return;
    // A few characters per tick rather than a tick per character: the same
    // pace, a fraction of the redraws.
    const perTick = 3;
    const timer = setInterval(() => {
      setShown((count) => {
        const next = Math.min(text.length, count + perTick);
        if (next >= text.length) clearInterval(timer);
        return next;
      });
    }, DEFAULT_MS_PER_CHAR * perTick);
    return () => clearInterval(timer);
  }, [reveal, text]);

  return (
    <TextElement
      className={reveal === 'fade' ? 'text text-fade' : 'text'}
      characterId={characterId}
      text={text.slice(0, shown)}
      style={style}
      box={box}
    />
  );
}
