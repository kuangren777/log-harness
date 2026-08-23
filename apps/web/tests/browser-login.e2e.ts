// Web e2e scenario: signing in through the real browser surface, against the
// real request gate. The multi-user overlay (the same three rows
// examples/web-auth ships) turns the scaffold's `dsh web` into an
// authenticating deployment, so the page opens on the sign-in card instead of
// the app, and every /api call behind it is refused until the cookie exists.
//
// The second factor is read out of the mail-file mailbox, which is the whole
// point of that provider: a local trial can complete a real two-step sign-in
// without an SMTP server. Zero model calls and no tool call of any kind — the
// scenario never reaches a conversation, so a stray stream would fail loud on
// the empty adapter registry.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { AuthService } from '@deepseek-ai/dsh-auth'
import {
  acknowledgeReloadConnectionLoss, assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

/** Mounts auth-sqlite, mail-file, and the request gate over the shipped Web surface. */
const OVERLAY = fileURLToPath(new URL('./browser-login.overlay.yml', import.meta.url))

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/browser-login', import.meta.url))
const SIGN_IN_EXPECTED = join(SNAPSHOT_DIR, 'sign-in.expected.md')
const REFUSED_EXPECTED = join(SNAPSHOT_DIR, 'refused-code.expected.md')
const MODE = webSnapshotMode()

/** The account this scenario signs in as; created before the browser opens. */
const EMAIL = 'ada@example.test'
const PASSWORD = 'correct-horse-battery-staple'

describe('web e2e: the browser signs in before it reaches the app', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  /** The sign-in card, which owns the page while nobody is signed in. */
  const card = (): ReturnType<Page['getByRole']> => page.getByRole('dialog', { name: 'Sign in' })

  /** The six-digit code from the newest sign-in message in the mailbox. */
  async function mailedCode(): Promise<string> {
    const mailbox = await readFile(join(scaffold.harnessHome, 'mailbox.jsonl'), 'utf8')
    const records = mailbox.split('\n').filter(line => line.length > 0)
      .map(line => JSON.parse(line) as { to: string; subject: string; text: string })
      .filter(record => record.to === EMAIL && record.subject === 'Your sign-in code')
    const latest = records.at(-1)
    if (latest === undefined) throw new Error(`no sign-in code in ${scaffold.harnessHome}/mailbox.jsonl`)
    const code = /\b(\d{6})\b/.exec(latest.text)?.[1]
    if (code === undefined) throw new Error(`sign-in message carried no six-digit code: ${latest.text}`)
    return code
  }

  /**
   * Status of one direct `/api` call from the page, which is the fence itself
   * rather than a rendering of it.
   * @returns the HTTP status the Host answered.
   */
  async function probeApi(): Promise<number> {
    return page.evaluate(async (base: string) => {
      const response = await fetch(`${base}/api/host.describe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'journey-probe', method: 'host.describe', payload: {} }),
      })
      return response.status
    }, scaffold.baseUrl)
  }

  /** Submit the account's credentials and wait for the second-factor step. */
  async function submitPassword(): Promise<void> {
    await card().getByLabel('E-mail address').fill(EMAIL)
    await card().getByLabel('Password', { exact: true }).fill(PASSWORD)
    await card().getByRole('button', { name: 'Sign in', exact: true }).click()
    await card().getByLabel('Code').waitFor({ timeout: 15_000 })
  }

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY })
    // The store is the one `dsh auth bootstrap` writes to; this lane creates
    // the account through the same provider rather than spawning the CLI,
    // because what is under test is the browser, not the bootstrap command.
    const auth: AuthService | undefined = scaffold.ctx.get('auth')
    if (auth === undefined) throw new Error('the overlay mounted no auth provider')
    await auth.createUser(EMAIL, PASSWORD)

    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await card().waitFor({ timeout: 30_000 })
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('opens on the sign-in card, with the app unreachable behind it', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-browser-login-card'))
    // The shell mounted and the card is a modal in front of it. What makes
    // the app unreachable is not the overlay but the Host: every /api call
    // behind it is refused, which is exactly what the card is reporting.
    expect(await page.locator('[class*="frame"]').count()).toBeGreaterThan(0)
    expect(await card().getAttribute('aria-modal')).toBe('true')
    expect(await probeApi()).toBe(401)
    expect(await card().getByLabel('E-mail address').count()).toBe(1)
    expect(await card().getByRole('button', { name: 'Forgot your password?' }).count()).toBe(1)
    // Nobody is signed in, so the sidebar carries no account row.
    expect(await page.getByRole('button', { name: /^Signed in as / }).count()).toBe(0)

    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(SIGN_IN_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('refuses a wrong code and asks for it again, saying nothing more', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-browser-login-wrong-code'))
    await submitPassword()
    // The Host mailed a real code; this is deliberately not it.
    expect(await mailedCode()).not.toBe('000000')

    await card().getByLabel('Code').fill('000000')
    await card().getByRole('button', { name: 'Verify' }).click()

    const refusal = card().getByRole('alert')
    await refusal.waitFor({ timeout: 15_000 })
    expect(await refusal.textContent()).toBe('That code is wrong or no longer valid. Enter it again.')
    // Still the second-factor step, and the Host still refuses everything.
    expect(await card().getByLabel('Code').count()).toBe(1)
    expect(await probeApi()).toBe(401)

    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(REFUSED_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('signs in with the mailed code and hands the app over', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-browser-login-signed-in'))
    const warningStart = tripwire.warnings.length
    await card().getByLabel('Code').fill(await mailedCode())
    await card().getByRole('button', { name: 'Verify' }).click()

    // Success re-boots the page under the cookie the Host just set: the
    // account row names who this browser now is, and the card is gone.
    await page.getByRole('button', { name: `Signed in as ${EMAIL}` }).waitFor({ timeout: 30_000 })
    await expect.poll(() => page.getByRole('dialog', { name: 'Sign in' }).count(), { timeout: 15_000 }).toBe(0)
    await page.getByRole('textbox', { name: 'Choose workspace' }).waitFor({ timeout: 30_000 })
    // The same call the fence refused before now answers as this account.
    expect(await probeApi()).toBe(200)

    acknowledgeReloadConnectionLoss(tripwire, warningStart)
    expect(tripwire.pageErrors).toEqual([])
  }, 90_000)

  it('signs out back to the sign-in card', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-browser-login-signed-out'))
    const warningStart = tripwire.warnings.length
    await page.getByRole('button', { name: `Signed in as ${EMAIL}` }).click()
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click()

    await card().waitFor({ timeout: 30_000 })
    await expect.poll(() => page.getByRole('button', { name: `Signed in as ${EMAIL}` }).count(), { timeout: 15_000 })
      .toBe(0)
    // The cookie is gone with the session, so the fence refuses again.
    expect(await probeApi()).toBe(401)

    acknowledgeReloadConnectionLoss(tripwire, warningStart)
    expect(tripwire.pageErrors).toEqual([])
  }, 90_000)

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['refused-code.expected.md', 'sign-in.expected.md'])
  })
})
