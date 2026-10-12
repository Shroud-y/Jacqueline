import { useEffect, useRef } from 'react';
import Companion from './components/Companion';
import { getPersona } from './personas';
import {
  useAppearanceVideoUrl,
  useAudioOptions,
  useCueSources,
  usePinnedState,
  usePresetName,
  useSkinId
} from './hooks/useOverlayState';
import { useOverlaySfx } from './hooks/useOverlaySfx';
import { useSpeech } from './hooks/useSpeech';

export default function App(): JSX.Element {
  const view = useSpeech();
  const skinId = useSkinId();
  const cues = useCueSources();
  const presetName = usePresetName();
  const videoUrl = useAppearanceVideoUrl();
  const audioOptions = useAudioOptions();
  const presence = usePinnedState();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastInteractive = useRef(false);

  useOverlaySfx(view.visible, cues, audioOptions);

  /* §10.2 — mouse events still arrive thanks to `forward: true`; report
     whether the cursor is over an interactive element and let main debounce. */
  useEffect(() => {
    const onMove = (event: MouseEvent): void => {
      const element = document.elementFromPoint(event.clientX, event.clientY);
      const interactive =
        element instanceof Element && element.closest('[data-interactive="true"]') !== null;
      if (interactive === lastInteractive.current) return;
      lastInteractive.current = interactive;
      window.codex?.setInteractive(interactive);
    };

    const onLeave = (): void => {
      if (!lastInteractive.current) return;
      lastInteractive.current = false;
      window.codex?.setInteractive(false);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseleave', onLeave);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  /* Hidden <audio> is the whole audio pipeline (§14.3): no native dependency,
     no extra IPC channel — the URL rides along on 'speech:show'. */
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const url = view.visible ? view.speech?.audioUrl : undefined;
    if (!url) {
      audio.pause();
      return;
    }
    audio.src = url;
    void audio.play().catch(() => {
      /* Missing or unplayable audio must never break the text. */
    });
  }, [view.speech, view.visible]);

  const speechId = view.speech?.speechId;

  return (
    <>
      <Companion
        persona={getPersona(view.speech?.personaId)}
        skinId={skinId}
        displayName={presetName}
        videoUrl={videoUrl}
        segments={view.speech?.segments ?? []}
        activeIndex={view.activeIndex}
        revealed={view.revealed}
        visible={view.visible}
        reducedMotion={view.reducedMotion}
        onDismiss={view.dismiss}
        speechKey={speechId}
        toast={view.speech?.toast ?? null}
        pinned={presence.pinned}
        dormant={presence.dormant}
        layout={presence.layout}
        onPoke={() => window.codex?.poke()}
        onMenu={() => window.codex?.openMenu()}
      />
      <audio
        ref={audioRef}
        hidden
        onEnded={() => {
          if (speechId) window.codex?.speechFinished(speechId);
        }}
      />
    </>
  );
}
