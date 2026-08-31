/**
 * Search glyphs: lucide stroke icons drawn through StrokeIcon from
 * dsh-client-ui-primitives, the same icon system as the rest of the UI.
 */
import { Search, StrokeIcon } from '@deepseek-ai/dsh-client-ui-primitives'

/** One glyph's presentation input. */
export interface GlyphProps {
  /** Rendered edge length in CSS pixels; every glyph is square. */
  size: number
}

/**
 * The search glyph: a magnifier.
 * @param props - glyph presentation input.
 * @returns the glyph.
 */
export function SearchGlyph({ size }: GlyphProps) {
  return <StrokeIcon icon={Search} size={size} />
}
