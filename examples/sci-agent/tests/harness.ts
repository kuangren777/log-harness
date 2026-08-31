/**
 * Boot support for the science-gate snapshot suites: the example's real
 * `cordis.yml` through the app's own `boot()`, over a temporary project tree.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { boot } from '@deepseek-ai/dsh-app-boot'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'

/** The three example compositions, by tier. */
export const CONFIGS = {
  balanced: fileURLToPath(new URL('../cordis.yml', import.meta.url)),
  cluster: fileURLToPath(new URL('../cluster.cordis.yml', import.meta.url)),
  auto: fileURLToPath(new URL('../auto.cordis.yml', import.meta.url)),
} as const

/** One booted example: the tree, its pre-created agent, and the project root it works in. */
export interface BootedExample {
  ctx: Context
  agent: Agent
  /** The configured project ROOT: one directory per project lives under it. */
  projectRoot: string
  /** This scenario's project directory, and the agent's working directory. */
  project: string
  dispose(): Promise<void>
}

/**
 * Boot one example composition over a fresh project tree.
 *
 * `DSH_SCI_PROJECT_ROOT` is what the composition's `!!js` expressions read, so
 * the whole science layer — the path gate, delivery, the guard's exec roots —
 * points at the temporary tree rather than at the repository.
 * @param tier - which composition to boot.
 * @returns the booted tree and its disposer.
 */
export async function bootExample(tier: keyof typeof CONFIGS): Promise<BootedExample> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-sci-example-'))
  // The science layer's path classification is `<projectRoot>/<project>/<role>/…`:
  // the configured root holds one directory per project, so a scenario that
  // seeded `tmp/` directly under the root would sit outside every region and be
  // classified as nothing at all.
  const project = join(projectRoot, 'demo')
  for (const dir of ['workspace', 'tmp', 'papers', 'sciplots']) await mkdir(join(project, dir), { recursive: true })
  for (const dir of ['spool/pending', 'spool/done', 'spool/failed', 'snapshots']) {
    await mkdir(join(projectRoot, '.sci', dir), { recursive: true })
  }
  const previous = process.env.DSH_SCI_PROJECT_ROOT
  process.env.DSH_SCI_PROJECT_ROOT = projectRoot
  // The example's sci-skills reads its fixture tree from here (deployment uses
  // the loopback vault instead); the bodies never touch the project tree.
  const previousSkills = process.env.DSH_SCI_SKILLS_ROOT
  process.env.DSH_SCI_SKILLS_ROOT = fileURLToPath(new URL('../skills', import.meta.url))
  let ctx: Context
  try {
    ctx = await boot('sci-agent', CONFIGS[tier])
  } finally {
    if (previous === undefined) delete process.env.DSH_SCI_PROJECT_ROOT
    else process.env.DSH_SCI_PROJECT_ROOT = previous
    if (previousSkills === undefined) delete process.env.DSH_SCI_SKILLS_ROOT
    else process.env.DSH_SCI_SKILLS_ROOT = previousSkills
  }
  // The session `cwd` is what every path argument resolves against, so it must
  // be the project the composition was pointed at, not the process cwd.
  const agent = ctx.agentLoop.create(
    SessionId(`sci-${tier}`),
    { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
    { cwd: project },
  )
  // The approval seam requires its `approval/asked` + `approval/decided` pair to
  // be turn-enclosed, so a scenario that drives the registry directly still has
  // to open the turn the decision belongs to.
  agent.session.append('turn/start', { turn: 1 })
  return {
    ctx,
    agent,
    projectRoot,
    project,
    dispose: async () => {
      await ctx.fiber.dispose()
      await rm(projectRoot, { recursive: true, force: true })
    },
  }
}

/**
 * Run one tool call through the composed registry, which is where every science
 * gate sits.
 * @param booted - the booted example.
 * @param name - the tool to call.
 * @param args - the call arguments exactly as a model would send them.
 * @returns the normalized execution result.
 */
export function call(booted: BootedExample, name: string, args: unknown): Promise<ToolExecutionResult> {
  return booted.ctx.tools.execute({
    signal: AbortSignal.timeout(30_000),
    callId: CallId(`${name}-call`),
    name,
    arguments: args,
    agent: booted.agent,
  })
}

/**
 * The text a model would read back from one tool result, with the temporary
 * project path replaced so the recorded output is machine-independent.
 * @param booted - the booted example, whose project path is normalized away.
 * @param result - the execution result.
 * @returns the joined text blocks.
 */
export function resultText(booted: BootedExample, result: ToolExecutionResult): string {
  const text = result.content
    .map(block => block.type === 'text' ? block.text : `<${block.type}>`)
    .join('\n')
  return `isError: ${String(result.isError)}\n---\n${text.replaceAll(booted.projectRoot, '<root>')}`
}

/**
 * The science and approval events the agent's session recorded, normalized.
 *
 * `approval/*` rides along because an irreversible-action question is only
 * half-recorded by `sci/authorized`: the outcome is there, the sentences the
 * user was asked to decide on are in the approval event.
 */
export function sciEvents(booted: BootedExample): { type: string; data: unknown }[] {
  return booted.agent.session.events
    .filter(event => event.type.startsWith('sci/') || event.type.startsWith('approval/'))
    .map(event => ({
      type: event.type,
      // Minted ids are fresh per run; the recording pins the relation between
      // the question and its decision, not the value.
      data: JSON.parse(JSON.stringify(event.data)
        .replaceAll(booted.projectRoot, '<root>')
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>')) as unknown,
    }))
}

/** Write one file inside the booted project tree. */
export async function seed(booted: BootedExample, relative: string, content: string | Uint8Array): Promise<string> {
  const path = join(booted.project, relative)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, content)
  return path
}
