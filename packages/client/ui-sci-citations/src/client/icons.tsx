/**
 * Citation-pool glyphs: lucide stroke icons drawn through StrokeIcon from
 * dsh-client-ui-primitives, the same icon system as the rest of the UI.
 */
import { Bookmark, Plus, StrokeIcon, X } from '@deepseek-ai/dsh-client-ui-primitives'

/** One glyph's presentation input. */
export interface GlyphProps {
  /** Rendered edge length in CSS pixels; every glyph is square. */
  size: number
}

/**
 * The citation-pool glyph: a bookmark.
 * @param props - glyph presentation input.
 * @returns the glyph.
 */
export function PoolGlyph({ size }: GlyphProps) {
  return <StrokeIcon icon={Bookmark} size={size} />
}

/**
 * The add glyph: a plus.
 * @param props - glyph presentation input.
 * @returns the glyph.
 */
export function PlusGlyph({ size }: GlyphProps) {
  return <StrokeIcon icon={Plus} size={size} />
}

/**
 * The remove glyph: a cross.
 * @param props - glyph presentation input.
 * @returns the glyph.
 */
export function CloseGlyph({ size }: GlyphProps) {
  return <StrokeIcon icon={X} size={size} />
}
