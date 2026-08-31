// The two tier texts are model-facing contracts, so what they must NOT say is
// pinned as tightly as what they must. 05-T7 is the third case: the cluster text
// carries none of the original reminder's runtime claims, which described the
// studied platform's workflow tool and are false here.
import { describe, expect, it } from 'vitest'
import {
  CHAPTER_TIER_AUTO,
  CHAPTER_TIER_BALANCED,
  CHAPTER_TIER_CLUSTER,
  SECTION_TIER_AUTO,
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

  // The studied platform's balanced reminder offered an honest exit only for
  // research tasks; on a "reproduce the experiment" task the model built a
  // hollow pipeline and delivered invented numbers
  // (`clawsgo-analysis/CLAWSGO-SCHEDULING.md` §3). The text now names that
  // task class, closes the third path by name, and leaves exactly two exits.
  it('closes the fabricated-result exit for experiment and reproduction tasks', () => {
    expect(CHAPTER_TIER_BALANCED).toContain('a real experiment or reproduction')
    expect(CHAPTER_TIER_BALANCED).toContain('exactly two exits')
    expect(CHAPTER_TIER_BALANCED).toContain('There is no third exit')
    expect(CHAPTER_TIER_BALANCED).toContain('every number produced by code that actually ran')
    expect(CHAPTER_TIER_BALANCED).toContain('is never delivered')
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

  it('states the composition rule the plan tool enforces: an adversary in every swarm, downstream of any producer', () => {
    expect(CHAPTER_TIER_CLUSTER).toContain('adversary (`security` icon)')
    expect(CHAPTER_TIER_CLUSTER).toContain('a plan of producers alone is refused')
    expect(CHAPTER_TIER_CLUSTER).toContain('never the producer\'s own summary')
  })

  it('keeps the four disciplines that survived: decompose, orchestrate, cross-check, cite', () => {
    expect(CHAPTER_TIER_CLUSTER).toContain('Decompose before you delegate')
    expect(CHAPTER_TIER_CLUSTER).toContain('`workflow` tool')
    expect(CHAPTER_TIER_CLUSTER).toContain('Cross-check')
    expect(CHAPTER_TIER_CLUSTER).toContain('inline source link')
  })
})

// The auto text is the one a session reads when the user did not pick a tier:
// it has to carry the resolution step, the raise, the closed third exit, and
// the swarm disciplines, because no other section is assembled beside it.
describe('the auto composition text', () => {
  it('opens with the mode name and routes the first call to resolve_tier', () => {
    expect(CHAPTER_TIER_AUTO.startsWith('Auto mode (自动) is on for this session')).toBe(true)
    expect(CHAPTER_TIER_AUTO).toContain('Before any other tool call')
    expect(CHAPTER_TIER_AUTO).toContain('`resolve_tier`')
  })

  it('names the raise, and closes the fabricated-result exit', () => {
    expect(CHAPTER_TIER_AUTO).toContain('raised mid-session')
    expect(CHAPTER_TIER_AUTO).toContain('a smaller real result with its scope stated, or a raised tier, are the only exits')
  })

  it('carries the swarm disciplines the cluster text states', () => {
    expect(CHAPTER_TIER_AUTO).toContain('`declare_research_plan`')
    expect(CHAPTER_TIER_AUTO).toContain('adversary (`security` icon)')
    expect(CHAPTER_TIER_AUTO).toContain('cite in place')
  })

  it('carries none of the original reminder\'s runtime claims (T7)', () => {
    for (const stale of ['notification never arrives', 'TaskOutput', 'resumeFromRunId', 'block=true']) {
      expect(CHAPTER_TIER_AUTO).not.toContain(stale)
    }
  })
})

describe('the section registry keys', () => {
  it('are distinct and assemble after every sci-prompt chapter', () => {
    expect(new Set([SECTION_TIER_BALANCED, SECTION_TIER_CLUSTER, SECTION_TIER_AUTO]).size).toBe(3)
    expect(TIER_SECTION_ORDER).toBeGreaterThan(165)
  })

  it('pair each tier mode with its own text', () => {
    expect(TIER_SECTIONS).toEqual({
      balanced: { name: SECTION_TIER_BALANCED, text: CHAPTER_TIER_BALANCED },
      cluster: { name: SECTION_TIER_CLUSTER, text: CHAPTER_TIER_CLUSTER },
      auto: { name: SECTION_TIER_AUTO, text: CHAPTER_TIER_AUTO },
    })
  })
})
