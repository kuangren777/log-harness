/**
 * Library glyphs: lucide stroke icons drawn through StrokeIcon from
 * dsh-client-ui-primitives, the same icon system as the rest of the UI.
 */
import { Database, Search, StrokeIcon } from '@deepseek-ai/dsh-client-ui-primitives'

/** One glyph's presentation input. */
export interface GlyphProps {
  /** Rendered edge length in CSS pixels; every glyph is square. */
  size: number
}

/**
 * The library glyph: a database stack.
 * @param props - glyph presentation input.
 * @returns the glyph.
 */
export function LibraryGlyph({ size }: GlyphProps) {
  return <StrokeIcon icon={Database} size={size} />
}

/**
 * The search glyph inside the library's query box: a magnifier.
 * @param props - glyph presentation input.
 * @returns the glyph.
 */
export function SearchGlyph({ size }: GlyphProps) {
  return <StrokeIcon icon={Search} size={size} />
}
