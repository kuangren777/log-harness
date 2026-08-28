// The managed block itself: what one entry renders as, what a switched-off
// entry renders as, and what splicing does to a config file that has a block,
// has none, or has a half-written one.
import { describe, expect, it } from 'vitest'
import {
  MANAGED_BLOCK_END,
  MANAGED_BLOCK_START,
  ManagedBlockError,
  managedBlockFault,
  parseManagedBlock,
  renderManagedBlock,
  spliceManagedBlock,
} from '@deepseek-ai/dsh-sci-remote-hosts'
import type { ManagedBlockOptions, RemoteHost } from '@deepseek-ai/dsh-sci-remote-hosts'

const OPTIONS: ManagedBlockOptions = {
  identityDir: '/home/user/.ssh',
  connectTimeoutSeconds: 10,
  serverAliveIntervalSeconds: 30,
}

const GPU: RemoteHost = { alias: 'gpu-lab', hostName: 'gpu.example.com', user: 'ubuntu', enabled: true }
const BOX: RemoteHost = { alias: 'box', hostName: '10.1.2.3', user: 'root', port: 2222, enabled: true }

/** A user's own ssh plumbing, which the block must never touch. */
const OUTSIDE = [
  'Host jump',
  '    HostName jump.example.net',
  '    User operator',
  '',
  'Host behind-jump',
  '    HostName 192.168.1.10',
  '    ProxyJump jump',
  '',
].join('\n')

describe('renderManagedBlock', () => {
  it('renders one entry with the option set the archived skill promises', () => {
    expect(renderManagedBlock([GPU], OPTIONS)).toBe([
      MANAGED_BLOCK_START,
      'Host gpu-lab',
      '    HostName gpu.example.com',
      '    User ubuntu',
      '    IdentityFile /home/user/.ssh/sci-gpu-lab',
      '    IdentitiesOnly yes',
      '    BatchMode yes',
      '    ConnectTimeout 10',
      '    ServerAliveInterval 30',
      '    StrictHostKeyChecking accept-new',
      MANAGED_BLOCK_END,
      '',
    ].join('\n'))
  })

  it('renders a port only for a host that declared one, and sorts entries by alias', () => {
    const block = renderManagedBlock([GPU, BOX], OPTIONS)

    expect(block.split('\n').filter(line => line.startsWith('Host '))).toEqual(['Host box', 'Host gpu-lab'])
    expect(block).toContain('    Port 2222\n')
    expect(block.split('Host gpu-lab')[1]).not.toContain('Port')
  })

  it('comments a switched-off host out instead of deleting it', () => {
    const block = renderManagedBlock([{ ...GPU, enabled: false }], OPTIONS)

    expect(block).toContain('# Host gpu-lab\n')
    expect(block).toContain('#     BatchMode yes\n')
    expect(block.split('\n').some(line => line === 'Host gpu-lab')).toBe(false)
  })

  it('renders an empty roster as the two markers alone', () => {
    expect(renderManagedBlock([], OPTIONS)).toBe(`${MANAGED_BLOCK_START}\n${MANAGED_BLOCK_END}\n`)
  })
})

