/**
 * In-panel office document view: the collaboration Viewer, framed.
 *
 * The document is never read as bytes — a `.univer` file is a SQLite
 * container, and the exported formats are archives. The office runtime hands
 * out a same-origin Viewer target instead, and this frame embeds it.
 *
 * Editing is granted only while the collaboration Gateway is up, because an
 * edit is a collaboration write with nothing behind it otherwise. A runtime
 * that does not answer at all produces a stated notice, never an empty frame:
 * a blank rectangle reads as a broken panel, while the reason is actionable
 * (the Gateway failed to start, or its license expired). The notice carries a
 * retry, because the read can also lose a race the user can win by asking
 * again — a host that has not finished attaching the session answers nothing
 * this frame can draw, and the reader's own waits are bounded.
 */
import { useEffect, useState } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { OfficeStateOutcome } from './contract.ts'
import type { SciFilesKey } from './locales.ts'
import { embeddedViewerUrl } from './office-url.ts'
import { fileName } from './paths.ts'
import css from './OfficeFrame.module.css'

/**
 * The capabilities the Viewer needs, and no others — notably not
 * `allow-popups`, `allow-top-navigation`, `allow-downloads`, or
 * `allow-modals`, so a compromised Viewer bundle cannot navigate the panel
 * away or drive the host page.
 *
 * `allow-same-origin` is required, not decorative: the collaboration client
 * opens a WebSocket to the Gateway through this origin's `/univer-gw/ws`
 * reverse proxy and reads the session cookie that authorizes it. An opaque
 * origin drops that cookie and the socket never authenticates. It does mean
 * the sandbox is a bound on capability, not an origin fence — the frame is
 * first-party content served through our own proxy, and a same-origin frame
 * that also runs scripts can clear its own sandbox attribute. The fence that
 * matters against a hostile target is the source check
 * (`trustedViewerUrl` / `embeddedViewerUrl`), which is why both exist.
 */
const VIEWER_SANDBOX = 'allow-scripts allow-same-origin allow-forms'

/** Owner-supplied frame props: the document to open and the runtime call. */
export interface OfficeFrameProps {
  /** Session whose project directory scopes the document path. */
  sessionId: SessionId
  /** The document to open. */
  path: string
  /** Read the document's collaboration state and Viewer target. */
  officeState: (sessionId: SessionId, path: string) => Promise<OfficeStateOutcome>
  /** Localized office copy. */
  t: Translate<SciFilesKey>
}

/**
 * Render one office document's collaboration frame.
 * @param props - owner-controlled frame props.
 * @returns the header plus the Viewer frame, or the reason there is none.
 */
export function OfficeFrame({ sessionId, path, officeState, t }: OfficeFrameProps) {
  const [state, setState] = useState<OfficeStateOutcome | null>(null)
  // Reading again is the same read: the counter is what makes a second one a
  // new effect, since neither the document nor the reader has changed.
  const [read, setRead] = useState(0)

  useEffect(() => {
    let live = true
    setState(null)
    void officeState(sessionId, path).then((outcome) => {
      if (live) setState(outcome)
    })
    return () => { live = false }
  }, [sessionId, path, officeState, read])

  if (state === null) return <div className={css.note}>{t('office.loading')}</div>
  if (!state.ok || state.viewerUrl === null) {
    return (
      <div className={css.unavailable}>
        <div className={css.note} role="alert">{t('office.unavailable')}</div>
        <button type="button" className={css.retry} onClick={() => { setRead(count => count + 1) }}>
          {t('office.retry')}
        </button>
      </div>
    )
  }

  const editable = state.gatewayRunning
  return (
    <div className={css.root}>
      <div className={editable ? css.connected : css.readonly} role="status">
        {t(editable ? 'office.connected' : 'office.readonly')}
      </div>
      <iframe
        className={css.frame}
        title={t('office.title', { name: fileName(path) })}
        sandbox={VIEWER_SANDBOX}
        src={embeddedViewerUrl(state.viewerUrl, editable)}
      />
    </div>
  )
}
