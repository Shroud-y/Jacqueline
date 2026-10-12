import { useEffect, useState } from 'react';
import { DEFAULT_LAYOUT, type OverlayLayout } from '@shared/overlayLayout';
import type { CueSources, SkinId } from '@shared/types';

/**
 * The half of `state:update` the overlay cares about. Main pushes it once the
 * window has loaded and again on every settings change, which is what makes
 * the skin switchable at runtime with no restart (§9a).
 */
export function useSkinId(): SkinId | undefined {
  const [skinId, setSkinId] = useState<SkinId | undefined>(undefined);

  useEffect(() => {
    const api = window.codex;
    if (!api) return;
    return api.onStateUpdate((payload) => setSkinId(payload.skinId));
  }, []);

  return skinId;
}

/**
 * Where the two cue sounds come from. Undefined until the first state push;
 * the renderer synthesises both until then, which is also what it does when
 * main reports no files.
 */
export function useCueSources(): CueSources | undefined {
  const [cues, setCues] = useState<CueSources | undefined>(undefined);

  useEffect(() => {
    const api = window.codex;
    if (!api) return;
    return api.onStateUpdate((payload) => setCues(payload.cues));
  }, []);

  return cues;
}

/** The active preset's display name, e.g. 'Ordis' or a user's rename. */
export function usePresetName(): string | undefined {
  const [presetName, setPresetName] = useState<string | undefined>(undefined);

  useEffect(() => {
    const api = window.codex;
    if (!api) return;
    return api.onStateUpdate((payload) => setPresetName(payload.presetName));
  }, []);

  return presetName;
}

/** Set when the active preset has a custom appearance video, replacing the skin entirely. */
export function useAppearanceVideoUrl(): string | null | undefined {
  const [videoUrl, setVideoUrl] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const api = window.codex;
    if (!api) return;
    return api.onStateUpdate((payload) => setVideoUrl(payload.appearanceVideoUrl));
  }, []);

  return videoUrl;
}

export interface PinnedState {
  pinned: boolean;
  dormant: boolean;
  layout: OverlayLayout;
}

const UNPINNED: PinnedState = { pinned: false, dormant: false, layout: DEFAULT_LAYOUT };

/**
 * Whether the character lives on screen, whether it is silenced, and how the
 * window is laid out around it. The same object comes back while nothing in
 * it has changed, so the layout does not look new on every unrelated push.
 */
export function usePinnedState(): PinnedState {
  const [state, setState] = useState<PinnedState>(UNPINNED);

  useEffect(() => {
    const api = window.codex;
    if (!api) return;
    return api.onStateUpdate((payload) =>
      setState((previous) => {
        const layout = payload.layout ?? DEFAULT_LAYOUT;
        const unchanged =
          previous.pinned === payload.pinned &&
          previous.dormant === payload.dormant &&
          previous.layout.anchor === layout.anchor &&
          previous.layout.flow === layout.flow;
        return unchanged ? previous : { pinned: payload.pinned, dormant: payload.dormant, layout };
      })
    );
  }, []);

  return state;
}

export interface AudioOptions {
  volume: number;
  appearEnabled: boolean;
  disappearEnabled: boolean;
}

/** The user's cue volume and per-cue on/off — global, not per-preset. */
export function useAudioOptions(): AudioOptions | undefined {
  const [options, setOptions] = useState<AudioOptions | undefined>(undefined);

  useEffect(() => {
    const api = window.codex;
    if (!api) return;
    return api.onStateUpdate((payload) =>
      setOptions({
        volume: payload.cueVolume,
        appearEnabled: payload.appearSoundEnabled,
        disappearEnabled: payload.disappearSoundEnabled
      })
    );
  }, []);

  return options;
}
