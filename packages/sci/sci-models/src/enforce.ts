/**
 * The whitelist itself: one `llm/stream` waterfall listener that refuses a
 * model the institution has not opened before the adapter is reached, and
 * passes every other call through untouched.
 *
 * Enforcement lives here rather than in the catalog the selector reads,
 * because `ctx.llm`'s model catalog is advisory — it populates a selector and
 * does not gate a request, so a client that names a model directly would reach
 * the provider whatever the selector showed. `llm/stream` is the one seam every
 * model call passes through.
 * @module @deepseek-ai/dsh-sci-models/enforce
 */

import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, LlmFailure, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { FailMode } from './config.ts'
import type { ModelCatalog } from './catalog.ts'
import type { ModelCatalogSnapshot } from './types.ts'

/** Provider-neutral code for a call refused because the institution has not opened the model. */
export const MODEL_NOT_ALLOWED_CODE = 'MODEL_NOT_ALLOWED'

/** Provider-neutral code for a call refused because the model catalog could not be read at all. */
export const MODEL_CATALOG_UNAVAILABLE_CODE = 'MODEL_CATALOG_UNAVAILABLE'

/**
 * The refusal a user reads when the model is not theirs to call.
 *
 * Bilingual and identical in both halves, because the researcher who hits it
 * may be reading either and the sentence has to carry the one action that
 * clears it: pick another model, or ask the institution's administrator to open
 * this one. It names the model so a saved conversation says which one was lost.
 * @param model - the model id the request named.
 * @returns the refusal message.
 */
export function notAllowedMessage(model: string): string {
  return `模型 ${model} 未对本机构开放，请改选其他模型或联系机构管理员开通。`
    + ` / Model ${model} is not open to your institution — choose another model, or ask your administrator to enable it.`
}

/**
 * The refusal a fail-closed deployment reads when no catalog has been read.
 *
 * Deliberately NOT the not-allowed sentence: the model may well be open, and
 * telling the user to ask for it would send them to an administrator who has
 * already granted it.
 * @returns the refusal message.
 */
export function catalogUnavailableMessage(): string {
  return '模型目录暂时不可用，无法确认可用模型，请稍后重试。'
    + ' / The model catalog is unavailable — the allowed models could not be confirmed; retry shortly.'
}

/** One terminal error finish, which is how a waterfall listener refuses a model call. */
function refusalChunk(failure: LlmFailure): StreamChunk {
  return { type: 'finish', reason: { kind: 'error', failure } }
}

/**
 * Whether one catalog opens a request's exact provider route and model.
 *
 * The route a catalog row names IS the provider route the request selects, so
 * a model opened on `camel-api` does not admit the same id on
 * `deepseek-official`: the two are different endpoints at different prices.
 * @param snapshot - the catalog in force.
 * @param provider - the provider route the request selected.
 * @param model - the model id the request named.
 * @returns whether the call may reach the adapter.
 */
export function allows(snapshot: ModelCatalogSnapshot, provider: string, model: string): boolean {
  return snapshot.models.some(entry => entry.route === provider && entry.model === model)
}

/**
 * Register the whitelist on the mounting context.
 *
 * The built-in DeepSeek models are subject to it exactly as the CaMeL Hub ones
 * are: an institution that unchecked one has decided its members may not spend
 * on it, and a route the harness happens to register itself does not change
 * that decision.
 * @param ctx - the mounting context carrying `llm`.
 * @param catalog - the catalog in force.
 * @param failMode - what happens before any catalog has been read.
 */
export function installEnforcement(ctx: Context, catalog: ModelCatalog, failMode: FailMode): void {
  async function* admit(
    options: GenerateOptions,
    next: () => AsyncIterable<StreamChunk>,
  ): AsyncIterable<StreamChunk> {
    const snapshot = catalog.current
    if (snapshot === undefined) {
      if (failMode === 'closed') {
        yield refusalChunk({ message: catalogUnavailableMessage(), code: MODEL_CATALOG_UNAVAILABLE_CODE })
        return
      }
      yield* next()
      return
    }
    if (!allows(snapshot, options.provider, options.model)) {
      yield refusalChunk({ message: notAllowedMessage(options.model), code: MODEL_NOT_ALLOWED_CODE })
      return
    }
    yield* next()
  }
  ctx.on('llm/stream', (options, next) => admit(options, next))
}