describe('parseManagedBlock', () => {
  it('reads back exactly what it rendered, switched-off state included', () => {
    const hosts = [BOX, { ...GPU, enabled: false }]

    expect(parseManagedBlock(renderManagedBlock(hosts, OPTIONS))).toEqual([BOX, { ...GPU, enabled: false }])
  })

  it('reads the block out of a config file that has other entries around it', () => {
    const text = spliceManagedBlock(OUTSIDE, renderManagedBlock([GPU], OPTIONS))

    expect(parseManagedBlock(text)).toEqual([GPU])
  })

  it('ignores Host entries outside the block', () => {
    expect(parseManagedBlock(OUTSIDE)).toEqual([])
  })

  it('drops an entry a hand edit left without a HostName or a User', () => {
    const text = [MANAGED_BLOCK_START, 'Host half', '    HostName only.example.com', MANAGED_BLOCK_END, ''].join('\n')

    expect(parseManagedBlock(text)).toEqual([])
  })

  it('ignores an option line that arrives before any Host line', () => {
    const text = [MANAGED_BLOCK_START, '    User stray', 'Host gpu-lab', '    HostName gpu.example.com', '    User ubuntu', MANAGED_BLOCK_END, ''].join('\n')

    expect(parseManagedBlock(text)).toEqual([GPU])
  })

  it('ignores a keyword line that carries no value', () => {
    const text = [MANAGED_BLOCK_START, 'Host gpu-lab', '    HostName gpu.example.com', '    User ubuntu', '    Compression', MANAGED_BLOCK_END, ''].join('\n')

    expect(parseManagedBlock(text)).toEqual([GPU])
  })

  it('ignores a non-numeric Port a hand edit left behind', () => {
    const text = [MANAGED_BLOCK_START, 'Host gpu-lab', '    HostName gpu.example.com', '    User ubuntu', '    Port ssh', MANAGED_BLOCK_END, ''].join('\n')

    expect(parseManagedBlock(text)).toEqual([GPU])
  })
})

describe('spliceManagedBlock', () => {
  it('appends the block when the file has none', () => {
    const block = renderManagedBlock([GPU], OPTIONS)

    expect(spliceManagedBlock(OUTSIDE, block)).toBe(OUTSIDE + block)
  })

  it('is the block itself when the file is empty', () => {
    const block = renderManagedBlock([GPU], OPTIONS)

    expect(spliceManagedBlock('', block)).toBe(block)
  })

  it('closes a final line that had no newline before appending', () => {
    const block = renderManagedBlock([GPU], OPTIONS)

    expect(spliceManagedBlock('Host jump', block)).toBe(`Host jump\n${block}`)
  })

  it('replaces an existing block in place and leaves a ProxyJump chain around it byte for byte', () => {
    const first = spliceManagedBlock(`${OUTSIDE}${MANAGED_BLOCK_START}\n${MANAGED_BLOCK_END}\ntrailing note\n`, renderManagedBlock([GPU], OPTIONS))
    const second = spliceManagedBlock(first, renderManagedBlock([GPU, BOX], OPTIONS))

    expect(second.startsWith(OUTSIDE)).toBe(true)
    expect(second.endsWith('trailing note\n')).toBe(true)
    expect(parseManagedBlock(second)).toEqual([BOX, GPU])
  })

  it('is idempotent for the same roster', () => {
    const block = renderManagedBlock([GPU, BOX], OPTIONS)
    const once = spliceManagedBlock(OUTSIDE, block)

    expect(spliceManagedBlock(once, block)).toBe(once)
  })

  it('refuses a file whose start marker has no end marker', () => {
    const broken = `${OUTSIDE}${MANAGED_BLOCK_START}\nHost gpu-lab\n`

    expect(() => spliceManagedBlock(broken, renderManagedBlock([], OPTIONS))).toThrow(ManagedBlockError)
  })

  it('refuses a file whose end marker precedes its start marker', () => {
    const broken = `${MANAGED_BLOCK_END}\n${OUTSIDE}${MANAGED_BLOCK_START}\n`

    expect(() => spliceManagedBlock(broken, renderManagedBlock([], OPTIONS))).toThrow(/end marker/)
  })

  it('refuses a file carrying an end marker with no start marker above it', () => {
    expect(() => spliceManagedBlock(`${OUTSIDE}${MANAGED_BLOCK_END}\n`, renderManagedBlock([], OPTIONS)))
      .toThrow(/no start marker/)
  })

  it('reports a dangling start marker from parseManagedBlock too', () => {
    expect(() => parseManagedBlock(`${MANAGED_BLOCK_START}\nHost gpu-lab\n`)).toThrow(ManagedBlockError)
  })

  it('reports a consistent file as having no fault', () => {
    expect(managedBlockFault(spliceManagedBlock(OUTSIDE, renderManagedBlock([GPU], OPTIONS)))).toBeUndefined()
  })
})
