// Shared fixtures for the delivery tests: the sandbox layout the sci profile
// installs, an in-memory DeliveryFileSystem, and minimal valid manifests taken
// from the sci-manifest fixture set.
import { normalizeSegments } from '@deepseek-ai/dsh-sci-deliver'
import type { DeliveryFileSystem, DeliveryPathConfig } from '@deepseek-ai/dsh-sci-deliver'

export const PROJECT_ROOT = '/home/user/sci/projects'
export const PROJECT = `${PROJECT_ROOT}/p1`
export const WORKSPACE = `${PROJECT}/workspace`
export const SPOOL_DIR = '/home/user/sci/.sci/spool'
export const SNAPSHOT_DIR = '/home/user/sci/.sci/deliveries'

export const PATHS: DeliveryPathConfig = {
  projectRoot: PROJECT_ROOT,
  deliveryDir: 'workspace',
  bundleDirs: { papers: 'papers', sciplots: 'sciplots' },
}

export const PAPER_MANIFEST = JSON.stringify({
  version: 1,
  title: 'Attention-based dose-response modeling',
  entry: 'src/main.tex',
  versions: [],
  createdAt: '2026-07-23T08:00:00Z',
  updatedAt: '2026-07-23T08:00:00Z',
})

export const SCIPLOT_MANIFEST = JSON.stringify({
  version: 1,
  title: 'Treatment effect by group',
  language: 'en',
  style: 'nature',
  entry: 'code/plot.py',
  history: [],
  annotations: [],
})

export const CANVAS_MANIFEST = JSON.stringify({
  version: 1,
  nodes: [
    { id: 'n1', type: 'image', position: { x: 0, y: 0 }, data: { src: 'assets/hero.png', title: 'Cover' } },
  ],
  edges: [],
})

export const DANGLING_CANVAS_MANIFEST = JSON.stringify({
  version: 1,
  nodes: [{ id: 'n1', type: 'text', position: { x: 0, y: 0 }, data: { markdown: 'one', title: 'One' } }],
  edges: [{ id: 'e1', source: 'n1', target: 'n9' }],
})

/** Canonicalize a path the way the memory filesystem keys it. */
function key(path: string, cwd?: string): string {
  const combined = path.startsWith('/') || cwd === undefined ? path : `${cwd}/${path}`
  return `/${normalizeSegments(combined).join('/')}`
}

/** An in-memory stand-in for the sandbox filesystem, keyed by canonical path. */
export class MemoryFileSystem implements DeliveryFileSystem {
  readonly files = new Map<string, Buffer>()

  /** Seed one file. */
  put(path: string, content: string | Buffer): this {
    this.files.set(key(path), typeof content === 'string' ? Buffer.from(content, 'utf8') : content)
    return this
  }

  /** Read one file back as text, or undefined when absent. */
  peek(path: string): string | undefined {
    return this.files.get(key(path))?.toString('utf8')
  }

  /** Every stored path, sorted. */
  paths(): string[] {
    return [...this.files.keys()].sort()
  }

  resolve = (path: string, cwd?: string): Promise<string> => Promise.resolve(key(path, cwd))

  exists = (path: string): Promise<boolean> => {
    const target = key(path)
    return Promise.resolve(this.files.has(target) || this.isDirectory(target))
  }

  isFile = (path: string): Promise<boolean> => Promise.resolve(this.files.has(key(path)))

  readText = (path: string): Promise<string> => {
    const content = this.files.get(key(path))
    if (content === undefined) throw new Error(`memory filesystem: ${path} is absent`)
    return Promise.resolve(content.toString('utf8'))
  }

  readBytes = (path: string, maxBytes: number): Promise<Uint8Array> => {
    const content = this.files.get(key(path))
    if (content === undefined) throw new Error(`memory filesystem: ${path} is absent`)
    if (content.byteLength > maxBytes) throw new Error(`memory filesystem: ${path} exceeds ${maxBytes} bytes`)
    return Promise.resolve(new Uint8Array(content))
  }

  writeText = (path: string, content: string): Promise<void> => {
    this.files.set(key(path), Buffer.from(content, 'utf8'))
    return Promise.resolve()
  }

  listFiles = (path: string): Promise<readonly string[]> => {
    const prefix = `${key(path)}/`
    const names = [...this.files.keys()]
      .filter(stored => stored.startsWith(prefix) && !stored.slice(prefix.length).includes('/'))
      .map(stored => stored.slice(prefix.length))
    return Promise.resolve(names.sort())
  }

  listAssets = (path: string, depth: number): Promise<ReadonlySet<string>> => {
    const prefix = `${key(path)}/`
    const found = new Set<string>()
    for (const stored of this.files.keys()) {
      if (!stored.startsWith(prefix)) continue
      const relative = stored.slice(prefix.length)
      if (relative.split('/').length <= depth) found.add(relative)
    }
    return Promise.resolve(found)
  }

  private isDirectory(target: string): boolean {
    const prefix = `${target}/`
    return [...this.files.keys()].some(stored => stored.startsWith(prefix))
  }
}
