// Web e2e scenario: the whole client at a phone viewport (390x844, the iPhone
// 15 portrait box), driven as a touch device so the coarse-pointer tap-target
// rules apply. What it proves, in the order a phone user meets it: the sign-in
// card fits, the shell never scrolls sideways, the sidebar is a drawer that
// opens and closes, the composer sits inside the viewport, and the settings
// dialog — a two-pane desktop layout everywhere else — is usable at this width.
//
// Zero model calls and no tool call of any kind: the journey never reaches a
// turn, so a stray stream would fail loud on the empty adapter registry. It
// makes no bash tool call by construction.
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
import { saveFailureShot } from './support.ts'

/** Mounts auth-sqlite, mail-file, and the request gate over the shipped Web surface. */
const OVERLAY = fileURLToPath(new URL('./mobile-phone.overlay.yml', import.meta.url))

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/mobile-phone', import.meta.url))
const SIGN_IN_EXPECTED = join(SNAPSHOT_DIR, 'sign-in-card.expected.md')
const SETTINGS_EXPECTED = join(SNAPSHOT_DIR, 'settings-dialog.expected.md')
const MODE = webSnapshotMode()

/** iPhone 15 portrait; the narrower 360x640 case is covered by the unit breakpoint specs. */
const VIEWPORT = { width: 390, height: 844 }

const EMAIL = 'ada@example.test'
const PASSWORD = 'correct-horse-battery-staple'

