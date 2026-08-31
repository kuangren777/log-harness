/**
 * Rail glyphs: lucide stroke icons drawn through StrokeIcon from
 * dsh-client-ui-primitives, the same icon system as the rest of the UI.
 * The theme toggle's sun/moon swap lives in RailFooter as a MorphStrokeIcon.
 */
import { Compass, StrokeIcon } from '@deepseek-ai/dsh-client-ui-primitives'

/** One glyph's presentation input. */
export interface GlyphProps {
  /** Rendered edge length in CSS pixels; every glyph is square. */
  size: number
}

/**
 * The research-flow glyph: a compass rose.
 * @param props - glyph presentation input.
 * @returns the glyph.
 */
export function FlowGlyph({ size }: GlyphProps) {
  return <StrokeIcon icon={Compass} size={size} />
}
