/**
 * One persona's configuration page: base model, the three tool permissions,
 * and the enable switch.
 *
 * There is no save button, because there is nothing to save: every gesture
 * writes through the host and the page redraws from the agent the host
 * answers with, so the indicator states where that write stands instead of
 * offering a button that would do nothing. The model choices are the host's
 * catalog — no control is offered for a setting the host would not honour,
 * which is also why there is no reasoning-depth control: `AgentOptions`
 * (packages/core/agent/src/runtime-types.ts:24-31) carries no effort field,
 * so a depth chosen here would reach nothing.
 */
import type { Translate } from '@deepseek-ai/dsh-client-locale/client'
import type { AgentPatch, ModelProvider, RosterAgent } from './contract.ts'
import type { SaveStatus } from './stores.ts'
import type { SciAgentsKey } from './locales.ts'
import { PageHeader } from './PageHeader.tsx'
import { Switch } from './Switch.tsx'
import css from './ConfigPage.module.css'

/** Owner-controlled configuration-page props. */
export interface ConfigPageProps {
  /** The persona being configured, as the host last reported it. */
  agent: RosterAgent
  /** Its position in the roster, which picks the header glyph. */
  glyphAt: number
  /** The host's model catalog; empty when it could not be read. */
  catalog: readonly ModelProvider[]
  /** Where the last configuration write stands. */
  save: SaveStatus
  /** The failure code of the last write, or null. */
  saveError: string | null
  /** Return to the roster. */
  onBack: () => void
  /** Write one change through the host. */
  onPatch: (patch: AgentPatch) => void
  /** Localized configuration copy. */
  t: Translate<SciAgentsKey>
}

/**
 * Render the configuration page.
 * @param props - the page's owner-controlled props.
 * @returns the three setting cards under the persona header.
 */
export function ConfigPage(
  { agent, glyphAt, catalog, save, saveError, onBack, onPatch, t }: ConfigPageProps,
) {
  const saveText = save === 'saving'
    ? t('save.saving')
    : save === 'saved'
      ? t('save.saved')
      : save === 'error' ? t('save.error', { code: saveError }) : t('save.idle')
  return (
    <div className={css.root}>
      <PageHeader
        glyphAt={glyphAt}
        title={t('page.config', { name: agent.name })}
        role={agent.role}
        onBack={onBack}
        t={t}
      />
      <div
        className={save === 'error' ? `${css.save} ${css.saveFailed}` : css.save}
        role="status"
        aria-live="polite"
      >
        {saveText}
      </div>
      <div className={css.card}>
        <div className={css.cardTitle}>{t('config.model')}</div>
        {catalog.length === 0
          ? <p className={css.note}>{t('config.modelEmpty')}</p>
          : (
            <>
              {catalog.map(provider => (
                <div key={provider.provider} className={css.provider}>
                  <div className={css.providerName}>{provider.provider}</div>
                  <div className={css.segmented} role="group" aria-label={provider.provider}>
                    {provider.models.map((option) => {
                      const current = agent.model?.provider === provider.provider
                        && agent.model.model === option.model
                      return (
                        <button
                          key={option.model}
                          type="button"
                          aria-pressed={current}
                          className={current ? `${css.segment} ${css.segmentOn}` : css.segment}
                          onClick={() => {
                            onPatch({ model: { provider: provider.provider, model: option.model } })
                          }}
                        >
                          {option.model}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
              {agent.model === undefined && <p className={css.note}>{t('config.modelFollows')}</p>}
            </>
          )}
      </div>
      <div className={css.card}>
        <div className={css.cardTitle}>{t('config.permissions')}</div>
        <Switch
          checked={agent.permissions.web}
          label={t('perm.web')}
          description={t('perm.webDesc')}
          onChange={(next) => { onPatch({ permissions: { ...agent.permissions, web: next } }) }}
        />
        <Switch
          checked={agent.permissions.code}
          label={t('perm.code')}
          description={t('perm.codeDesc')}
          onChange={(next) => { onPatch({ permissions: { ...agent.permissions, code: next } }) }}
        />
        <Switch
          checked={agent.permissions.writeLibrary}
          label={t('perm.writeLibrary')}
          description={t('perm.writeLibraryDesc')}
          onChange={(next) => {
            onPatch({ permissions: { ...agent.permissions, writeLibrary: next } })
          }}
        />
      </div>
      <div className={css.card}>
        <Switch
          checked={agent.enabled}
          label={t('config.enable')}
          description={t('config.enableDesc', { tool: agent.toolName })}
          onChange={(next) => { onPatch({ enabled: next }) }}
        />
      </div>
    </div>
  )
}
