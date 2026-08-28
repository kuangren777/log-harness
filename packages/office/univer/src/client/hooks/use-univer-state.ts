import * as React from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { FileState } from '../../shared/wire/state.ts'
import { getFileState, getUniverStatus, isMissingUniverFile, startGateway } from '../api/univer-api.ts'

/**
 * Poll collaboration state for a stable list of files.
 * @param files - absolute paths to track; identity may change, contents drive the poll.
 * @param sessionId - the session whose workspace authorizes each read.
 * @param intervalMs - delay between polls.
 * @returns the latest state per file, the files the Host reports gone, and a
 *   setter that folds in a state a surface already received.
 */
export function useUniverStates(files: readonly string[], sessionId: SessionId, intervalMs = 900): {
  readonly states: Readonly<Record<string, FileState>>
  readonly missingFiles: ReadonlySet<string>
  readonly applyState: (state: FileState) => void
} {
  const [states, setStates] = React.useState<Record<string, FileState>>({})
  const [missing, setMissing] = React.useState<Record<string, true>>({})
  const key = files.join('\u0000')
  React.useEffect(() => {
    if (key === '') {
      setStates({})
      setMissing({})
      return
    }
    const trackedFiles = key.split('\u0000')
    setStates({})
    setMissing({})
    let active = true
    const poll = async (): Promise<void> => {
      for (const file of trackedFiles) {
        try {
          const state = await getFileState(file, sessionId)
          if (!active) return
          setStates(previous => ({ ...previous, [file]: state }))
          setMissing((previous) => {
            if (previous[file] === undefined) return previous
            const next = { ...previous }
            // Immutable update of a plain state record; a Map here would change
            // the type every consumer of this hook reads.
            // oxlint-disable-next-line typescript/no-dynamic-delete
            delete next[file]
            return next
          })
        } catch (error) {
          if (!active) return
          if (isMissingUniverFile(error)) {
            setStates((previous) => {
              if (previous[file] === undefined) return previous
              const next = { ...previous }
              // oxlint-disable-next-line typescript/no-dynamic-delete -- see above.
              delete next[file]
              return next
            })
            setMissing(previous => previous[file] === true ? previous : { ...previous, [file]: true })
          }
        }
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), intervalMs)
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') void poll()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      active = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [key, sessionId, intervalMs])
  return {
    states,
    missingFiles: React.useMemo(() => new Set(Object.keys(missing)), [missing]),
    applyState: React.useCallback((state: FileState) => {
      setStates(previous => ({ ...previous, [state.file]: state }))
      setMissing((previous) => {
        if (previous[state.file] === undefined) return previous
        const next = { ...previous }
        // oxlint-disable-next-line typescript/no-dynamic-delete -- see above.
        delete next[state.file]
        return next
      })
    }, []),
  }
}

/**
 * Gateway state and start action used by preview surfaces.
 * @returns the current Gateway phase and a start action that refreshes it.
 */
export function useGatewayStatus(): {
  readonly phase: 'checking' | 'stopped' | 'starting' | 'running' | 'failed'
  readonly start: () => Promise<void>
} {
  const [phase, setPhase] = React.useState<'checking' | 'stopped' | 'starting' | 'running' | 'failed'>('checking')
  React.useEffect(() => {
    let active = true
    void getUniverStatus().then((status) => {
      if (active) setPhase(status.gateway.phase)
    }).catch(() => {
      if (active) setPhase('failed')
    })
    return () => { active = false }
  }, [])
  const start = React.useCallback(async () => {
    setPhase('starting')
    try {
      const result = await startGateway()
      setPhase(result.ok ? 'running' : 'failed')
    } catch {
      setPhase('failed')
    }
  }, [])
  return { phase, start }
}
