/**
 * Agent glyphs: stroked 24×24 paths in `currentColor`, geometry copied from
 * the design reference's `IC` table so this view draws in the same system as
 * the rest of the CaMeL Science surface.
 */

/** One glyph's presentation input. */
export interface GlyphProps {
  /** Rendered edge length in CSS pixels; every glyph is square. */
  size: number
}

/**
 * Render one stroked glyph.
 * @param size - rendered edge length in CSS pixels.
 * @param paths - the glyph's `d` attributes, drawn in order.
 * @returns the glyph as an inline SVG.
 */
function glyph(size: number, paths: readonly string[]) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block' }}
      aria-hidden="true"
    >
      {paths.map(d => <path key={d} d={d} />)}
    </svg>
  )
}

/**
 * The agent glyph: two sparkles, the design reference's `IC.agent`.
 * @param props - glyph presentation input.
 * @returns the glyph.
 */
export function AgentGlyph({ size }: GlyphProps) {
  return glyph(size, [
    'M11 3.5l1.6 4.6 4.6 1.6-4.6 1.6L11 15.9l-1.6-4.6-4.6-1.6 4.6-1.6L11 3.5',
    'M18.3 14.8l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9.9-2.4',
  ])
}

/**
 * The back glyph: a leftward arrow for the return-to-roster control.
 * @param props - glyph presentation input.
 * @returns the glyph.
 */
export function BackGlyph({ size }: GlyphProps) {
  return glyph(size, ['M14.5 5.5 8 12l6.5 6.5'])
}