describe('web e2e: the client at a phone viewport', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  const card = (): ReturnType<Page['getByRole']> => page.getByRole('dialog', { name: 'Sign in' })
  const drawer = (): ReturnType<Page['getByRole']> => page.getByRole('dialog', { name: 'Sidebar' })

  /**
   * Whether the document itself can be scrolled sideways. This is the failure
   * the phone form exists to prevent: one over-wide row and the entire page
   * pans, taking the composer and the header off-screen with it.
   * @returns the horizontal overflow in CSS pixels; 0 when nothing overflows.
   */
  async function pageOverflow(): Promise<number> {
    return page.evaluate(() => Math.max(
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
      document.body.scrollWidth - document.body.clientWidth,
    ))
  }

  /** The newest six-digit sign-in code in the mail-file mailbox. */
  async function mailedCode(): Promise<string> {
    const mailbox = await readFile(join(scaffold.harnessHome, 'mailbox.jsonl'), 'utf8')
    const latest = mailbox.split('\n').filter(line => line.length > 0)
      .map(line => JSON.parse(line) as { to: string; subject: string; text: string })
      .filter(record => record.to === EMAIL && record.subject === 'Your sign-in code')
      .at(-1)
    if (latest === undefined) throw new Error(`no sign-in code in ${scaffold.harnessHome}/mailbox.jsonl`)
    const code = /\b(\d{6})\b/.exec(latest.text)?.[1]
    if (code === undefined) throw new Error(`sign-in message carried no six-digit code: ${latest.text}`)
    return code
  }

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY })
    const auth: AuthService | undefined = scaffold.ctx.get('auth')
    if (auth === undefined) throw new Error('the overlay mounted no auth provider')
    await auth.createUser(EMAIL, PASSWORD)

    browser = await chromium.launch()
    // isMobile + hasTouch are what make `(pointer: coarse)` and `(hover: none)`
    // match, so the tap-target rules under test are the ones actually applied.
    page = await browser.newPage({
      viewport: VIEWPORT,
      locale: 'en-US',
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
    })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await card().waitFor({ timeout: 30_000 })
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('opens on a sign-in card that fits the phone, with nothing to pan sideways', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-mobile-sign-in'))
    const box = await card().boundingBox()
    if (box === null) throw new Error('the sign-in card has no layout box')
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(VIEWPORT.width)
    // Both fields and the submit are on screen without scrolling to reach them.
    const submit = await card().getByRole('button', { name: 'Sign in', exact: true }).boundingBox()
    if (submit === null) throw new Error('the sign-in card has no submit button')
    expect(submit.y + submit.height).toBeLessThanOrEqual(VIEWPORT.height)
    expect(await pageOverflow()).toBe(0)

    // Named, not just `[role=dialog]`: the phone frame's parked drawer is a
    // dialog element too, and it comes first in the document.
    const snapshot = await captureStableAria(page, '[role="dialog"][aria-label="Sign in"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(SIGN_IN_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('signs in and lands on a single full-width conversation column', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-mobile-signed-in'))
    const warningStart = tripwire.warnings.length
    await card().getByLabel('E-mail address').fill(EMAIL)
    await card().getByLabel('Password', { exact: true }).fill(PASSWORD)
    await card().getByRole('button', { name: 'Sign in', exact: true }).click()
    await card().getByLabel('Code').waitFor({ timeout: 15_000 })
    await card().getByLabel('Code').fill(await mailedCode())
    await card().getByRole('button', { name: 'Verify' }).click()

    const composer = page.getByRole('textbox', { name: 'Choose workspace' })
    await composer.waitFor({ timeout: 30_000 })

    // The conversation takes the whole width: the phone frame is one track,
    // and the sidebar is parked off-canvas rather than squeezing it.
    const composerBox = await composer.boundingBox()
    if (composerBox === null) throw new Error('the composer has no layout box')
    expect(composerBox.x).toBeGreaterThanOrEqual(0)
    expect(composerBox.x + composerBox.width).toBeLessThanOrEqual(VIEWPORT.width)
    // Reachable without scrolling the page: the frame is viewport-height and
    // the composer is inside it.
    expect(composerBox.y + composerBox.height).toBeLessThanOrEqual(VIEWPORT.height)
    expect(await pageOverflow()).toBe(0)

    // The drawer is closed and out of the accessibility tree, so its controls
    // are not reachable behind the conversation.
    await expect.poll(() => drawer().isVisible(), { timeout: 5_000 }).toBe(false)

    acknowledgeReloadConnectionLoss(tripwire, warningStart)
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)

  it('the header toggle opens the drawer and Escape closes it again', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-mobile-drawer'))
    const toggle = page.getByRole('button', { name: 'Open sidebar' })
    // Tap-target floor, the reason a phone can hit it at all.
    const toggleBox = await toggle.boundingBox()
    if (toggleBox === null) throw new Error('the drawer toggle has no layout box')
    expect(toggleBox.width).toBeGreaterThanOrEqual(44)
    expect(toggleBox.height).toBeGreaterThanOrEqual(44)

    await toggle.tap()
    await drawer().waitFor({ state: 'visible', timeout: 10_000 })
    // Opened wide, not as the 56px rail: the sidebar's own labelled controls
    // are present, and the drawer leaves the conversation visible beside it.
    await drawer().getByRole('button', { name: 'New session' }).first().waitFor({ timeout: 10_000 })
    const drawerBox = await drawer().boundingBox()
    if (drawerBox === null) throw new Error('the drawer has no layout box')
    expect(drawerBox.width).toBeLessThan(VIEWPORT.width)
    expect(await pageOverflow()).toBe(0)

    await page.keyboard.press('Escape')
    await drawer().waitFor({ state: 'hidden', timeout: 10_000 })
    // Focus came back to the control that opened it.
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Open sidebar')
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('a tap on the conversation beside the drawer closes it', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-mobile-drawer-backdrop'))
    await page.getByRole('button', { name: 'Open sidebar' }).tap()
    await drawer().waitFor({ state: 'visible', timeout: 10_000 })
    // The strip the drawer leaves uncovered, right of its 280px edge: the
    // backdrop spans the whole frame, so a tap inside the drawer's own band
    // would land on the sidebar instead.
    await page.locator('[data-drawer-backdrop]').tap({ position: { x: 340, y: 400 } })
    await drawer().waitFor({ state: 'hidden', timeout: 10_000 })
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('the settings dialog takes the width instead of keeping its desktop nav rail', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-mobile-settings'))
    await page.getByRole('button', { name: 'Open sidebar' }).tap()
    await drawer().waitFor({ state: 'visible', timeout: 10_000 })
    await drawer().getByRole('button', { name: 'Settings', exact: true }).tap()

    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.waitFor({ timeout: 15_000 })
    const dialogBox = await dialog.boundingBox()
    if (dialogBox === null) throw new Error('the settings dialog has no layout box')
    // Full-bleed, and no wider than the phone: the desktop panel is 800px.
    expect(dialogBox.x).toBe(0)
    expect(dialogBox.width).toBe(VIEWPORT.width)
    expect(await pageOverflow()).toBe(0)

    // The section nav survived the collapse and still selects a section.
    const general = dialog.getByRole('button', { name: 'General' })
    await general.waitFor({ timeout: 10_000 })
    const navBox = await general.boundingBox()
    if (navBox === null) throw new Error('the settings nav has no layout box')
    expect(navBox.height).toBeGreaterThanOrEqual(44)

    // The settings panel names itself through its own title node; the drawer
    // beneath it carries an aria-label instead.
    const snapshot = await captureStableAria(page, '[role="dialog"][aria-labelledby]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(SETTINGS_EXPECTED, snapshot, MODE)

    await dialog.getByRole('button', { name: 'Close' }).tap()
    await dialog.waitFor({ state: 'hidden', timeout: 10_000 })
    expect(tripwire.pageErrors).toEqual([])
  }, 90_000)

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['settings-dialog.expected.md', 'sign-in-card.expected.md'])
  })
})
