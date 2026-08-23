import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry, { type SkillCandidate } from '@deepseek-ai/dsh-skill'
import type { Config as SkillFileSystemConfig } from '../src/index.ts'

// The layered walk stops at the operating-system home, so these cases need a
// home the test owns. Every other fixture path stays under it, and no case may
// read the developer's real home.
const walkHarness = vi.hoisted(() => ({ home: '' }))

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  const nodeFs = await import('node:fs')
  const nodePath = await import('node:path')
  walkHarness.home = nodeFs.mkdtempSync(nodePath.join(actual.tmpdir(), 'dsh-skill-walk-home-'))
  const homedir = (): string => walkHarness.home
  return { ...actual, homedir, default: { ...actual, homedir } }
})

const SkillFileSystem = await import('../src/index.ts')

async function writeSkill(root: string, name: string, description: string): Promise<void> {
  const directory = join(root, name)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\nBody.\n`)
}

async function homeDir(...segments: string[]): Promise<string> {
  const path = join(walkHarness.home, ...segments)
  await mkdir(path, { recursive: true })
  return path
}

async function listCandidates(
  provider: InstanceType<typeof SkillFileSystem.FileSystemSkillProvider>,
  cwd: string,
): Promise<readonly SkillCandidate[]> {
  const observation = await provider.list({ cwd })
  return Array.isArray(observation) ? observation : observation.candidates
}

async function setupWalk(config: Partial<SkillFileSystemConfig>): Promise<{
  ctx: Context
  provider: InstanceType<typeof SkillFileSystem.FileSystemSkillProvider>
}> {
  const ctx = new Context()
  await ctx.plugin(SkillRegistry)
  let provider!: InstanceType<typeof SkillFileSystem.FileSystemSkillProvider>
  ctx.skills.registerProvider((control) => {
    provider = new SkillFileSystem.FileSystemSkillProvider(ctx, control, { watch: false, ...config })
    return provider
  })
  return { ctx, provider }
}

// Home-level skill roots have fixed names, so each case starts from an empty home.
beforeEach(async () => {
  await rm(walkHarness.home, { recursive: true, force: true })
  await mkdir(walkHarness.home, { recursive: true })
})

describe('layered project skill discovery', () => {
  it('ranks each configured directory of each ancestor up to the home directory', async () => {
    const cwd = await homeDir('projects', 'repo', 'app')
    const userHome = await homeDir('user-roots')
    await writeSkill(join(cwd, '.dsh/skills'), 'near-dsh', 'Nearest dsh')
    await writeSkill(join(cwd, '.agents/skills'), 'near-agents', 'Nearest agents')
    await writeSkill(join(cwd, '.claude/skills'), 'shadowed', 'Nearest claude')
    await writeSkill(join(walkHarness.home, 'projects/repo/.dsh/skills'), 'shadowed', 'Repo dsh')
    await writeSkill(join(walkHarness.home, '.claude/skills'), 'home-claude', 'Home claude')

    const { ctx, provider } = await setupWalk({
      dshHome: join(userHome, '.dsh'),
      agentsHome: join(userHome, '.agents'),
      claudeHome: join(userHome, '.claude'),
    })

    expect((await listCandidates(provider, cwd)).map(skill => [skill.name, skill.source, skill.rank, skill.root]))
      .toEqual([
        ['near-dsh', 'project-dsh', 100, join(cwd, '.dsh/skills')],
        ['near-agents', 'project-agents', 101, join(cwd, '.agents/skills')],
        ['shadowed', 'project-claude', 102, join(cwd, '.claude/skills')],
        ['shadowed', 'project-dsh', 103, join(walkHarness.home, 'projects/repo/.dsh/skills')],
        ['home-claude', 'project-claude', 111, join(walkHarness.home, '.claude/skills')],
      ])
    expect((await ctx.skills.list({ cwd })).find(skill => skill.name === 'shadowed')).toMatchObject({
      description: 'Nearest claude',
      source: 'project-claude',
    })
  })

  it('leaves an ancestor directory that is already a user root to that user root', async () => {
    const cwd = await homeDir('workspace')
    await writeSkill(join(walkHarness.home, '.dsh/skills'), 'user-dsh-skill', 'User dsh skill')
    await writeSkill(join(walkHarness.home, '.dsh/skills/.system'), 'hidden-system', 'Hidden system skill')
    await writeSkill(join(walkHarness.home, '.agents/skills'), 'user-agents-skill', 'User agents skill')

    const { ctx, provider } = await setupWalk({
      dshHome: join(walkHarness.home, '.dsh'),
      agentsHome: join(walkHarness.home, '.agents'),
      claudeHome: join(walkHarness.home, '.claude'),
    })

    expect((await listCandidates(provider, cwd)).map(skill => [skill.name, skill.source, skill.rank])).toEqual([
      ['user-dsh-skill', 'user-dsh', 400],
      ['user-agents-skill', 'user-agents', 500],
    ])
    expect((await ctx.skills.list({ cwd })).map(skill => skill.name))
      .toEqual(['user-agents-skill', 'user-dsh-skill'])
  })
})
