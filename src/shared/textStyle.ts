/**
 * A text element's style as CSS. One mapping, used by the editor's canvas
 * and the character's own window, so what is laid out is what appears.
 */

import { assetKindOf, type TextStyle } from './character';

/** Fonts a Windows machine has without anything installed, plus the one Jacqueline ships. */
export const SYSTEM_FONTS: readonly string[] = [
  'Saira',
  'Segoe UI',
  'Segoe UI Variable Text',
  'Arial',
  'Bahnschrift',
  'Calibri',
  'Cambria',
  'Candara',
  'Comic Sans MS',
  'Consolas',
  'Corbel',
  'Georgia',
  'Impact',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana'
];

export const FONT_WEIGHTS: readonly { value: number; label: string }[] = [
  { value: 300, label: 'Light' },
  { value: 400, label: 'Regular' },
  { value: 500, label: 'Medium' },
  { value: 600, label: 'Semibold' },
  { value: 700, label: 'Bold' },
  { value: 900, label: 'Black' }
];

/** True when the style's font is one of the character's own files rather than a family name. */
export function isFontFile(font: string): boolean {
  return assetKindOf(font) === 'font';
}

/** The CSS `font-family` value: the file's own name doubles as its family once it is loaded. */
export function fontFamily(font: string): string {
  return `"${font.replace(/"/g, '')}", "Segoe UI", sans-serif`;
}

/** Plain style properties, with React's camel-case keys. */
export function textStyleCss(style: TextStyle): Record<string, string | number> {
  const css: Record<string, string | number> = {
    fontFamily: fontFamily(style.font),
    fontSize: `${style.size}px`,
    fontWeight: style.weight,
    color: style.color,
    textAlign: style.align,
    lineHeight: style.lineHeight,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere'
  };
  if (style.shadow) {
    const { x, y, blur, color } = style.shadow;
    css.textShadow = `${x}px ${y}px ${blur}px ${color}`;
  }
  if (style.stroke && style.stroke.width > 0) {
    // Painted under the fill, so the letters keep their own width.
    css.WebkitTextStroke = `${style.stroke.width * 2}px ${style.stroke.color}`;
    css.paintOrder = 'stroke fill';
  }
  if (style.background) {
    css.backgroundColor = style.background.color;
    css.borderRadius = `${style.background.radius}px`;
    css.padding = `${style.background.padding}px`;
  }
  return css;
}

/** What a text element shows where there is no real line to show yet. */
export const SAMPLE_LINE = 'The quick brown fox jumps over the lazy dog.';
