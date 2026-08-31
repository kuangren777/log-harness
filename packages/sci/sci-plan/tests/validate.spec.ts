// Every refusal names the agent index, id, or edge that caused it: one rejected
// call has to be enough for the model to write a correct plan on the next one.
import { describe, expect, it } from 'vitest'
import { validatePlan } from '@deepseek-ai/dsh-sci-plan'
import type { PlanInput, PlanValidation } from '@deepseek-ai/dsh-sci-plan'
import { ARCHIVED_INSTALL, ARCHIVED_SURVEY, AUDITED_INSTALL } from './archived-calls.ts'

/** One well-formed agent — an adversary, so the composition rule holds by default and a case only has to state the field it is testing. */
function agent(id: string, overrides: Partial<PlanInput['agents'][number]> = {}): PlanInput['agents'][number] {
  return { id, name: `card ${id}`, icon: 'security', task: `do ${id}`, ...overrides }
}

/** The refusal messages of a plan expected to be rejected. */
function errorsOf(result: PlanValidation): readonly string[] {
  return result.ok ? [] : result.errors
}

describe('sci-plan validatePlan', () => {
  it('accepts a plan of independent agents and keeps declaration order', () => {
    const result = validatePlan({ agents: [agent('a'), agent('b')] })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected the plan to validate')
    expect(result.plan.agents.map(entry => entry.id)).toEqual(['a', 'b'])
    expect(result.plan.edges).toEqual([])
    expect(result.order.map(entry => entry.id)).toEqual(['a', 'b'])
  })

  it('trims every text field and matches edges against the trimmed ids', () => {
    const result = validatePlan({
      agents: [agent('  a  ', { name: '  card  ', task: '  work  ' }), agent('b')],
      edges: [['  a  ', ' b ']],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected the plan to validate')
    expect(result.plan.agents[0]).toEqual({ id: 'a', name: 'card', icon: 'security', task: 'work' })
    expect(result.plan.edges).toEqual([['a', 'b']])
  })

  it('sorts the run order so a dependency precedes its dependent', () => {
    const result = validatePlan({ agents: [agent('verifier'), agent('installer')], edges: [['installer', 'verifier']] })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected the plan to validate')
    expect(result.order.map(entry => entry.id)).toEqual(['installer', 'verifier'])
    expect(result.plan.agents.map(entry => entry.id)).toEqual(['verifier', 'installer'])
  })

  it('refuses an empty agent list', () => {
    expect(errorsOf(validatePlan({ agents: [] }))).toEqual(['agents is empty; a plan must declare at least one agent'])
  })

  it('refuses a repeated id and names both positions', () => {
    expect(errorsOf(validatePlan({ agents: [agent('scan'), agent('scan')] }))).toEqual([
      'agents[1].id "scan" repeats the id already declared at agents[0]; ids must be unique',
    ])
  })

  it('refuses blank id, name, and task, naming each field position', () => {
    expect(errorsOf(validatePlan({ agents: [agent('  ', { name: ' ', task: '' })] }))).toEqual([
      'agents[0].id is empty; every agent needs an id for edges to reference',
      'agents[0].name is empty; it is the card title the user reads',
      'agents[0].task is empty; it is the one sentence saying what this agent does',
    ])
  })

  it('refuses a dangling edge on either end, naming the id no agent declares', () => {
    expect(errorsOf(validatePlan({ agents: [agent('a')], edges: [['ghost', 'a'], ['a', 'phantom'], ['x', 'y']] }))).toEqual([
      'edges[0] starts at "ghost", which no agent declares',
      'edges[1] ends at "phantom", which no agent declares',
      'edges[2] starts at "x", which no agent declares',
      'edges[2] ends at "y", which no agent declares',
    ])
  })

  it('refuses a self-edge without also calling it dangling', () => {
    expect(errorsOf(validatePlan({ agents: [agent('a')], edges: [['a', 'a']] }))).toEqual([
      'edges[0] points "a" at itself; an agent cannot depend on itself',
    ])
  })

  it('refuses an edge that is not a pair, naming how many entries it had', () => {
    expect(errorsOf(validatePlan({ agents: [agent('a'), agent('b')], edges: [['a'], ['a', 'b', 'a'], []] }))).toEqual([
      'edges[0] has 1 entries; an edge is a [from, to] pair',
      'edges[1] has 3 entries; an edge is a [from, to] pair',
      'edges[2] has 0 entries; an edge is a [from, to] pair',
    ])
  })

  it('refuses a cycle and names every agent it traps', () => {
    expect(errorsOf(validatePlan({
      agents: [agent('a'), agent('b'), agent('c')],
      edges: [['b', 'c'], ['c', 'b']],
    }))).toEqual([
      'edges form a dependency cycle; "b", "c" can never start because each waits on another',
    ])
  })

  it('refuses a two-agent cycle declared directly', () => {
    expect(errorsOf(validatePlan({ agents: [agent('a'), agent('b')], edges: [['a', 'b'], ['b', 'a']] }))).toEqual([
      'edges form a dependency cycle; "a", "b" can never start because each waits on another',
    ])
  })

  it('reports every field and reference problem in one call', () => {
    const errors = errorsOf(validatePlan({ agents: [agent('a', { name: '' }), agent('a')], edges: [['a', 'gone']] }))

    expect(errors).toEqual([
      'agents[0].name is empty; it is the card title the user reads',
      'agents[1].id "a" repeats the id already declared at agents[0]; ids must be unique',
      'edges[0] ends at "gone", which no agent declares',
    ])
  })

  it('does not report a cycle while a reference problem is still outstanding', () => {
    const errors = errorsOf(validatePlan({ agents: [agent('a'), agent('b')], edges: [['a', 'b'], ['b', 'a'], ['a', 'gone']] }))

    expect(errors).toEqual(['edges[0] ends at "gone", which no agent declares'.replace('edges[0]', 'edges[2]')])
  })

  it.each([
    { label: 'the three-agent survey', input: ARCHIVED_SURVEY, ids: ['repo-inspector', 'environment-checker', 'safety-reviewer'], edges: [] },
    { label: 'the audited install', input: AUDITED_INSTALL, ids: ['installer', 'verifier', 'auditor'], edges: [['installer', 'verifier'], ['installer', 'auditor']] },
  ])('accepts the archived real call: $label', ({ input, ids, edges }) => {
    const result = validatePlan(input)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected the archived call to validate')
    expect(result.order.map(entry => entry.id)).toEqual(ids)
    expect(result.plan.edges).toEqual(edges)
  })
})

// A swarm whose every node produces ships whatever its producers believe: the
// studied platform's fabricated reproduction left a producer-only DAG with no
// node asked to break it (`clawsgo-analysis/CLAWSGO-SCHEDULING.md` §3, §6.2).
describe('sci-plan validatePlan composition rule', () => {
  it('refuses a plan with no adversary, naming the icon to add', () => {
    expect(errorsOf(validatePlan({ agents: [agent('a', { icon: 'web' }), agent('b', { icon: 'search' })] }))).toEqual([
      'no agent carries icon "security"; every plan needs at least one adversary that tries to break what the others produce — a swarm of producers alone is refused',
    ])
  })

  it('refuses the archived two-agent install, which produced and delivered with nothing refuting', () => {
    expect(errorsOf(validatePlan(ARCHIVED_INSTALL))).toEqual([
      'no agent carries icon "security"; every plan needs at least one adversary that tries to break what the others produce — a swarm of producers alone is refused',
    ])
  })

  it('refuses a producer whose adversary runs beside it instead of after it', () => {
    expect(errorsOf(validatePlan({ agents: [agent('build', { icon: 'code' }), agent('audit')] }))).toEqual([
      'no edge leads from a producing agent ("build") into the adversary ("audit"); add an edge so the adversary runs after the artifact exists and checks the artifact itself',
    ])
  })

  it('names every producer and every adversary when the edge is missing', () => {
    const errors = errorsOf(validatePlan({
      agents: [agent('build', { icon: 'code' }), agent('ship', { icon: 'check' }), agent('audit'), agent('refute')],
      edges: [['build', 'ship']],
    }))

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('("build", "ship")')
    expect(errors[0]).toContain('("audit", "refute")')
  })

  it('accepts a producer once one adversary depends on one producer', () => {
    const result = validatePlan({
      agents: [agent('build', { icon: 'code' }), agent('ship', { icon: 'check' }), agent('audit')],
      edges: [['build', 'ship'], ['ship', 'audit']],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected the audited plan to validate')
    expect(result.order.map(entry => entry.id)).toEqual(['build', 'ship', 'audit'])
  })

  it('accepts a read-only swarm whose adversary runs in parallel, since there is no artifact to wait for', () => {
    expect(validatePlan({ agents: [agent('a', { icon: 'web' }), agent('b', { icon: 'search' }), agent('audit')] }).ok).toBe(true)
  })

  it('reports the missing adversary together with field and reference problems, before the cycle check', () => {
    const errors = errorsOf(validatePlan({
      agents: [agent('a', { icon: 'code', name: '' }), agent('b', { icon: 'code' })],
      edges: [['a', 'b'], ['b', 'a']],
    }))

    expect(errors).toEqual([
      'agents[0].name is empty; it is the card title the user reads',
      'no agent carries icon "security"; every plan needs at least one adversary that tries to break what the others produce — a swarm of producers alone is refused',
    ])
  })
})
