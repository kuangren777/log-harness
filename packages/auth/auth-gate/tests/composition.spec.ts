/**
 * REAL-composition coverage: a test-only cordis.yml booted through the
 * vendored Loader mounts the provider, a file mailbox, the HTTP carrier, and
 * this gate, and every assertion observes the deployment's own surfaces — HTTP
 * status, `Set-Cookie`, and the mailbox file the codes actually arrive in.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { ADMIN_GROUP_ID, UserId, type UserId as UserIdType } from '@deepseek-ai/dsh-auth'
import SqliteAuthService, { RESET_PER_HOUR } from '@deepseek-ai/dsh-auth-sqlite'
import * as connectionPlugin from '@deepseek-ai/dsh-client-connection'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import FileMailProvider from '@deepseek-ai/dsh-mail-file'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import AuthGateService from '../src/index.ts'

const EMAIL = 'owner@example.test'
const PASSWORD = 'correct horse battery staple'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Boot the five-row composition and return its context, the port, and the mailbox path. */
async function loadComposition(): Promise<{ ctx: Context; port: number; mailbox: string }> {
  root = await mkdtemp(join(tmpdir(), 'dsh-auth-gate-loader-'))
  const mailbox = join(root, 'mailbox.jsonl')
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-host-webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    '    port: 0',
    "- name: '@deepseek-ai/dsh-client-connection'",
    "- name: '@deepseek-ai/dsh-auth-sqlite'",
    '  config:',
    "    path: ':memory:'",
    "- name: '@deepseek-ai/dsh-mail-file'",
    '  config:',
    `    path: ${JSON.stringify(mailbox)}`,
    "- name: '@deepseek-ai/dsh-auth-gate'",
    '  config:',
    "    baseUrl: 'https://harness.example'",
    '    cookieSecure: false',
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-host-webserver', HttpServer],
    ['@deepseek-ai/dsh-client-connection', connectionPlugin],
    ['@deepseek-ai/dsh-auth-sqlite', SqliteAuthService],
    ['@deepseek-ai/dsh-mail-file', FileMailProvider],
    ['@deepseek-ai/dsh-auth-gate', AuthGateService],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  const unloaded = [...context.loader.entries()]
    .filter(entry => entry.fiber === undefined && !entry.disabled)
    .map(entry => entry.options.name)
  expect(unloaded).toEqual([])
  return { ctx: context, port: context.webServer.port, mailbox }
}

