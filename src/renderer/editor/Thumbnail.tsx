import type { Character } from '@shared/character';
import { assetUrl } from '@shared/assetUrl';

/**
 * A character as a small picture: its idle look, or the first frame of it.
 * The only colour in the editor is the characters' own (docs/DESIGN.md §1).
 */
export default function Thumbnail({ character }: { character: Character | null }): JSX.Element {
  const states = character?.appearance.states;
  const visual = states ? (states.idle ?? Object.values(states)[0] ?? null) : null;

  if (!character || !visual) {
    return <span className="thumb thumb-empty" aria-hidden="true" data-broken={character === null} />;
  }

  const url = assetUrl(character.id, visual.src);
  return (
    <span className="thumb" aria-hidden="true">
      {visual.type === 'image' ? (
        <img src={url} alt="" draggable={false} />
      ) : (
        // Never played: it only has to show its first frame.
        <video src={url} muted preload="metadata" disablePictureInPicture />
      )}
    </span>
  );
}
