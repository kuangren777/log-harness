import type { JsonValue } from '../../service/types.ts'

/** Unit and collaboration scope passed to the package-local worker. */
export interface UnitContentWorkerTarget {
  /** Origin the worker reaches the collaboration Gateway on. */
  readonly gatewayOrigin: string
  /** How long the worker waits for a collaboration commit acknowledgement. */
  readonly commitTimeoutMs: number
  /** Gateway key of the owning file. */
  readonly fileKey: string
  /** Absolute path of the owning file, used in diagnostics. */
  readonly filePath: string
  /** The Unit the operation reads or writes. */
  readonly unitId: string
  /** Numeric Univer type of that Unit. */
  readonly unitType: number
  /** The worktree to operate in, or undefined for trunk. */
  readonly worktreeId?: string
}

/** Inspection query understood by the bundled SDK inspector. */
export type UnitContentInspectionQuery =
  | { readonly kind: 'workbook' }
  | { readonly kind: 'presentation' }
  | { readonly kind: 'document' }
  | {
    readonly kind: 'worksheet-range'
    readonly ranges: readonly [{ readonly range: string; readonly worksheet: { readonly name: string } | { readonly index: number } }]
  }

/** One operation accepted by the package-local worker. */
export type UnitContentWorkerRequest =
  | (UnitContentWorkerTarget & { readonly operation: 'inspect'; readonly query: UnitContentInspectionQuery })
  | (UnitContentWorkerTarget & { readonly operation: 'execute'; readonly code: string; readonly worktreeId: string })
  | (UnitContentWorkerTarget & { readonly operation: 'export'; readonly outputPath: string })
  | (UnitContentWorkerTarget & { readonly operation: 'render-source' })
  | { readonly operation: 'import'; readonly sourcePath: string; readonly unitType: number }

/** Process response envelope emitted once on stdout. */
export type UnitContentWorkerEnvelope =
  | { readonly ok: true; readonly result: JsonValue }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/**
 * Validate the untrusted process response.
 * @param value - the parsed stdout payload.
 * @returns the envelope, or null when the payload is not one.
 */
export function parseUnitContentWorkerEnvelope(value: unknown): UnitContentWorkerEnvelope | null {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return null
  if (value.ok && 'result' in value) return value as UnitContentWorkerEnvelope
  if (value.ok || !isRecord(value.error)) return null
  if (typeof value.error.code !== 'string' || typeof value.error.message !== 'string') return null
  return value as UnitContentWorkerEnvelope
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
