/**
 * Agent-roster glyphs: lucide stroke icons drawn through StrokeIcon from
 * dsh-client-ui-primitives, the same icon system as the rest of the UI.
 */
import { ChevronLeft, Sparkles, StrokeIcon } from '@deepseek-ai/dsh-client-ui-primitives'

/** One glyph's presentation input. */
export interface GlyphProps {
  /** Rendered edge length in CSS pixels; every glyph is square. */
  size: number
}

/**
 * The agent glyph: a sparkle burst.
 * @param props - glyph presentation input.
 * @returns the glyph.
 */
export function AgentGlyph({ size }: GlyphProps) {
  return <StrokeIcon icon={Sparkles} size={size} />
}

/**
 * The back glyph: a leftward chevron for the return-to-roster control.
 * @param props - glyph presentation input.
 * @returns the glyph.
 */
export function BackGlyph({ size }: GlyphProps) {
  return <StrokeIcon icon={ChevronLeft} size={size} />
}
