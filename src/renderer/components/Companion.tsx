import { useState, type CSSProperties } from 'react';
import { DEFAULT_LAYOUT, UNIT_INSET, type OverlayLayout } from '@shared/overlayLayout';
import type { PhraseSegment, Presence, SkinId, ToastPayload } from '@shared/types';
import type { Persona } from '@renderer/personas';
import { getSkin } from '@renderer/skins';
import CharacterHandle from './CharacterHandle';
import CharacterUnit from './CharacterUnit';
import Dialogue from './Dialogue';
import EventToast from './EventToast';
import styles from './Companion.module.css';

export interface CompanionProps {
  persona: Persona;
  /** Overrides the persona's default skin; supplied by settings. */
  skinId?: SkinId;
  /** Overrides the persona's static name label with the active preset's, from runtime state. */
  displayName?: string;
  /** A preset's custom appearance video; replaces the shader skin entirely when set. */
  videoUrl?: string | null;
  segments: PhraseSegment[];
  activeIndex: number;
  revealed: number;
  visible: boolean;
  reducedMotion: boolean;
  onDismiss: () => void;
  /**
   * Identifies the current phrase. Entry effects are keyed on it, because an
   * interrupting phrase reuses segment index 0 while the previous one is still
   * mounted — without this the second consecutive `rage` opener would enter
   * with no glitch at all.
   */
  speechKey?: string;
  /** Zone C is independent and may render with no speech at all (§3, §6). */
  toast?: ToastPayload | null;
  toastVisible?: boolean;
  /** §4.1 review mode, set only by the design harness. */
  unlit?: boolean;
  /**
   * The character stays on screen between lines. It then rests instead of
   * leaving, and can be clicked, dragged and right-clicked.
   */
  pinned?: boolean;
  /** Silenced for now — muted, snoozed, quiet hours. A pinned eye closes for it. */
  dormant?: boolean;
  /** Which side of the window the unit is on and which way the text runs. */
  layout?: OverlayLayout;
  /** The pinned character was clicked with nothing on screen to dismiss. */
  onPoke?: () => void;
  /** The pinned character was right-clicked. */
  onMenu?: () => void;
}

/**
 * The three right-aligned zones of §3. Zone A is fixed geometry; B and C hang
 * off fixed anchors, so the window itself never moves however long the line
 * is. Zone B sits under the unit and grows downward — see the note in the
 * stylesheet about what that costs.
 */
export default function Companion({
  persona,
  skinId,
  displayName,
  videoUrl,
  segments,
  activeIndex,
  revealed,
  visible,
  reducedMotion,
  onDismiss,
  speechKey = '',
  toast = null,
  toastVisible = true,
  unlit = false,
  pinned = false,
  dormant = false,
  layout = DEFAULT_LAYOUT,
  onPoke,
  onMenu
}: CompanionProps): JSX.Element | null {
  // The cursor is on the character, or it is being carried somewhere.
  const [attended, setAttended] = useState(false);

  const segment = segments[activeIndex] ?? null;
  const mode = visible ? (segment?.mode ?? null) : null;
  const hasSpeech = segments.length > 0;

  // Nothing on screen and nothing to animate out: render nothing at all, so a
  // hidden overlay costs no compositing work. A pinned companion is never in
  // that state — it is what is on screen.
  if (!pinned && !visible && !hasSpeech && !toast) return null;

  // Awake for a line or for the user's hand; otherwise at rest, or closed if
  // nothing is going to be said for a while. Unpinned, it is only ever on
  // screen to speak.
  const presence: Presence =
    !pinned || visible || attended ? 'awake' : dormant ? 'asleep' : 'resting';

  const typing = segment !== null && revealed < segment.text.length;

  // The speech block hangs under the *optic*, not under the unit's box: the
  // canvas is mostly empty below the lens because the bloom needs somewhere to
  // land, and anchoring to the box leaves the label floating a long way clear
  // of anything visible. Every skin declares where its optic is, so this holds
  // when the skin changes.
  const skin = getSkin(skinId ?? persona.defaultSkin);
  const zones = {
    '--optic-y': `${skin.opticCenter.y}px`,
    '--unit-h': `${skin.canvas.height}px`,
    '--unit-inset-x': `${UNIT_INSET.x}px`,
    '--unit-inset-y': `${UNIT_INSET.y}px`
  } as CSSProperties;

  return (
    <div
      className={styles.root}
      style={zones}
      data-state={visible ? 'in' : 'out'}
      data-pinned={pinned ? 'true' : 'false'}
      data-anchor={layout.anchor}
      data-flow={layout.flow}
    >
      {hasSpeech || pinned ? (
        /* Zone A — fixed. Never moves or resizes with the text. */
        <div className={styles.unitSlot}>
          <CharacterUnit
            persona={persona}
            skinId={skinId}
            videoUrl={videoUrl}
            mode={mode}
            speaking={visible && typing}
            reducedMotion={reducedMotion}
            unlit={unlit}
            presence={presence}
          />
          {pinned ? (
            <CharacterHandle
              centre={skin.opticCenter}
              layoutKey={`${layout.anchor}-${layout.flow}`}
              onAttention={setAttended}
              onMenu={() => onMenu?.()}
              // With a line up, a click is "enough, thank you"; without one
              // it is a tap on the glass.
              onActivate={() => (visible ? onDismiss() : onPoke?.())}
            />
          ) : null}
        </div>
      ) : null}

      {hasSpeech ? (
        /* Zone B — beside the optic. The label is the fixed point and the
           dialogue hangs off it (§1.1): beneath, or above when the companion
           is pinned too low on the screen for that. */
        <div className={styles.speechZone}>
          <div className={styles.nameLabel}>{displayName ?? persona.nameLabel}</div>
          <div className={styles.dialogueSlot}>
            <Dialogue
              key={speechKey}
              segment={segment}
              revealed={revealed}
              segmentIndex={activeIndex}
              reducedMotion={reducedMotion}
              onDismiss={onDismiss}
            />
          </div>
        </div>
      ) : null}

      {/* Zone C — independent of the speech entirely. */}
      {toast ? (
        <div className={styles.toastSlot}>
          {/* Keyed too: a replacement toast must replay its entry slide
              rather than swapping its text in place. */}
          <EventToast key={toast.id} toast={toast} visible={visible && toastVisible} />
        </div>
      ) : null}

      {/* Three scanline tears sweep the whole overlay for 150 ms whenever a
          rage segment enters. Keyed on the segment so it re-fires per entry. */}
      {mode === 'rage' && !reducedMotion ? (
        <div className={styles.tears} key={`tear-${speechKey}-${activeIndex}`} aria-hidden="true">
          <span className={styles.tear} />
          <span className={styles.tear} />
          <span className={styles.tear} />
        </div>
      ) : null}
    </div>
  );
}
