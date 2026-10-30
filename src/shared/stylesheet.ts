/**
 * A character's own stylesheet: what it starts as, and the hooks in its
 * window it can rely on. The hooks are a promise — renaming one breaks
 * every stylesheet that uses it.
 */

export const STYLESHEET_NAME = 'style.css';

export const STYLE_STARTER = `/*
 * This character's own style. It applies to its window on the desktop, and a
 * saved change shows there at once.
 *
 * What there is to style:
 *   .stage                      the whole window
 *     [data-speaking="true"]    …while a line is up
 *     [data-state="idle"]       …or "speaking"
 *     [data-preview="true"]     …while it is being laid out in the editor
 *   .character                  the box its picture or video sits in
 *   .visual                     the picture or video itself
 *   .placeholder                what shows while it has no picture
 *   .text-speech                the line being said
 *   .text-name                  its name, while it speaks
 *
 * Size, position, opacity and mirroring are set by the editor on the element
 * itself; to change those here, use !important.
 *
 * Other files in its assets folder can be used by name: url("glow.png").
 * Nothing from the internet loads here.
 *
 * An animation costs CPU for as long as it runs — as much as a video does.
 */

/* For example: the character rises a little while it talks. */
.character {
  transition: transform 200ms ease-out;
}

.stage[data-speaking="true"] .character {
  transform: translateY(-6px);
}
`;
