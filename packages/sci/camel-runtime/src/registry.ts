/**
 * The variant registry: one JSON file in the workspace naming every slot and
 * the AgentENV sandbox behind it. The workspace is the only durable copy the
 * user owns, so the slot table lives there rather than in the harness home,
 * and a new harness process finds the same variants the last one left.
 * @module @deepseek-ai/dsh-camel-runtime/registry
 */

import { posix } from 'node:path'
import { FileNotFoundError } from '@deepseek-ai/dsh-e2b'
import type { Sandbox } from '@deepseek-ai/dsh-e2b'
import type { VariantRecord, VariantRegistryFile } from './types.ts'

/** File name of the registry inside the variants directory. */
export const REGISTRY_FILE = 'registry.json'

/** Shape a slot name must have: it becomes a directory name the model reads back. */
export const VARIANT_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/

/**
 * Parse the registry file's text, refusing anything that is not the recorded
 * format: a corrupt table must not silently read as "no variants" and let the
 * engine start a second sandbox for every slot.
 * @param text - the file's content.
 * @param path - the file's path, named in the error.
 * @returns the records.
 * @throws when the text is not a version-1 registry.
 */
export function parseRegistry(text: string, path: string): VariantRecord[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error: unknown) {
    throw new Error(`camel-runtime: ${path} is not valid JSON`, { cause: error })
  }
  const file = parsed as Partial<VariantRegistryFile> | null
  if (file === null || typeof file !== 'object' || file.version !== 1 || !Array.isArray(file.variants)) {
    throw new Error(`camel-runtime: ${path} is not a version-1 variant registry; move it aside to start with no variants`)
  }
  for (const record of file.variants as unknown[]) {
    const candidate = record as Partial<VariantRecord> | null
    if (candidate === null || typeof candidate !== 'object'
      || typeof candidate.name !== 'string' || !VARIANT_NAME.test(candidate.name)
      || typeof candidate.project !== 'string' || typeof candidate.sandboxID !== 'string'
      || typeof candidate.templateID !== 'string' || typeof candidate.createdAt !== 'string' || typeof candidate.lastUsedAt !== 'string') {
      throw new Error(`camel-runtime: ${path} holds a malformed variant record: ${JSON.stringify(record)}`)
    }
  }
  return file.variants as VariantRecord[]
}

/**
 * Serialize records as the registry file.
 * @param variants - records in slot order.
 * @returns the file text, newline-terminated.
 */
export function serializeRegistry(variants: readonly VariantRecord[]): string {
  const file: VariantRegistryFile = { version: 1, variants }
  return `${JSON.stringify(file, null, 2)}\n`
}

/**
 * The registry file behind one workspace, read and written through the
 * workspace sandbox. Every mutation is a load, change, save under one
 * in-process lock, so two tool calls in one harness never interleave a write.
 */
export class VariantRegistry {
  /** Absolute workspace path of the registry file. */
  readonly path: string
  private lock: Promise<void> = Promise.resolve()

  /**
   * @param workspace - the workspace sandbox, awaited per operation.
   * @param variantsDir - absolute directory holding the registry and collected results.
   */
  constructor(
    private readonly workspace: () => Promise<Sandbox>,
    variantsDir: string,
  ) {
    this.path = posix.join(variantsDir, REGISTRY_FILE)
  }

  /**
   * Read every record; a missing file is an empty registry.
   * @returns the records in slot order.
   * @throws when the file exists but is not a registry.
   */
  async load(): Promise<VariantRecord[]> {
    const sandbox = await this.workspace()
    let text: string
    try {
      text = await sandbox.files.read(this.path)
    } catch (error: unknown) {
      if (error instanceof FileNotFoundError) return []
      throw error
    }
    return parseRegistry(text, this.path)
  }

  /**
   * Run one load-change-save transaction under the registry lock.
   * @param change - receives the current records and returns the records to write, or `undefined` to write nothing.
   * @returns whatever `change` produced alongside the records.
   */
  async update<T>(change: (variants: VariantRecord[]) => Promise<{ variants?: VariantRecord[]; result: T }>): Promise<T> {
    const previous = this.lock
    let release!: () => void
    this.lock = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      const current = await this.load()
      const { variants, result } = await change(current)
      if (variants !== undefined) {
        const sandbox = await this.workspace()
        await sandbox.files.write(this.path, serializeRegistry(variants))
      }
      return result
    } finally {
      release()
    }
  }
}
