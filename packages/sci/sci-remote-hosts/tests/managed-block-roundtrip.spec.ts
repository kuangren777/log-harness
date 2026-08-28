// The bidirectional guarantee, as a property over generated inputs: whatever a
// user wrote outside the markers survives an arbitrary rewrite of the block
// byte for byte, and whatever the block held reads back as the roster that was
// written into it. The generator is a seeded PRNG so a failure is reproducible
// from the printed seed alone.
import { describe, expect, it } from 'vitest'
import { parseManagedBlock, renderManagedBlock, spliceManagedBlock } from '@deepseek-ai/dsh-sci-remote-hosts'
import type { ManagedBlockOptions, RemoteHost } from '@deepseek-ai/dsh-sci-remote-hosts'

const OPTIONS: ManagedBlockOptions = {
  identityDir: '/home/user/.ssh',
  connectTimeoutSeconds: 10,
  serverAliveIntervalSeconds: 30,
}

const ALIASES = ['gpu-lab', 'box', 'a1', 'lab-2', 'zeta', 'frp-node']
const USERS = ['ubuntu', 'root', 'operator', 'sci']

/**
 * Lines a user might have written outside the block, including ones that look
 * like managed entries and one `ProxyJump` chain.
 */
const OUTSIDE_LINES = [
  'Host jump',
  '    HostName jump.example.net',
  '    ProxyJump bastion',
  '    User operator',
  '',
  '# a comment the user wrote',
  'Host gpu-lab',
  '    LocalForward 8888 localhost:8888',
  '\t# a tab-indented note',
  'Match host *.internal',
]

/**
 * Deterministic PRNG so one failing case is reproducible from its seed.
 * @param seed - the 32-bit state to start from.
 * @returns a function yielding the next value in `[0, 1)`.
 */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ state >>> 15, 1 | state)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4_294_967_296
  }
}

/**
 * Draw one arbitrary roster of distinct hosts.
 * @param next - the seeded generator.
 * @returns between zero and four hosts, each with distinct aliases.
 */
function hosts(next: () => number): RemoteHost[] {
  const chosen = ALIASES.filter(() => next() < 0.5).slice(0, 4)
  return chosen.map(alias => ({
    alias,
    hostName: `${alias}.example.com`,
    user: USERS[Math.floor(next() * USERS.length)] as string,
    ...next() < 0.5 ? { port: 1 + Math.floor(next() * 65_535) } : {},
    enabled: next() < 0.5,
  }))
}

/**
 * Draw one arbitrary run of user-owned lines.
 * @param next - the seeded generator.
 * @returns the lines as one text, empty or newline-terminated.
 */
function outside(next: () => number): string {
  const lines = OUTSIDE_LINES.filter(() => next() < 0.5)
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`
}

/**
 * The roster a rendered block reads back as: alias order, ports and switches kept.
 * @param roster - the hosts that were written.
 * @returns the same hosts in the order the block stores them.
 */
function expected(roster: readonly RemoteHost[]): RemoteHost[] {
  return [...roster].sort((left, right) => left.alias < right.alias ? -1 : 1)
}

describe('managed-block round trip', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8].map(seed => ({ seed })))(
    'keeps outside content byte for byte across a rewrite (seed $seed)',
    ({ seed }) => {
      const next = random(seed)
      for (let round = 0; round < 40; round += 1) {
        const head = outside(next)
        const tail = outside(next)
        const before = hosts(next)
        const after = hosts(next)
        const existing = head + renderManagedBlock(before, OPTIONS) + tail

        const result = spliceManagedBlock(existing, renderManagedBlock(after, OPTIONS))

        expect(result).toBe(head + renderManagedBlock(after, OPTIONS) + tail)
        expect(parseManagedBlock(result)).toEqual(expected(after))
      }
    },
  )

  it.each([1, 2, 3, 4, 5, 6, 7, 8].map(seed => ({ seed })))(
    'appends to a file with no block and still leaves it intact (seed $seed)',
    ({ seed }) => {
      const next = random(seed)
      for (let round = 0; round < 40; round += 1) {
        const text = outside(next)
        const roster = hosts(next)

        const result = spliceManagedBlock(text, renderManagedBlock(roster, OPTIONS))

        expect(result).toBe(text + renderManagedBlock(roster, OPTIONS))
        expect(parseManagedBlock(result)).toEqual(expected(roster))
        expect(spliceManagedBlock(result, renderManagedBlock(roster, OPTIONS))).toBe(result)
      }
    },
  )
})
