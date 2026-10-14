import { useEffect, type CSSProperties } from 'react';
import { assetUrl } from '@shared/assetUrl';
import type { TextStyle } from '@shared/character';
import { isFontFile, textStyleCss } from '@shared/textStyle';

/** Font files already handed to the page, so each is loaded once. */
const loaded = new Map<string, Promise<void>>();

/**
 * Makes a character's own font file usable by its file name. The name is the
 * family: `font: "Comic.ttf"` in a style means that file.
 */
export function useAssetFont(characterId: string, font: string): void {
  useEffect(() => {
    if (!isFontFile(font)) return;
    const key = `${characterId}/${font}`;
    if (loaded.has(key)) return;
    const face = new FontFace(font, `url("${assetUrl(characterId, font)}")`);
    loaded.set(
      key,
      face.load().then(
        () => void document.fonts.add(face),
        // A broken file falls back to the next family in the stack; forget it so a replacement is tried.
        () => void loaded.delete(key)
      )
    );
  }, [characterId, font]);
}

interface TextElementProps {
  characterId: string;
  text: string;
  style: TextStyle;
  box: { left: number; top: number; width: number; height: number };
  className?: string;
}

/** A text element of a layout, styled exactly as it will appear on the desktop. */
export default function TextElement({ characterId, text, style, box, className }: TextElementProps): JSX.Element {
  useAssetFont(characterId, style.font);
  return (
    <div
      className={className}
      style={{
        position: 'absolute',
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        boxSizing: 'border-box',
        overflow: 'hidden',
        ...(textStyleCss(style) as CSSProperties)
      }}
    >
      {text}
    </div>
  );
}
