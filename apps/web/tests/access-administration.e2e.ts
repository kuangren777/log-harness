// Web e2e scenario: administering permission groups through the real request
// gate, and then living under the rule that was written.
//
// The multi-user overlay (the same three rows examples/web-auth ships) makes
// the scaffold's `dsh web` authenticate, so this lane can sign in as two
// different people against one host: an administrator who creates a group,
// puts somebody in it, and denies that group one skill; and the member, who
// signs in afterwards and finds the denied skill missing from a catalog the
// Host filtered — the enforcement the administration page only describes.
//
// Zero model calls and no tool call of any kind: nothing here reaches a
// conversation, so a stray stream would fail loud on the empty adapter
// registry.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { AuthService } from '@deepseek-ai/dsh-auth'
import {
  acknowledgeReloadConnectionLoss, assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

/** Mounts auth-sqlite, mail-file, and the request gate over the shipped Web surface. */
const OVERLAY = fileURLToPath(new URL('./access-administration.overlay.yml', import.meta.url))

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/access-administration', import.meta.url))
const PAGE_EXPECTED = join(SNAPSHOT_DIR, 'access-page.expected.md')
const RULES_EXPECTED = join(SNAPSHOT_DIR, 'rules-editor.expected.md')
const MODE = webSnapshotMode()

/** The administrator: created before the browser opens, and put in the builtin group. */
const ADMIN_EMAIL = 'ada@example.test'
/** The ordinary account the administrator puts in the new group. */
const MEMBER_EMAIL = 'ben@example.test'
const PASSWORD = 'correct-horse-battery-staple'

/** One workspace directory per account: a workspace belongs to whoever attached it. */
const ADMIN_WORKSPACE = 'admin-workspace'
const MEMBER_WORKSPACE = 'member-workspace'

/** The group the administrator creates, and the skill it loses. */
const GROUP = 'journey-team'
const DENIED_SKILL = 'journey-secret'
const OPEN_SKILL = 'journey-open'

/** Write one discoverable skill under `root`. */
async function seedSkill(root: string, name: string, description: string): Promise<void> {
  const directory = join(root, name)
  await mkdir(directory, { recursive: true })
  await writeFile(
    join(directory, 'SKILL.md'),
    ['---', `name: ${name}`, `description: ${description}`, '---', '', `# ${name}`, ''].join('\n'),
  )
}

describe('web e2e: an administrator writes a group rule and its member lives under it', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  /** The sign-in card, which owns the page while nobody is signed in. */
  const card = (): Locator => page.getByRole('dialog', { name: 'Sign in' })

  /** The auth provider the overlay mounted, which is also what the gate writes through. */
  function auth(): AuthService {
    const service: AuthService | undefined = scaffold.ctx.get('auth')
    if (service === undefined) throw new Error('the overlay mounted no auth provider')
    return service
  }

  /** The six-digit code from the newest sign-in message to one address. */
  async function mailedCode(email: string): Promise<string> {
    const mailbox = await readFile(join(scaffold.harnessHome, 'mailbox.jsonl'), 'utf8')
    const records = mailbox.split('\n').filter(line => line.length > 0)
      .map(line => JSON.parse(line) as { to: string; subject: string; text: string })
      .filter(record => record.to === email && record.subject === 'Your sign-in code')
    const latest = records.at(-1)
    if (latest === undefined) throw new Error(`no sign-in code for ${email} in ${scaffold.harnessHome}/mailbox.jsonl`)
    const code = /\b(\d{6})\b/.exec(latest.text)?.[1]
    if (code === undefined) throw new Error(`sign-in message carried no six-digit code: ${latest.text}`)
    return code
  }

  /** Complete the two-step sign-in for one account and wait for the app behind it. */
  async function signIn(email: string): Promise<void> {
    const warningStart = tripwire.warnings.length
    await card().waitFor({ timeout: 30_000 })
    await card().getByLabel('E-mail address').fill(email)
    await card().getByLabel('Password', { exact: true }).fill(PASSWORD)
    await card().getByRole('button', { name: 'Sign in', exact: true }).click()
    await card().getByLabel('Code').waitFor({ timeout: 15_000 })
    await card().getByLabel('Code').fill(await mailedCode(email))
    await card().getByRole('button', { name: 'Verify' }).click()
    await page.getByRole('button', { name: `Signed in as ${email}` }).waitFor({ timeout: 30_000 })
    acknowledgeReloadConnectionLoss(tripwire, warningStart)
  }

  /** End this browser's session and come back to the sign-in card. */
  async function signOut(email: string): Promise<void> {
    const warningStart = tripwire.warnings.length
    await page.getByRole('button', { name: `Signed in as ${email}` }).click()
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click()
    await card().waitFor({ timeout: 30_000 })
    acknowledgeReloadConnectionLoss(tripwire, warningStart)
  }

  /**
   * Open the settings dialog on one section. The scenarios share one page, so
   * this closes any dialog a previous scenario left open — its mask would
   * swallow the trigger.
   * @param section - the nav entry's label.
   * @returns the settings dialog.
   */
  async function openSection(section: string): Promise<Locator> {
    if (await page.getByRole('dialog', { name: 'Settings' }).count() > 0) {
      await page.keyboard.press('Escape')
      await expect.poll(() => page.getByRole('dialog', { name: 'Settings' }).count(), { timeout: 5_000 }).toBe(0)
    }
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.waitFor({ timeout: 10_000 })
    await dialog.getByRole('button', { name: section, exact: true }).click()
    await expect
      .poll(() => dialog.getByRole('button', { name: section, exact: true }).getAttribute('aria-current'), { timeout: 5_000 })
      .toBe('true')
    return dialog
  }

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY })
    // Each account attaches its OWN workspace directory — a workspace is
    // recorded against the account that created it — and both directories
    // discover the same two skills, so the only difference between what the
    // two people see is the rule.
    for (const directory of [ADMIN_WORKSPACE, MEMBER_WORKSPACE]) {
      const project = join(scaffold.workspaceCwd, directory, '.dsh', 'skills')
      await seedSkill(project, DENIED_SKILL, 'The skill the new group loses')
      await seedSkill(project, OPEN_SKILL, 'The skill the new group keeps')
    }

    // `dsh auth bootstrap` writes to the same store; this lane creates both
    // accounts through the provider because what is under test is the browser.
    const service = auth()
    const adminId = await service.createUser(ADMIN_EMAIL, PASSWORD)
    await service.createUser(MEMBER_EMAIL, PASSWORD)
    // The builtin group is the one the schema seeds; membership in it is what
    // makes an administrator, and it is found by that flag rather than by a
    // name an administrator could in principle have changed.
    const builtin = (await service.listGroups()).find(group => group.builtin)
    if (builtin === undefined) throw new Error('the auth store seeded no builtin administrator group')
    await service.setMembers(builtin.groupId, [adminId])

    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await signIn(ADMIN_EMAIL)
    await connectFreshWorkspace(page, scaffold.workspaceCwd, ADMIN_WORKSPACE)
  }, 240_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('shows the administrator the roster and refuses to offer the builtin group a delete', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-access-page'))
    const dialog = await openSection('Access')

    await dialog.getByText('ada@example.test').first().waitFor({ timeout: 15_000 })
    expect(await dialog.getByText(MEMBER_EMAIL).count()).toBeGreaterThan(0)
    // The builtin administrator group is what makes an administrator, so the
    // page offers neither rename nor delete for it.
    expect(await dialog.getByRole('button', { name: 'Delete admin' }).count()).toBe(0)
    expect(await dialog.getByLabel('Rename admin').count()).toBe(0)
    expect(await dialog.getByRole('button', { name: 'Edit admin' }).count()).toBe(1)

    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(PAGE_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
  }, 90_000)

  it('creates a group, puts an account in it, and denies it one skill without locking it out', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-access-rules'))
    const dialog = await openSection('Access')

    await dialog.getByLabel('Group name').fill(GROUP)
    await dialog.getByRole('button', { name: 'Create group' }).click()
    await dialog.getByRole('heading', { name: 'Membership' }).waitFor({ timeout: 15_000 })

    await dialog.getByRole('switch', { name: `${MEMBER_EMAIL} belongs to ${GROUP}` }).click()
    await expect
      .poll(async () => (await auth().listMembers(await groupId())).length, { timeout: 15_000 })
      .toBe(1)

    // One denial, and nothing else, written into the Skills card. Without the
    // seeded catch-all this would deny every skill the group has; the card adds
    // it, says that it did, and its badge settles on open-with-exceptions
    // rather than allowlist.
    const skills = dialog.getByRole('region', { name: 'Skills' })
    await skills.getByLabel('Skills: name, or a prefix ending in *').fill(DENIED_SKILL)
    await skills.getByRole('button', { name: 'Add rule to Skills' }).click()
    await skills.getByRole('button', { name: 'Remove rule: Allow Skills *' }).waitFor({ timeout: 10_000 })
    expect(await skills.getByText('Open with exceptions').count()).toBe(1)
    expect(await dialog.getByRole('alert').count()).toBe(0)
    // The other three domains stay open, which is the per-domain rule made
    // visible: writing into one card governs that card and nothing else.
    expect(await dialog.getByRole('region', { name: 'Tools' }).getByText('Open', { exact: true }).count()).toBe(1)

    // The probe answers the denied name against the unsaved draft, through the
    // same evaluation the badges read.
    await skills.getByLabel('Skills: try a name').fill(DENIED_SKILL)
    await skills.getByText('Refused').waitFor({ timeout: 10_000 })
    expect(await skills.getByText(`Denied by ${DENIED_SKILL}: deny beats allow.`).count()).toBe(1)

    // The catalog preview reads the real inventory through `skill.inventory`
    // and answers for the draft too, before anything is saved.
    expect(await dialog.getByText(`Skills refused (1): ${DENIED_SKILL}`).count()).toBe(1)
    expect(await dialog.getByText(`Skills visible (1): ${OPEN_SKILL}`).count()).toBe(1)

    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(RULES_EXPECTED, snapshot, MODE)

    await dialog.getByRole('button', { name: 'Save rules' }).click()
    await expect.poll(async () => (await auth().listRules(await groupId())).length, { timeout: 15_000 }).toBe(2)
    // Order is the store's contract, not an accident: the editor seeds the
    // catch-all ahead of the denial it protects, and that is the order the
    // administrator sees when the section is reopened.
    expect([...await auth().listRules(await groupId())]).toEqual([
      { domain: 'skill', pattern: '*', effect: 'allow' },
      { domain: 'skill', pattern: DENIED_SKILL, effect: 'deny' },
    ])
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)

  it('hides the denied skill from the member the Host now filters', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-access-member'))
    await page.keyboard.press('Escape')
    await signOut(ADMIN_EMAIL)
    await signIn(MEMBER_EMAIL)
    await connectFreshWorkspace(page, scaffold.workspaceCwd, MEMBER_WORKSPACE)

    // The composer's trigger menu is `skill.list`, which the Host filters by
    // the very rules the administrator just saved. This is the enforcement;
    // the page that wrote the rule only described it.
    const composer = page.locator('textarea:enabled').last()
    await composer.fill('/journey')
    const menu = page.getByRole('listbox', { name: 'Trigger suggestions' })
    await expect
      .poll(() => menu.getByRole('option', { name: new RegExp(OPEN_SKILL) }).count(), { timeout: 15_000 })
      .toBe(1)
    expect(await menu.getByRole('option', { name: new RegExp(DENIED_SKILL) }).count()).toBe(0)
    await composer.fill('')

    // Administration is not theirs either, and the page says why rather than
    // failing every call behind a form.
    const access = await openSection('Access')
    await access.getByText(/^Only an administrator can manage accounts/).waitFor({ timeout: 15_000 })
    expect(await access.getByLabel('Group name').count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 150_000)

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['access-page.expected.md', 'rules-editor.expected.md'])
  })

  /** The id the Host minted for the group the administrator created. */
  async function groupId() {
    const group = (await auth().listGroups()).find(candidate => candidate.name === GROUP)
    if (group === undefined) throw new Error(`the host has no group named ${GROUP}`)
    return group.groupId
  }
})