/** One RPC call over the running server, with whatever cookie the caller holds. */
async function call(
  port: number,
  channel: string,
  method: string,
  payload: unknown,
  cookie?: string,
): Promise<{ status: number; body: string; setCookie: string[] }> {
  const response = await fetch(`http://127.0.0.1:${String(port)}${channel}/${method}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'Firefox',
      ...cookie === undefined ? {} : { cookie },
    },
    body: JSON.stringify({ type: 'client-request', rpcId: `rpc-${method}`, method, payload }),
  })
  return { status: response.status, body: await response.text(), setCookie: response.headers.getSetCookie() }
}

/** The value of the most recent `Set-Cookie`, as a request `Cookie` header. */
function asRequestCookie(setCookie: string[]): string {
  const pair = setCookie.at(-1)?.split(';', 1)[0]
  if (pair === undefined) throw new Error('the reply installed no cookie')
  return pair
}

/** Every message the file mailbox holds. */
async function mailboxLines(path: string): Promise<{ to: string; subject: string; text: string }[]> {
  const text = await readFile(path, 'utf8')
  return text.split('\n').filter(line => line.length > 0)
    .map(line => JSON.parse(line) as { to: string; subject: string; text: string })
}

describe('the gate as a deployment mounts it', () => {
  // The Loader resolves workspace packages through tsx at test time; the first
  // resolution after a cold cache is slower than the default budget allows.
  it('fences /api, signs a browser in through the mailbox, and signs it out', { timeout: 60_000 }, async () => {
    const { ctx, port, mailbox } = await loadComposition()
    const userId = await ctx.auth.createUser(EMAIL, PASSWORD)

    // Without a credential the transport refuses before any method is reached,
    // and clears the cookie the browser tried to present.
    const anonymous = await call(port, '/api', 'session.list', {})
    expect(anonymous.status).toBe(401)
    expect(anonymous.setCookie.at(0)).toContain('dsh_session=;')

    const started = await call(port, '/auth', 'login.start', { email: EMAIL, password: PASSWORD })
    expect(started.status).toBe(200)
    const pendingId = (JSON.parse(started.body) as { result: { value: { pendingId: string } } })
      .result.value.pendingId
    const delivered = await mailboxLines(mailbox)
    expect(delivered.map(message => message.subject)).toEqual(['Your sign-in code'])
    expect(delivered[0]?.to).toBe(EMAIL)
    const code = delivered[0]?.text.match(/is (\d{6})\./)?.[1]
    if (code === undefined) throw new Error('the mailbox holds no sign-in code')

    const verified = await call(port, '/auth', 'login.verify', { pendingId, code })
    expect(JSON.parse(verified.body)).toMatchObject({ result: { ok: true, value: { status: 'ok' } } })
    const credential = asRequestCookie(verified.setCookie)
    expect(verified.setCookie.at(0)).toContain('HttpOnly; SameSite=Strict; Path=/')
    // `cookieSecure: false` is what a loopback deployment sets; the attribute
    // would otherwise stop the browser from ever sending this cookie back.
    expect(verified.setCookie.at(0)).not.toContain('Secure')

    const me = await call(port, '/auth', 'me', {}, credential)
    expect(JSON.parse(me.body)).toMatchObject({
      result: { ok: true, value: { authenticated: true, email: EMAIL, admin: false } },
    })
    // Admitted: the gateway is not mounted in this composition, so the request
    // reaches the transport's own 404 rather than the credential fence.
    expect((await call(port, '/api', 'session.list', {}, credential)).status).toBe(404)

    const signedOut = await call(port, '/auth', 'logout', {}, credential)
    expect(signedOut.setCookie.at(0)).toContain('dsh_session=;')
    expect(JSON.parse((await call(port, '/auth', 'me', {}, credential)).body))
      .toMatchObject({ result: { ok: true, value: { authenticated: false } } })
    expect((await call(port, '/api', 'session.list', {}, credential)).status).toBe(401)

    // An endpoint absent from the channel's record is not served, however
    // authenticated the caller is.
    const unknown = await call(port, '/auth', 'nonesuch', {}, credential)
    expect(JSON.parse(unknown.body)).toMatchObject({
      result: { ok: false, error: { code: 'bad-request', message: 'unknown auth endpoint "nonesuch"' } },
    })
    expect(userId).toBe(UserId(String(userId)))
  })

  it('serves the ownership lookup, the cookie writers, and the group notice', { timeout: 60_000 }, async () => {
    const { ctx, port, mailbox } = await loadComposition()
    const userId: UserIdType = await ctx.auth.createUser(EMAIL, PASSWORD)
    // The service key is typed as the transport's RequestGate; this
    // composition mounts the concrete gate, whose own methods are under test.
    const gate = ctx.authGate as AuthGateService

    const sessionId = SessionId('owned-session')
    await ctx.auth.recordSessionOwner(sessionId, userId)
    expect(await gate.ownership.ownerOfSession(sessionId)).toBe(userId)

    const issued = await ctx.auth.issueAuthSession(userId, {})
    const installed = gate.sessionCookie(issued.authSessionId, issued.token, Date.now() + 60_000)
    expect(installed).toMatch(/^dsh_session=[^;]+; HttpOnly; SameSite=Strict; Path=\/; Max-Age=(59|60)$/)
    expect(await gate.authenticate(new Headers({ cookie: asRequestCookie([installed]) })))
      .toMatchObject({ kind: 'user', userId })
    expect(gate.clearedCookie()).toBe('dsh_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')

    // The provider's reset limit refuses the fourth request within the hour.
    // The gate answers all four identically — telling them apart would confirm
    // the address exists — and the refusal reaches the operator's log instead.
    const warnings: string[] = []
    ctx.logger.warn = (message: string) => { warnings.push(message) }
    for (let attempt = 0; attempt < RESET_PER_HOUR + 1; attempt++) {
      const forgotten = await call(port, '/auth', 'password.forgot', { email: EMAIL })
      expect(JSON.parse(forgotten.body)).toMatchObject({ result: { ok: true, value: { status: 'ok' } } })
    }
    expect(warnings).toEqual(['auth-gate: a password reset was refused by the provider rate limit'])

    await ctx.auth.setMembers(ADMIN_GROUP_ID, [userId])
    await gate.notifyAddedToGroup(EMAIL, 'admin')
    // An address with no account is refused, so the notice cannot be used to
    // mail a stranger.
    await gate.notifyAddedToGroup('nobody@example.test', 'admin')
    expect((await mailboxLines(mailbox)).map(message => message.subject))
      .toEqual([...Array.from({ length: RESET_PER_HOUR }, () => 'Reset your password'), 'You were added to the admin group'])
    expect((await ctx.auth.readAudit(10)).map(record => record.event))
      .toContain('auth.group-notice-sent')
    expect(port).toBeGreaterThan(0)
  })
})
