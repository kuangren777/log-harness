/**
 * Thin client for the AgentENV native API — the calls the variant engine
 * needs, and the E2B SDK connection that turns a sandbox id into a command and
 * file surface. Snapshots and templates share one namespace in AgentENV, so a
 * fork of a variant is `createSandbox(snapshotID)`.
 * @module @deepseek-ai/dsh-camel-runtime/agentenv
 */

import { Sandbox } from '@deepseek-ai/dsh-e2b'
import type { AgentEnvSandbox, AgentEnvSandboxDetail, AgentEnvSnapshot } from './types.ts'

/** Header AgentENV authenticates native API calls with. */
export const API_KEY_HEADER = 'X-API-Key'

/** Configuration of one {@link AgentEnvClient}. */
export interface AgentEnvClientOptions {
  /** Base URL of the AgentENV server, without a trailing slash. */
  readonly endpoint: string
  /** Server API key. It is never forwarded into a sandbox. */
  readonly apiKey: string
  /** Replaceable fetch, for tests. */
  readonly fetch?: typeof fetch
}

/** The surface the variant engine drives; {@link AgentEnvClient} is the real one. */
export interface AgentEnvApi {
  /** Start a sandbox from a template or snapshot; it auto-pauses after `timeoutSeconds` idle. */
  createSandbox(templateID: string, timeoutSeconds: number): Promise<AgentEnvSandbox>
  /** Resume a paused sandbox (a running one is untouched) and extend its TTL; `undefined` when AgentENV no longer has it. */
  connect(sandboxID: string, timeoutSeconds: number): Promise<AgentEnvSandbox | undefined>
  /** Current state of a sandbox; `undefined` when AgentENV no longer has it. */
  getSandbox(sandboxID: string): Promise<AgentEnvSandboxDetail | undefined>
  snapshot(sandboxID: string, name?: string): Promise<AgentEnvSnapshot>
  kill(sandboxID: string): Promise<void>
  deleteTemplate(templateID: string): Promise<void>
  /** Open the E2B SDK surface of a running sandbox. */
  open(sandbox: AgentEnvSandbox): Promise<Sandbox>
}

/**
 * Render one failed response as the error the caller sees: method, path,
 * status, and whatever the server said.
 */
async function failure(method: string, path: string, response: Response): Promise<Error> {
  let body = ''
  try {
    body = (await response.text()).trim()
  } catch (_unreadable) {
    // A body that cannot be read adds nothing to the status line.
  }
  return new Error(`camel-runtime: agentenv ${method} ${path} failed with ${response.status}${body.length === 0 ? '' : `: ${body}`}`)
}

/** The real AgentENV client. */
export class AgentEnvClient implements AgentEnvApi {
  private readonly endpoint: string
  private readonly apiKey: string
  private readonly fetchImpl: typeof fetch

  constructor(options: AgentEnvClientOptions) {
    this.endpoint = options.endpoint.replace(/\/+$/, '')
    this.apiKey = options.apiKey
    this.fetchImpl = options.fetch ?? fetch
  }

  /**
   * Start one sandbox from a template or snapshot. It pauses itself after
   * `timeoutSeconds` without a `connect`, keeping memory and disk.
   * @param templateID - template or snapshot identifier (or alias).
   * @param timeoutSeconds - idle TTL before the automatic pause.
   * @returns the started sandbox record.
   * @throws when the server answers outside 2xx.
   */
  async createSandbox(templateID: string, timeoutSeconds: number): Promise<AgentEnvSandbox> {
    const answer = await this.request('POST', '/sandboxes', { templateID, timeout: timeoutSeconds, autoPause: true })
    return (await answer.json()) as AgentEnvSandbox
  }

  /**
   * Resume a sandbox if paused and extend its TTL from now.
   * @param sandboxID - the sandbox to reach.
   * @param timeoutSeconds - new idle TTL.
   * @returns the sandbox record, or `undefined` when AgentENV answers 404.
   */
  async connect(sandboxID: string, timeoutSeconds: number): Promise<AgentEnvSandbox | undefined> {
    const answer = await this.request('POST', `/sandboxes/${encodeURIComponent(sandboxID)}/connect`, { timeout: timeoutSeconds }, [404])
    if (answer.status === 404) return undefined
    return (await answer.json()) as AgentEnvSandbox
  }

  /**
   * Read a sandbox's current state.
   * @param sandboxID - the sandbox to read.
   * @returns the detail record, or `undefined` when AgentENV answers 404.
   */
  async getSandbox(sandboxID: string): Promise<AgentEnvSandboxDetail | undefined> {
    const answer = await this.request('GET', `/sandboxes/${encodeURIComponent(sandboxID)}`, undefined, [404])
    if (answer.status === 404) return undefined
    return (await answer.json()) as AgentEnvSandboxDetail
  }

  /**
   * Capture a running sandbox's memory and filesystem as a new snapshot.
   * @param sandboxID - the sandbox to capture; it keeps running.
   * @param name - optional alias.
   * @returns the snapshot record.
   */
  async snapshot(sandboxID: string, name?: string): Promise<AgentEnvSnapshot> {
    const answer = await this.request('POST', `/sandboxes/${encodeURIComponent(sandboxID)}/snapshots`, name === undefined ? {} : { name })
    return (await answer.json()) as AgentEnvSnapshot
  }

  /**
   * Kill and delete one sandbox. A sandbox that is already gone is not an error.
   * @param sandboxID - the sandbox to delete.
   */
  async kill(sandboxID: string): Promise<void> {
    await this.request('DELETE', `/sandboxes/${encodeURIComponent(sandboxID)}`, undefined, [404])
  }

  /**
   * Delete one template or snapshot. An already-deleted one is not an error.
   * @param templateID - template or snapshot identifier.
   */
  async deleteTemplate(templateID: string): Promise<void> {
    await this.request('DELETE', `/templates/${encodeURIComponent(templateID)}`, undefined, [404])
  }

  /**
   * Open the E2B SDK surface of one running sandbox. The SDK fetches the
   * sandbox's envd access token itself, so a secure sandbox needs nothing more.
   * @param sandbox - a record `createSandbox` or `connect` returned.
   * @returns the connected SDK handle.
   */
  open(sandbox: AgentEnvSandbox): Promise<Sandbox> {
    return Sandbox.connect(sandbox.sandboxID, {
      apiKey: this.apiKey,
      apiUrl: this.endpoint,
      sandboxUrl: this.endpoint,
    })
  }

  private async request(method: string, path: string, body: unknown, tolerated: readonly number[] = []): Promise<Response> {
    const response = await this.fetchImpl(`${this.endpoint}${path}`, {
      method,
      headers: {
        [API_KEY_HEADER]: this.apiKey,
        ...body === undefined ? {} : { 'content-type': 'application/json' },
      },
      ...body === undefined ? {} : { body: JSON.stringify(body) },
    })
    if (response.ok || tolerated.includes(response.status)) return response
    throw await failure(method, path, response)
  }
}
