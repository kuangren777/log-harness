// The registry is the slot table the user's workspace owns: a missing file is
// an empty table, a corrupt one is refused rather than read as empty (which
// would let the engine start a second sandbox behind every slot), and every
// mutation is one load-change-save under a lock.
import { describe, expect, it } from 'vitest'
import { FileNotFoundError } from '@deepseek-ai/dsh-e2b'
import type { Sandbox } from '@deepseek-ai/dsh-e2b'
import { REGISTRY_FILE, VariantRegistry, parseRegistry, serializeRegistry } from '@deepseek-ai/dsh-camel-runtime'
import type { VariantRecord } from '@deepseek-ai/dsh-camel-runtime'

const RECORD: VariantRecord = {
  name: 'a',
  project: 'projects/p1',
  sandboxID: 'sb-1',
  templateID: 'sci',
  createdAt: '2026-08-30T00:00:00.000Z',
  lastUsedAt: '2026-08-30T00:00:00.000Z',
}

/** An in-memory file store standing in for the workspace sandbox's files API. */
interface MemoryWorkspace { sandbox: Sandbox; files: Map<string, string>; reads: number; writes: number }

function memoryWorkspace(initial: Record<string, string> = {}): MemoryWorkspace {
  const files = new Map(Object.entries(initial))
  const store = {
    files,
    reads: 0,
    writes: 0,
    sandbox: {
      files: {
        read: (path: string) => {
          store.reads++
          const text = files.get(path)
          return text === undefined ? Promise.reject(new FileNotFoundError(path)) : Promise.resolve(text)
        },
        write: (path: string, data: string) => {
          store.writes++
          files.set(path, data)
          return Promise.resolve(undefined)
        },
      },
    } as unknown as Sandbox,
  }
  return store
}

describe('parseRegistry', () => {
  it('round-trips through serializeRegistry', () => {
    expect(parseRegistry(serializeRegistry([RECORD]), '/w/r.json')).toEqual([RECORD])
    expect(serializeRegistry([]).endsWith('\n')).toBe(true)
  })

  it.each([
    { label: 'invalid JSON', text: '{', failure: 'camel-runtime: /w/r.json is not valid JSON' },
    { label: 'empty text', text: '', failure: 'camel-runtime: /w/r.json is not valid JSON' },
    { label: 'a non-object', text: '42', failure: 'camel-runtime: /w/r.json is not a version-1 variant registry; move it aside to start with no variants' },
    { label: 'null', text: 'null', failure: 'is not a version-1 variant registry' },
    { label: 'another version', text: '{"version":2,"variants":[]}', failure: 'is not a version-1 variant registry' },
    { label: 'variants that are not a list', text: '{"version":1,"variants":{}}', failure: 'is not a version-1 variant registry' },
    { label: 'a record with a bad name', text: JSON.stringify({ version: 1, variants: [{ ...RECORD, name: 'Bad Name' }] }), failure: 'holds a malformed variant record: {"name":"Bad Name"' },
    { label: 'a record missing sandboxID', text: JSON.stringify({ version: 1, variants: [{ ...RECORD, sandboxID: 7 }] }), failure: 'holds a malformed variant record' },
    { label: 'a null record', text: '{"version":1,"variants":[null]}', failure: 'holds a malformed variant record: null' },
  ])('refuses $label', ({ text, failure }) => {
    expect(() => parseRegistry(text, '/w/r.json')).toThrow(failure)
  })
})

describe('VariantRegistry', () => {
  it('reads an absent file as no variants and keeps the path under the variants directory', async () => {
    const store = memoryWorkspace()
    const registry = new VariantRegistry(() => Promise.resolve(store.sandbox), '/w/.sci/variants')
    expect(registry.path).toBe(`/w/.sci/variants/${REGISTRY_FILE}`)
    await expect(registry.load()).resolves.toEqual([])
  })

  it('rethrows a read failure that is not "file missing"', async () => {
    const sandbox = { files: { read: () => Promise.reject(new Error('envd down')) } } as unknown as Sandbox
    const registry = new VariantRegistry(() => Promise.resolve(sandbox), '/w/.sci/variants')
    await expect(registry.load()).rejects.toThrow('envd down')
  })

  it('writes the changed records and returns the change result', async () => {
    const store = memoryWorkspace()
    const registry = new VariantRegistry(() => Promise.resolve(store.sandbox), '/w/.sci/variants')
    const result = await registry.update(variants => Promise.resolve({ variants: [...variants, RECORD], result: 'added' }))
    expect(result).toBe('added')
    expect(store.files.get(registry.path)).toBe(serializeRegistry([RECORD]))
    await expect(registry.load()).resolves.toEqual([RECORD])
  })

  it('writes nothing when the change returns no records', async () => {
    const store = memoryWorkspace({ '/w/.sci/variants/registry.json': serializeRegistry([RECORD]) })
    const registry = new VariantRegistry(() => Promise.resolve(store.sandbox), '/w/.sci/variants')
    await expect(registry.update(variants => Promise.resolve({ result: variants.length }))).resolves.toBe(1)
    expect(store.writes).toBe(0)
  })

  it('serializes concurrent updates so neither loses the other\'s write', async () => {
    const store = memoryWorkspace()
    const registry = new VariantRegistry(() => Promise.resolve(store.sandbox), '/w/.sci/variants')
    const slow = registry.update(async (variants) => {
      await new Promise(resolve => setTimeout(resolve, 20))
      return { variants: [...variants, RECORD], result: 'slow' }
    })
    const fast = registry.update(variants => Promise.resolve({ variants: [...variants, { ...RECORD, name: 'b', sandboxID: 'sb-2' }], result: 'fast' }))
    await expect(Promise.all([slow, fast])).resolves.toEqual(['slow', 'fast'])
    expect((await registry.load()).map(variant => variant.name)).toEqual(['a', 'b'])
  })

  it('releases the lock when a change throws, so the next update proceeds', async () => {
    const store = memoryWorkspace()
    const registry = new VariantRegistry(() => Promise.resolve(store.sandbox), '/w/.sci/variants')
    await expect(registry.update(() => Promise.reject(new Error('refused')))).rejects.toThrow('refused')
    await expect(registry.update(() => Promise.resolve({ result: 'ok' }))).resolves.toBe('ok')
  })
})
