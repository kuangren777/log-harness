import type { CSSProperties } from 'react'
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

type SciBrandMarkProps = HeroBrandMarkOwnerProps & SidebarBrandMarkOwnerProps

/** Stable test hook for the mark. */
export const MARK_TEST_ID = 'sci-brand-mark'
/** Stable test hook for the wordmark. */
export const NAME_TEST_ID = 'sci-brand-name'

/** Product wordmark rendered beside the mark. */
export const BRAND_NAME = 'CaMeL Science'

/**
 * Render the CaMeL Science mark: a rounded square carrying the brand's conic
 * gradient (cyan → indigo → violet), sized by the host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the gradient tile.
 */
export function SciBrandMark({ size, className }: SciBrandMarkProps) {
  const style: CSSProperties = {
    display: 'inline-block',
    width: size,
    height: size,
    borderRadius: Math.max(4, Math.round(size * 0.3)),
    background: 'conic-gradient(from 200deg, #64d2ff, #6e6cf7, #bf5af2, #64d2ff)',
    boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.18), 0 8px 20px -10px #6e6cf7',
    flex: 'none',
  }
  return <span data-testid={MARK_TEST_ID} className={className} style={style} aria-hidden="true" />
}

/**
 * Render the CaMeL Science wordmark without its independently slotted mark.
 * @returns the two-weight wordmark.
 */
export function SciBrandName() {
  const style: CSSProperties = {
    fontWeight: 700,
    letterSpacing: '-0.02em',
    fontSize: 15,
    lineHeight: 1,
    whiteSpace: 'nowrap',
    color: 'var(--dsw-alias-label-primary)',
  }
  return (
    <span data-testid={NAME_TEST_ID} style={style}>
      CaMeL <span style={{ fontWeight: 400, color: 'var(--dsw-alias-label-secondary)' }}>Science</span>
    </span>
  )
}
