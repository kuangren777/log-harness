// Web e2e scenario: the Skills settings section end to end through the real
// host — a project root and a user root discovered from the session's working
// directory, the shadowed loser the catalog hides, a Model toggle written down
// to `$DSH_HOME/settings.yaml` as a per-skill override, and the reset that
// clears it. Zero model calls: discovery plus the settings document on a blank
// frame, so there is no fixture and a stray stream would fail loud on the open
// llm seam.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/skills-settings', import.meta.url))
const SECTION_EXPECTED = join(SNAPSHOT_DIR, 'section.expected.md')
const OVERRIDDEN_EXPECTED = join(SNAPSHOT_DIR, 'overridden.expected.md')
const MODE = webSnapshotMode()

/** Write one discoverable skill under `root`. */
async function seedSkill(root: string, name: string, description: string): Promise<void> {
  const directory = join(root, name)
  await mkdir(directory, { recursive: true })
  await writeFile(
    join(directory, 'SKILL.md'),
    ['---', `name: ${name}`, `description: ${description}`, '---', '', `# ${name}`, ''].join('\n'),
  )
}

describe('web e2e: Skills settings page overrides one skill', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    // A shared name in both layers is what makes the shadowed loser visible;
    // the two unique names show that every layer is listed, not just the winner's.
    const project = join(scaffold.workspaceCwd, 'workspace', '.dsh', 'skills')
    const user = join(scaffold.harnessHome, 'skills')
    await seedSkill(project, 'journey-shared', 'Project copy of the shared skill')
    await seedSkill(project, 'journey-project', 'Only the project defines this one')
    await seedSkill(user, 'journey-shared', 'User copy of the shared skill')
    await seedSkill(user, 'journey-user', 'Only the user home defines this one')

    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  /**
   * Open the settings dialog on the Skills section. The scenarios share one
   * page and the settings document accumulates across them, so this closes any
   * dialog a previous scenario left open — its mask would swallow the trigger.
   */
  async function openSkills(): Promise<Locator> {
    if (await page.getByRole('dialog', { name: 'Settings' }).count() > 0) {
      await page.keyboard.press('Escape')
      await expect.poll(() => page.getByRole('dialog', { name: 'Settings' }).count(), { timeout: 5_000 }).toBe(0)
    }
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.waitFor({ timeout: 10_000 })
    await dialog.getByRole('button', { name: 'Skills', exact: true }).click()
    await expect
      .poll(() => dialog.getByRole('button', { name: 'Skills', exact: true }).getAttribute('aria-current'), { timeout: 5_000 })
      .toBe('true')
    await dialog.getByRole('heading', { name: 'Project (.dsh/skills)', exact: true }).waitFor({ timeout: 10_000 })
    return dialog
  }

  /** The settings document as the Host has written it so far. */
  async function settingsDocument(): Promise<string> {
    return readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8').catch(() => '')
  }

  it('groups every discovered skill by origin, nearest first', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-skills-settings-section'))
    const dialog = await openSkills()

    const groups = await dialog.getByRole('heading', { level: 4 }).allTextContents()
    expect(groups).toEqual(['Project (.dsh/skills)', 'User (.dsh/skills)'])
    // The user copy of the shared name lost to the nearer project copy, and
    // says so instead of disappearing the way the catalog hides it.
    expect(await dialog.getByText('shadowed by a nearer definition').count()).toBe(1)
    expect(await dialog.getByRole('switch', { name: 'Model may invoke journey-project' }).count()).toBe(1)
    expect(await dialog.getByRole('switch', { name: 'User may invoke journey-user' }).count()).toBe(1)
    // Nothing is overridden before the first write.
    expect(await dialog.getByText('Overridden').count()).toBe(0)

    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(SECTION_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('writes one surface as an override and marks the row', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-skills-settings-write'))
    const dialog = await openSkills()

    const model = dialog.getByRole('switch', { name: 'Model may invoke journey-user' })
    expect(await model.getAttribute('aria-checked')).toBe('true')
    await model.click()

    await expect.poll(async () => (await settingsDocument()).includes('journey-user'), { timeout: 10_000 }).toBe(true)
    expect(await settingsDocument()).toContain('model: false')
    // The Host's own resolution comes back through the re-read, not optimistically.
    await expect.poll(() => model.getAttribute('aria-checked'), { timeout: 10_000 }).toBe('false')
    // The other surface keeps what the skill authored.
    expect(await dialog.getByRole('switch', { name: 'User may invoke journey-user' }).getAttribute('aria-checked'))
      .toBe('true')
    await expect.poll(() => dialog.getByText('Overridden').count(), { timeout: 5_000 }).toBe(1)

    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(OVERRIDDEN_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('clears the override on reset', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-skills-settings-reset'))
    const dialog = await openSkills()

    await dialog.getByRole('button', { name: 'Reset journey-user to its authored policy' }).click()

    await expect.poll(async () => (await settingsDocument()).includes('journey-user'), { timeout: 10_000 }).toBe(false)
    await expect
      .poll(() => dialog.getByRole('switch', { name: 'Model may invoke journey-user' }).getAttribute('aria-checked'), { timeout: 10_000 })
      .toBe('true')
    expect(await dialog.getByText('Overridden').count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['overridden.expected.md', 'section.expected.md'])
  })
})
