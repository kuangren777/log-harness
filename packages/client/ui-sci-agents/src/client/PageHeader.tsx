/**
 * The header both persona pages share: the way back to the roster, the card
 * glyph that identifies which persona this page is about, and its title.
 */
import type { Translate } from '@deepseek-ai/dsh-client-locale/client'
import type { SciAgentsKey } from './locales.ts'
import { BackGlyph } from './icons.tsx'
import { glyphOf } from './format.ts'
import css from './PageHeader.module.css'

/** Back-arrow edge length, in CSS pixels. */
const BACK_SIZE = 14

/** Owner-controlled page-header props. */
export interface PageHeaderProps {
  /** The persona's position in the roster, which picks the glyph. */
  glyphAt: number
  /** The page title, already naming the persona. */
  title: string
  /** The persona's role line, drawn under the title. */
  role: string
  /** Return to the roster. */
  onBack: () => void
  /** Localized header copy. */
  t: Translate<SciAgentsKey>
}

/**
 * Render the persona page header.
 * @param props - the header's owner-controlled props.
 * @returns the back control over the persona's identity line.
 */
export function PageHeader({ glyphAt, title, role, onBack, t }: PageHeaderProps) {
  return (
    <div className={css.root}>
      <button type="button" className={css.back} onClick={onBack}>
        <BackGlyph size={BACK_SIZE} />
        {t('page.back')}
      </button>
      <div className={css.identity}>
        <span className={css.glyph} aria-hidden="true">{glyphOf(glyphAt)}</span>
        <div>
          <h1 className={css.title}>{title}</h1>
          <div className={css.role}>{role}</div>
        </div>
      </div>
    </div>
  )
}
