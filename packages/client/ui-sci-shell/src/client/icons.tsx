/**
 * Rail glyphs: stroked 24×24 paths in `currentColor`, geometry copied from
 * the design reference's `IC` table so the shell reads as the same drawing
 * system as the rest of the CaMeL Science surface.
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
 * The research-flow glyph: a compass rose.
 * @param props - glyph presentation input.
 * @returns the glyph.
 */
export function FlowGlyph({ size }: GlyphProps) {
  return glyph(size, [
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18',
    'M15 9l-2.2 4.8L8 16l2.2-4.8L15 9',
  ])
}

/**
 * The light-palette glyph: a sun.
 * @param props - glyph presentation input.
 * @returns the glyph.
 */
export function SunGlyph({ size }: GlyphProps) {
  return glyph(size, [
    'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9',
    'M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M19.1 4.9l-1.6 1.6M6.5 17.5l-1.6 1.6',
  ])
}

/**
 * The dark-palette glyph: a crescent moon.
 * @param props - glyph presentation input.
 * @returns the glyph.
 */
export function MoonGlyph({ size }: GlyphProps) {
  return glyph(size, ['M20 13.6A8.2 8.2 0 1 1 10.4 4 6.6 6.6 0 0 0 20 13.6'])
}
