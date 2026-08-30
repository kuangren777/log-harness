/**
 * The roster, catalog, and log fixtures the client suites share.
 *
 * Shaped like the host's real answers (spec 16-Workbench/12-spec-agents.md
 * §2.3): one persona carrying every optional stat, one carrying none of them,
 * a two-provider catalog, and a log with a settled call, a failed one, and
 * one still in flight.
 */
import type { AgentCall, ModelProvider, RosterAgent } from '../src/client/contract.ts'

/** A fully reported persona: pinned model and all three stats. */
export const RESEARCHER: RosterAgent = {
  persona: 'researcher',
  toolName: 'subagent_researcher',
  name: '检索体',
  role: '文献检索 · 质量评级',
  summary: '跨库并行语义检索，DOI 与语义指纹双重去重，按方法学严谨度评级。',
  enabled: true,
  model: { provider: 'deepseek', model: 'deepseek-reasoner' },
  permissions: { web: true, code: false, writeLibrary: true },
  stats: { monthCalls: 1204, avgDurationMs: 2800, monthTokens: 31_000_000 },
}

/** A persona the host reports without a timing, a token total, or a model. */
export const DELIVERER: RosterAgent = {
  persona: 'deliverer',
  toolName: 'subagent_deliverer',
  name: '交付体',
  role: '成稿交付 · 归档',
  summary: '整合结论，按学术写作规范生成终稿与引用表。',
  enabled: false,
  permissions: { web: false, code: true, writeLibrary: false },
  stats: { monthCalls: 0 },
}

/** The two-persona roster most cases draw. */
export const ROSTER: readonly RosterAgent[] = [RESEARCHER, DELIVERER]

/** The host's catalog: two providers, three models between them. */
export const CATALOG: readonly ModelProvider[] = [
  {
    provider: 'deepseek',
    models: [{ model: 'deepseek-chat' }, { model: 'deepseek-reasoner' }],
  },
  { provider: 'pi-ai', models: [{ model: 'pi-fast' }] },
]

/** 2026-08-30 14:02:41 local time, the settled call's wall clock. */
const FIRST_AT = new Date(2026, 7, 30, 14, 2, 41).getTime()

/** One delegation log: a settled call, a failed one, and one still running. */
export const CALLS: readonly AgentCall[] = [
  {
    ts: FIRST_AT,
    sessionId: 'session-42',
    callId: 'call-1',
    task: '跨库检索 n 型硒化物 zT',
    durationMs: 11_600,
    status: 'ok',
    outputTokens: 9200,
  },
  {
    ts: FIRST_AT - 60_000,
    sessionId: 'session-43',
    callId: 'call-2',
    task: '交叉验证 47 条引用',
    durationMs: 96_000,
    status: 'error',
  },
  {
    ts: FIRST_AT - 120_000,
    sessionId: 'session-44',
    callId: 'call-3',
    task: '拟合温区-zT 曲线族',
    status: 'running',
  },
]
