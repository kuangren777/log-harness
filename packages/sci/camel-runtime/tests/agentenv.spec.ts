// The AgentENV client is the package's only wire boundary: every path, method,
// header, and body it sends is pinned against a local HTTP server, and a
// non-2xx answer surfaces as one error naming the call and what the server said.
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { API_KEY_HEADER, AgentEnvClient } from '@deepseek-ai/dsh-camel-runtime'

const sdk = vi.hoisted(() => ({ connect: vi.fn() }))

vi.mock('@deepseek-ai/dsh-e2b', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-e2b')>()
  // oxlint-disable-next-line typescript/no-extraneous-class -- The SDK contract is a class with a static factory.
  class FakeSandbox {
    static connect(...args: unknown[]): unknown {
      return sdk.connect(...args)
    }
  }
  return { ...actual, Sandbox: FakeSandbox }
})

interface Seen {
  method: string
  path: string
  apiKey: string | undefined
  contentType: string | undefined
  body: string
}

class MockServer {
  readonly seen: Seen[] = []
  respond: (seen: Seen) => { status: number; body?: string } = () => ({ status: 200, body: '{}' })
  endpoint = ''
  private server: Server | undefined

  async start(): Promise<void> {
    this.server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        const seen: Seen = {
          method: request.method ?? '',
          path: request.url ?? '',
          apiKey: request.headers['x-api-key'] as string | undefined,
          contentType: request.headers['content-type'],
          body: Buffer.concat(chunks).toString('utf8'),
        }
        this.seen.push(seen)
        const reply = this.respond(seen)
        response.writeHead(reply.status, { 'content-type': 'application/json' })
        response.end(reply.body ?? '')
      })
    })
    await new Promise<void>((resolve) => { this.server?.listen(0, '127.0.0.1', resolve) })
    this.endpoint = `http://127.0.0.1:${(this.server?.address() as AddressInfo).port}`
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => { this.server?.close(() => { resolve() }) })
  }
}

let server: MockServer
let client: AgentEnvClient

beforeEach(async () => {
  sdk.connect.mockReset()
  server = new MockServer()
  await server.start()
  client = new AgentEnvClient({ endpoint: `${server.endpoint}/`, apiKey: 'k-1' })
})

afterEach(async () => {
  await server.stop()
})

describe('AgentEnvClient', () => {
  it('starts a sandbox with POST /sandboxes, the key header, and an explicit TTL (T1)', async () => {
    server.respond = () => ({ status: 201, body: JSON.stringify({ sandboxID: 'sb-1', templateID: 'tpl', envdVersion: '0.1' }) })
    await expect(client.createSandbox('tpl', 90)).resolves.toEqual({ sandboxID: 'sb-1', templateID: 'tpl', envdVersion: '0.1' })
    expect(server.seen).toEqual([{
      method: 'POST',
      path: '/sandboxes',
      apiKey: 'k-1',
      contentType: 'application/json',
      body: JSON.stringify({ templateID: 'tpl', timeout: 90, autoPause: false }),
    }])
  })

  it('snapshots with and without a name', async () => {
    server.respond = () => ({ status: 201, body: JSON.stringify({ snapshotID: 'snap-1', names: [] }) })
    await expect(client.snapshot('sb/1')).resolves.toEqual({ snapshotID: 'snap-1', names: [] })
    await client.snapshot('sb-1', 'base')
    expect(server.seen.map(seen => [seen.path, seen.body])).toEqual([
      ['/sandboxes/sb%2F1/snapshots', '{}'],
      ['/sandboxes/sb-1/snapshots', JSON.stringify({ name: 'base' })],
    ])
  })

  it('deletes sandboxes and templates without a body, and treats 404 as already gone', async () => {
    server.respond = () => ({ status: 204 })
    await client.kill('sb-1')
    server.respond = () => ({ status: 404, body: '{"message":"gone"}' })
    await client.kill('sb-1')
    await client.deleteTemplate('snap-1')
    expect(server.seen.map(seen => [seen.method, seen.path, seen.contentType, seen.body])).toEqual([
      ['DELETE', '/sandboxes/sb-1', undefined, ''],
      ['DELETE', '/sandboxes/sb-1', undefined, ''],
      ['DELETE', '/templates/snap-1', undefined, ''],
    ])
  })

  it('reports a failed call with method, path, status, and the server text', async () => {
    server.respond = () => ({ status: 409, body: '{"message":"sandbox is paused"}' })
    await expect(client.snapshot('sb-1')).rejects.toThrow(
      'camel-runtime: agentenv POST /sandboxes/sb-1/snapshots failed with 409: {"message":"sandbox is paused"}',
    )
    server.respond = () => ({ status: 500 })
    await expect(client.kill('sb-1')).rejects.toThrow('camel-runtime: agentenv DELETE /sandboxes/sb-1 failed with 500')
  })

  it('reports a failed call whose body cannot be read with the status alone', async () => {
    const failing = new AgentEnvClient({
      endpoint: 'http://agentenv.test',
      apiKey: 'k-1',
      fetch: () => Promise.resolve({
        ok: false,
        status: 502,
        text: () => Promise.reject(new Error('stream broke')),
      } as unknown as Response),
    })
    await expect(failing.kill('sb-1')).rejects.toThrow('camel-runtime: agentenv DELETE /sandboxes/sb-1 failed with 502')
  })

  it('connects through the E2B SDK against the same endpoint with the same key', async () => {
    sdk.connect.mockResolvedValue('handle')
    await expect(client.connect({ sandboxID: 'sb-1', templateID: 'tpl' })).resolves.toBe('handle')
    expect(sdk.connect.mock.calls).toEqual([
      ['sb-1', { apiKey: 'k-1', apiUrl: server.endpoint, sandboxUrl: server.endpoint }],
    ])
  })

  it('names the header AgentENV authenticates with', () => {
    expect(API_KEY_HEADER).toBe('X-API-Key')
  })
})
