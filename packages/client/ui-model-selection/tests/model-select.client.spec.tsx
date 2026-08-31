// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ComponentProps } from 'react'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import type { ModelHint } from '../src/client/slots.ts'
import { ModelSelect } from '../src/client/ModelSelect.tsx'
import { zh } from '../src/client/locales.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'

// The seat's key domain is model ∪ common; the stub mirrors the real lookup
// chain: package dictionary, then common vocabulary, then the key.
const t: ComponentProps<typeof ModelSelect>['t'] = (key, params) => {
  const template = (zh as Record<string, string>)[key]
    ?? (commonZh as Record<string, string>)[key]
    ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

const reasoning = {
  efforts: [
    { id: 'off', name: 'Off' },
    { id: 'high', name: 'High' },
    { id: 'max', name: 'Max', description: 'Largest budget' },
  ],
  defaultEffort: 'high',
}

function state(overrides: Partial<ModelDirectoryState> = {}): ModelDirectoryState {
  return {
    current: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    routable: true,
    groups: [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', reasoning }],
    }],
    failures: [],
    status: 'ready',
    error: null,
    ...overrides,
  }
}

afterEach(cleanup)

describe('ModelSelect reasoning effort', () => {
  it('renders adapter metadata and submits the effort as part of the session selection', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    const select = vi.fn(async (selection: ModelSelection) => {
      directory.set(state({ current: selection }))
      return true
    })
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    const trigger = screen.getByRole('button', {
      name: '选择模型，当前 DeepSeek-V4-Flash，推理等级 High',
    })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent))
      .toEqual(['Off', 'High', 'MaxLargest budget'])

    fireEvent.click(screen.getByRole('menuitemradio', { name: /Max/ }))
    await waitFor(() => {
      expect(select).toHaveBeenCalledWith({
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        reasoningEffort: 'max',
      })
      expect(trigger.getAttribute('aria-label')).toBe('选择模型，当前 DeepSeek-V4-Flash，推理等级 Max')
    })
  })

  it('offers provider default only when the adapter does not configure a model default', () => {
    const directory = createSnapshotStore(state({
      groups: [{
        id: 'provider',
        name: 'Provider',
        models: [{
          id: 'model',
          name: 'Model',
          reasoning: { efforts: [{ id: 'standard', name: 'Standard' }] },
        }],
      }],
      current: { provider: 'provider', model: 'model' },
    }))
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', {
      name: '选择模型，当前 Model，推理等级 Default',
    }))
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent))
      .toEqual(['Default', 'Standard'])
  })

  it('prompts for a selection when the current model is no longer advertised', () => {
    const directory = createSnapshotStore(state({
      current: { provider: 'deepseek-official', model: 'removed-model' },
    }))
    const select = vi.fn().mockResolvedValue(true)
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    const trigger = screen.getByRole('button', { name: '选择模型' })
    expect(trigger.textContent).toContain('选择模型')
    fireEvent.click(trigger)
    expect(screen.queryByRole('menuitem', { name: /推理等级/ })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    expect(screen.queryByText('removed-model')).toBeNull()
    expect(screen.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash' })).toBeTruthy()
  })

  it('announces a rejected selection as a transient toast and keeps the in-menu strip for loads', async () => {
    const groups = [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', reasoning },
        { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
      ],
    }]
    const directory = createSnapshotStore<ModelDirectoryState>(state({ groups }))
    const select = vi.fn(async () => {
      directory.set(state({ groups, status: 'error', error: 'model-unavailable: session already contains images' }))
      return false
    })
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', { name: /选择模型|当前/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /DeepSeek-V4-Pro/ }))
    const toast = await screen.findByRole('alert')
    expect(toast.textContent).toContain('模型操作失败：model-unavailable: session already contains images')
    // The selection failure does not render the in-menu load strip (no Retry).
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
  })

  it('renders no Agent-bound control for an addressed subagent session', () => {
    const load = vi.fn()
    render(<ModelSelect
      locked={false}
      available={false}
      directory={createSnapshotStore(state())}
      load={load}
      select={vi.fn().mockResolvedValue(false)}
      t={t}
    />)

    expect(screen.queryByRole('button')).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })
})

describe('ModelSelect row hints', () => {
  const groups = [{
    id: 'deepseek-official',
    name: 'DeepSeek',
    models: [
      { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', reasoning },
      { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
    ],
  }]

  /** Open the model pane of a seat whose hint source answers with `hints`. */
  async function openWith(loadHints: ComponentProps<typeof ModelSelect>['loadHints']) {
    const view = render(<ModelSelect
      locked={false}
      available
      directory={createSnapshotStore<ModelDirectoryState>(state({ groups }))}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      {...loadHints === undefined ? {} : { loadHints }}
      t={t}
    />)
    fireEvent.click(screen.getByRole('button', { name: /选择模型|当前/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    return view
  }

  it('describes a hinted row and shows its lines on hover, leaving unhinted rows untouched', async () => {
    await openWith(async () => [
      { provider: 'deepseek-official', model: 'deepseek-v4-flash', lines: ['官方输入 $0.4400 / 1M', '倍率 ×1.500'] },
      // A hint for a model this directory does not list annotates nothing.
      { provider: 'camel-api', model: 'gpt-5', lines: ['官方输入 $2.0000 / 1M'] },
    ])

    const hinted = screen.getByRole('menuitemradio', { name: /DeepSeek-V4-Flash/ })
    // The rows render before the source answers; the description lands with it.
    await waitFor(() => { expect(hinted.getAttribute('aria-describedby')).not.toBeNull() })
    expect(document.getElementById(hinted.getAttribute('aria-describedby') as string)?.textContent)
      .toBe('官方输入 $0.4400 / 1M 倍率 ×1.500')
    // The price is not part of the row's name: that stays the model.
    expect(hinted.textContent).toBe('DeepSeek-V4-Flash')
    expect(screen.getByRole('menuitemradio', { name: /DeepSeek-V4-Pro/ }).getAttribute('aria-describedby'))
      .toBeNull()

    fireEvent.mouseEnter(hinted)
    const bubble = await screen.findByRole('tooltip')
    expect(bubble.textContent).toBe('官方输入 $0.4400 / 1M\n倍率 ×1.500')
  })

  it('renders the rows unannotated when no source is injected, and when the one injected fails', async () => {
    const plain = await openWith(undefined)
    expect(screen.getByRole('menuitemradio', { name: /DeepSeek-V4-Flash/ }).getAttribute('aria-describedby'))
      .toBeNull()
    expect(screen.queryByRole('tooltip')).toBeNull()
    plain.unmount()

    await openWith(async () => { throw new Error('gate unreachable') })
    // The rejection settles before this row is asked for its description.
    await waitFor(() => {
      expect(screen.getByRole('menuitemradio', { name: /DeepSeek-V4-Flash/ }).getAttribute('aria-describedby'))
        .toBeNull()
    })
  })

  it('drops a hint answer that arrives after the seat is gone', async () => {
    let settle: (hints: ModelHint[]) => void = () => undefined
    const view = await openWith(() => new Promise<ModelHint[]>((resolve) => { settle = resolve }))
    view.unmount()
    settle([{ provider: 'deepseek-official', model: 'deepseek-v4-flash', lines: ['官方输入 $0.4400 / 1M'] }])
    await waitFor(() => { expect(screen.queryByRole('menuitemradio')).toBeNull() })
  })
})
