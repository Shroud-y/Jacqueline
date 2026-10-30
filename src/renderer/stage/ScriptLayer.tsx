import { useEffect, useRef } from 'react';

/** A mood a script may set: what a stylesheet can match in `[data-mood="…"]`, and nothing else. */
const MOOD = /^[a-z][a-z0-9-]{0,31}$/;

interface ScriptLayerProps {
  url: string;
  speech: { id: string; text: string; durationMs: number } | null;
  preview: boolean;
  playing: boolean;
  /** null clears the mood. */
  onMood: (mood: string | null) => void;
}

/**
 * The character's own script, in a sealed frame over its window (see
 * main/characters/scriptHost.ts). It is told what happens through
 * `postMessage`, and the only thing it can ask back is a mood.
 */
export default function ScriptLayer({ url, speech, preview, playing, onMood }: ScriptLayerProps): JSX.Element {
  const frame = useRef<HTMLIFrameElement>(null);
  const ready = useRef(false);
  // What the script was last told, for when it says it is ready.
  const latest = useRef<object>({ speaking: false, line: null, preview: false, playing: true });

  const send = (message: object): void => {
    frame.current?.contentWindow?.postMessage(message, '*');
  };

  useEffect(() => {
    ready.current = false;
    const onMessage = (event: MessageEvent): void => {
      // Only its own frame, and only what the runtime sends.
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const data: unknown = event.data;
      if (!data || typeof data !== 'object' || typeof (data as { jacqueline?: unknown }).jacqueline !== 'string') return;
      const { jacqueline: type, mood } = data as { jacqueline: string; mood?: unknown };
      if (type === 'ready') {
        ready.current = true;
        send({ jacqueline: 'state', state: latest.current });
      } else if (type === 'mood') {
        if (mood === null) onMood(null);
        else if (typeof mood === 'string' && MOOD.test(mood)) onMood(mood);
      }
    };
    addEventListener('message', onMessage);
    return () => {
      removeEventListener('message', onMessage);
      // A reloaded script starts with no mood of its own.
      onMood(null);
    };
    // A new address is a new script; the mood callback is the page's own setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useEffect(() => {
    latest.current = { speaking: speech !== null, line: speech, preview, playing };
    if (ready.current) send({ jacqueline: 'state', state: latest.current });
    // A new line is a new id; its text never changes under the same one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speech?.id, preview, playing]);

  useEffect(() => {
    const onClick = (): void => {
      if (ready.current) send({ jacqueline: 'click' });
    };
    addEventListener('jacqueline-click', onClick);
    return () => removeEventListener('jacqueline-click', onClick);
  }, []);

  return <iframe ref={frame} key={url} className="script-layer" src={url} sandbox="allow-scripts" title="" aria-hidden="true" tabIndex={-1} />;
}
