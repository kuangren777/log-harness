// The two tier texts are model-facing contracts, so what they must NOT say is
// pinned as tightly as what they must. 05-T7 is the third case: the cluster text
// carries none of the original reminder's runtime claims, which described the
// studied platform's workflow tool and are false here.
import { describe, expect, it } from 'vitest'
import {
  CHAPTER_TIER_BALANCED,
  CHAPTER_TIER_CLUSTER,
  SECTION_TIER_BALANCED,
  SECTION_TIER_CLUSTER,
  TIER_SECTIONS,
  TIER_SECTION_ORDER,
} from '../src/index.ts'

describe('the balanced tier text', () => {
  it('opens with the mode name the picker shows', () => {
    expect(CHAPTER_TIER_BALANCED.startsWith('Solo mode (单体) is on for this session')).toBe(true)
    for (const retired of ['Balanced', '均衡', 'cluster', '集群']) {
      expect(CHAPTER_TIER_BALANCED, retired).not.toContain(retired)
    }
  })

  it('routes an over-large task to the suggestion tool rather than to a swarm', () => {
    expect(CHAPTER_TIER_BALANCED).toContain('suggest_tier_upgrade')
    expect(CHAPTER_TIER_BALANCED).toContain('the user decides')
  })

  it('names no tool this tier does not mount', () => {
    for (const absent of ['workflow', 'subagent', 'Task', 'ralph']) {
      expect(CHAPTER_TIER_BALANCED).not.toContain(absent)
    }
  })
})

describe('the cluster tier text', () => {
  it('opens with the mode name the picker shows', () => {
    expect(CHAPTER_TIER_CLUSTER.startsWith('Swarm mode (蜂群) is on for this session')).toBe(true)
    for (const retired of ['Agent cluster', '智能体集群']) {
      expect(CHAPTER_TIER_CLUSTER, retired).not.toContain(retired)
    }
  })

  it('carries none of the original reminder\'s runtime claims (T7)', () => {
    for (const stale of ['notification never arrives', 'TaskOutput', 'resumeFromRunId', 'block=true']) {
      expect(CHAPTER_TIER_CLUSTER).not.toContain(stale)
    }
  })

  it('states the gate the fan-out actually meets', () => {
    expect(CHAPTER_TIER_CLUSTER).toContain('declare_research_plan')
    expect(CHAPTER_TIER_CLUSTER).toContain('one declaration')
  })

  it('keeps the four disciplines that survived: decompose, orchestrate, cross-check, cite', () => {
    expect(CHAPTER_TIER_CLUSTER).toContain('Decompose before you delegate')
    expect(CHAPTER_TIER_CLUSTER).toContain('`workflow` tool')
    expect(CHAPTER_TIER_CLUSTER).toContain('Cross-check')
    expect(CHAPTER_TIER_CLUSTER).toContain('inline source link')
  })
})

describe('the section registry keys', () => {
  it('are distinct and assemble after every sci-prompt chapter', () => {
    expect(SECTION_TIER_BALANCED).not.toBe(SECTION_TIER_CLUSTER)
    expect(TIER_SECTION_ORDER).toBeGreaterThan(165)
  })

  it('pair each tier with its own text', () => {
    expect(TIER_SECTIONS).toEqual({
      balanced: { name: SECTION_TIER_BALANCED, text: CHAPTER_TIER_BALANCED },
      cluster: { name: SECTION_TIER_CLUSTER, text: CHAPTER_TIER_CLUSTER },
    })
  })
})
