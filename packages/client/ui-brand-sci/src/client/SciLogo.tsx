import type { CSSProperties } from 'react'

/** Stable test hook for the logo glyph. */
export const LOGO_TEST_ID = 'sci-logo'

/** Rotations (degrees, about the 24×24 viewBox centre) of the three orbits. */
const ORBITS = [0, 60, 120] as const

/** Presentation input for the logo glyph. */
export interface SciLogoProps {
  /** Rendered edge length in CSS pixels; the glyph is square. */
  size: number
}

/**
 * Render the CaMeL Science orbit glyph: three ellipses rotated 0°/60°/120°
 * around a filled nucleus, all in `currentColor` so the host surface owns the
 * colour. Geometry matches the design reference's `logo()` helper exactly.
 * @param props - Logo presentation input.
 * @returns the orbit glyph as an inline SVG.
 */
export function SciLogo({ size }: SciLogoProps) {
  const style: CSSProperties = { display: 'block' }
  return (
    <svg
      data-testid={LOGO_TEST_ID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={style}
      aria-hidden="true"
    >
      {ORBITS.map(rotation => (
        <ellipse
          key={rotation}
          cx="12"
          cy="12"
          rx="9.2"
          ry="3.9"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          transform={`rotate(${rotation} 12 12)`}
        />
      ))}
      <circle cx="12" cy="12" r="2.1" fill="currentColor" />
    </svg>
  )
}
