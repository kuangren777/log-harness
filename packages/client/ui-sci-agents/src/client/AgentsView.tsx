/**
 * The full-bleed agent view: the roster, one persona's configuration, and one
 * persona's delegation log, one page at a time.
 *
 * Every fact on screen was read from the host in this component's one load
 * pass — the roster with its real month counts, each persona's delegation log
 * (which is also what makes a card read 「运行中」 rather than 「待命」), and
 * the model catalog the configuration page offers. The wire never reaches
 * this file: the injected face answers with plain records or a failure code.
 */
import { useCallback, useEffect } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { AgentPatch, SciAgentsInjected } from './contract.ts'
import type { AgentsStore } from './stores.ts'
import { ConfigPage } from './ConfigPage.tsx'
import { LogPage } from './LogPage.tsx'
import { RosterPage } from './RosterPage.tsx'
import css from './AgentsView.module.css'

/** Full props of the agent view, composed from its four shares. */
export type AgentsViewProps =
  PropsRuntime<'view', 'agents'>
  & PropsStore<AgentsStore>
  & InjectFace<SciAgentsInjected>
  & PropsLocale<'sci-agents'>

/**
 * Render the agent view.
 * @param props - the view's composed slot props.
 * @returns whichever of the three pages the store says is current.
 */
export function AgentsView(
  { useStore, actions, roster, configure, calls, models, openSession, t }: AgentsViewProps,
) {
  const page = useStore(s => s.page)
  const persona = useStore(s => s.persona)
  const agents = useStore(s => s.agents)
  const status = useStore(s => s.status)
  const error = useStore(s => s.error)
  const logs = useStore(s => s.callsByPersona)
  const logErrors = useStore(s => s.callsErrors)
  const catalog = useStore(s => s.models)
  const save = useStore(s => s.save)
  const saveError = useStore(s => s.saveError)

  const readCalls = useCallback(async (id: string): Promise<void> => {
    const outcome = await calls(id)
    if (outcome.ok) actions.setCalls(id, outcome.calls)
    else actions.setCallsFailed(id, outcome.code)
  }, [calls, actions])

  // One pass per mount: the store outlives this component, so a settled read
  // after an unmount still lands where the next mount reads it.
  useEffect(() => {
    void (async () => {
      actions.beginLoad()
      const outcome = await roster()
      if (!outcome.ok) {
        actions.failed(outcome.code)
        return
      }
      actions.loaded(outcome.agents)
      actions.setModels(await models())
      // The status pill is a fact about the log, so the roster reads every
      // persona's log too rather than guessing at 「运行中」.
      await Promise.all(outcome.agents.map(async agent => readCalls(agent.persona)))
    })()
  }, [roster, models, readCalls, actions])

  const selectedAt = agents.findIndex(candidate => candidate.persona === persona)
  const selected = agents[selectedAt]

  const patch = (id: string, change: AgentPatch): void => {
    actions.beginSave()
    void configure(id, change).then((outcome) => {
      if (outcome.ok) actions.saved(outcome.agent)
      else actions.saveFailed(outcome.code)
    })
  }

  // A page about a persona the roster no longer carries has nothing to draw,
  // so the view falls back to the roster rather than to an empty frame.
  const body = selected === undefined || page === 'roster'
    ? (
      <RosterPage
        agents={agents}
        logs={logs}
        status={status}
        error={error}
        onConfigure={(id) => { actions.showConfig(id) }}
        onLog={(id) => {
          actions.showLog(id)
          void readCalls(id)
        }}
        t={t}
      />
    )
    : page === 'config'
      ? (
        <ConfigPage
          agent={selected}
          glyphAt={selectedAt}
          catalog={catalog}
          save={save}
          saveError={saveError}
          onBack={() => { actions.showRoster() }}
          onPatch={(change) => { patch(selected.persona, change) }}
          t={t}
        />
      )
      : (
        <LogPage
          agent={selected}
          glyphAt={selectedAt}
          calls={logs[selected.persona]}
          error={logErrors[selected.persona]}
          onBack={() => { actions.showRoster() }}
          onOpen={openSession}
          t={t}
        />
      )

  return <div className={css.root}><div className={css.inner}>{body}</div></div>
}
