/**
 * Search glyphs: stroked 24×24 paths in `currentColor`, geometry copied from
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
 * The search glyph: a magnifier.
 * @param props - glyph presentation input.
 * @returns the glyph.
 */
export function SearchGlyph({ size }: GlyphProps) {
  return glyph(size, ['M11 17a6 6 0 1 0 0-12 6 6 0 0 0 0 12', 'M15.4 15.4 20 20'])
}
