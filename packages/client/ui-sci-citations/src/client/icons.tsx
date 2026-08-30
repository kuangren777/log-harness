/**
 * Citation-pool glyphs: stroked 24×24 paths in `currentColor`, geometry
 * copied from the design reference's `IC` table so this view draws in the
 * same system as the rest of the CaMeL Science surface.
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
 * The citation-pool glyph: a bookmark with a spine.
 * @param props - glyph presentation input.
 * @returns the glyph.
 */
export function PoolGlyph({ size }: GlyphProps) {
  return glyph(size, ['M7 3.5h10a1 1 0 0 1 1 1V21l-6-4.2L6 21V4.5a1 1 0 0 1 1-1', 'M9.5 8.5h5'])
}

/**
 * The add glyph: a plus.
 * @param props - glyph presentation input.
 * @returns the glyph.
 */
export function PlusGlyph({ size }: GlyphProps) {
  return glyph(size, ['M12 5v14', 'M5 12h14'])
}

/**
 * The remove glyph: a cross.
 * @param props - glyph presentation input.
 * @returns the glyph.
 */
export function CloseGlyph({ size }: GlyphProps) {
  return glyph(size, ['M6 6l12 12', 'M18 6 6 18'])
}
