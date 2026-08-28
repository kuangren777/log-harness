/**
 * Failure-path tests for the lazy packaged-ripgrep resolution. The success
 * path (the real `@vscode/ripgrep` module) is exercised throughout
 * tools.spec.ts; here the module is mocked to throw at evaluation, proving a
 * missing or corrupt platform package (`--omit=optional`, partial install)
 * surfaces as a per-call `SEARCH_FAILED` — not a composition-load failure.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { resolveRgCommand, resolveRgPath, runRipgrep } from '@deepseek-ai/dsh-tool-fs-search'
import type { RipgrepRunLimits } from '@deepseek-ai/dsh-tool-fs-search'

/** The spawn budgets these failure paths never reach past. */
const LIMITS: RipgrepRunLimits = { rawOutputMaxBytes: 1_000_000, graceMs: 3_000, stderrMaxBytes: 64 * 1024 }

// Any access to the mocked module's surface throws — the shape a missing
// platform package produces at module evaluation.
vi.mock('@vscode/ripgrep', () => new Proxy({}, {
  get() {
    throw new Error('platform package @vscode/ripgrep-win32-x64 is not installed')
  },
}))

describe('lazy packaged-ripgrep resolution', () => {
  it('fails the first search call with SEARCH_FAILED instead of failing module load', async () => {
    // The resolution rejects before any spawn, so no subprocess service is needed.
    const controller = new AbortController()
    const exec = { signal: controller.signal, name: 'glob', callId: CallId('missing-platform-package') } as unknown as ToolExecution

    await expect(runRipgrep(new Context(), exec, 'glob', ['--files'], LIMITS))
      .rejects.toMatchObject({ name: 'SearchError', code: 'SEARCH_FAILED' })
  })

  it('keeps failing every subsequent call (the resolution is memoized)', async () => {
    await expect(resolveRgPath()).rejects.toThrow(/platform package/)
    await expect(resolveRgPath()).rejects.toThrow(/platform package/)
  })

  it('names the rgPath remedy when the packaged resolution is the thing that failed', async () => {
    const exec = {
      signal: new AbortController().signal, name: 'glob', callId: CallId('missing-platform-package-message'),
    } as unknown as ToolExecution

    await expect(runRipgrep(new Context(), exec, 'glob', ['--files'], LIMITS))
      .rejects.toThrow(/packaged ripgrep binary could not be resolved.*`rgPath` config/s)
  })

  it('never consults the packaged binary once rgPath names a command', async () => {
    // The mocked module throws on any access, so a resolution that reached it
    // would reject here; a configured command is returned verbatim instead.
    await expect(resolveRgCommand('rg')).resolves.toBe('rg')
    await expect(resolveRgCommand('/sandbox/bin/rg')).resolves.toBe('/sandbox/bin/rg')
  })
})
