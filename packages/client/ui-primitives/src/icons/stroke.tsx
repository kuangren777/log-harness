/**
 * Stroke-icon kernel for the dsh web UI. Static icons render lucide IconNode
 * geometry through {@link StrokeIcon}; icons that change with state render
 * through {@link MorphStrokeIcon}, which springs the path between the old and
 * new geometry via morphicons.
 */
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { MorphIcon } from 'morphicons/react'
import type { IconInput, IconNode, MorphOptions, ReducedMotionMode, SpringPreset } from 'morphicons/react'

/** Stroke width in 24-grid units shared by every stroke icon; renders at STROKE_WIDTH × size/24 px. */
const STROKE_WIDTH = 1.7

/** Props for {@link StrokeIcon}. */
export interface StrokeIconProps {
  /** Lucide icon data (IconNode) drawn on the shared 24×24 grid. */
  icon: IconNode
  /** Square edge in px; defaults to 16. */
  size?: number | undefined
  /** Extra class for layout placement; color rides currentColor. */
  className?: string | undefined
}

/** Render one lucide IconNode as SVG children, dropping undefined attributes. */
function nodeChildren(icon: IconNode): ReactNode {
  return icon.map(([tag, attrs], i) =>
    createElement(tag, {
      ...(Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== undefined)) as Record<string, string | number>),
      key: i,
    }),
  )
}

/**
 * Draw one static stroke icon from lucide data.
 * @param props.icon - lucide IconNode to draw.
 * @param props.size - square edge in px; defaults to 16.
 * @param props.className - extra class for layout placement.
 * @returns the icon as an inline SVG stroked in currentColor.
 */
export const StrokeIcon = ({ icon, size = 16, className }: StrokeIconProps) => (
  <svg
    width={size}
    height={size}
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={STROKE_WIDTH}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ display: 'block' }}
  >
    {nodeChildren(icon)}
  </svg>
)

/** Props for {@link MorphStrokeIcon}. */
export interface MorphStrokeIconProps {
  /** Current icon; changing it animates the morph from the previous icon. */
  icon: IconInput
  /** Square edge in px; defaults to 16. */
  size?: number | undefined
  /** Extra class for layout placement; color rides currentColor. */
  className?: string | undefined
  /** Spring physics preset or custom stiffness/damping; defaults to morphicons' default. */
  spring?: SpringPreset | MorphOptions | undefined
  /** Reduced-motion policy; defaults to "user" (honor the OS setting). Tests pass "always". */
  reducedMotion?: ReducedMotionMode | undefined
}

/**
 * Draw a stroke icon that morphs with spring physics when `icon` changes.
 * Honors the OS reduce-motion setting (morphs degrade to an instant swap);
 * tests and screenshots may pass reducedMotion="always" for a deterministic jump.
 * @param props.icon - current lucide IconNode; changing it starts the morph.
 * @param props.size - square edge in px; defaults to 16.
 * @param props.className - extra class for layout placement.
 * @param props.spring - spring preset or custom physics.
 * @param props.reducedMotion - reduced-motion policy; "always" jumps deterministically.
 * @returns the morphing icon as an inline SVG stroked in currentColor.
 */
export const MorphStrokeIcon = ({ icon, size = 16, className, spring, reducedMotion = 'user' }: MorphStrokeIconProps) => (
  <MorphIcon
    icon={icon}
    size={size}
    className={className}
    {...(spring !== undefined ? { spring } : {})}
    strokeWidth={STROKE_WIDTH}
    reducedMotion={reducedMotion}
    style={{ display: 'block' }}
  />
)
