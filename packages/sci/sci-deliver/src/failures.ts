/**
 * Re-injection of shell-delivery failures into the model's next prompt.
 *
 * The studied platform's stdout-sentinel delivery channel failed silently: a
 * mistyped path produced no card, no error, and no signal to the agent, which
 * went on believing the file had reached the user. Here every rejected spool
 * entry lands in this buffer and is materialised once as prompt context, so the
 * next request the model sees names the failure and its reason.
 *
 * "Once" is the point: {@link DeliveryFailureBuffer.take} clears what it
 * returns, so the reminder is present in the assembly that follows the failure
 * and absent in the one after that.
 * @module @deepseek-ai/dsh-sci-deliver/src/failures
 */

/** One rejected spool entry, as the model will read it. */
export interface DeliveryFailure {
  /** Path the entry named, or the entry's own path when it named none. */
  readonly path: string
  /** The validation chain's model-facing reason. */
  readonly reason: string
}

/** Registry name of the prompt context this package materialises failures into. */
export const DELIVERY_FAILURES_CONTEXT = 'sci:delivery-failures'

/**
 * Order of the failure context. It sits below the standing reminders
 * `@deepseek-ai/dsh-sci-prompt` registers (10–40) so a per-turn incident reads
 * after the rules it violated.
 */
export const DELIVERY_FAILURES_ORDER = 50

/**
 * Render pending failures as model-facing prompt context.
 * @param failures - the failures to report, in the order they were recorded.
 * @returns the context text, or the empty string for no failures (an empty
 *   context contributes nothing to the assembly).
 */
export function renderDeliveryFailures(failures: readonly DeliveryFailure[]): string {
  if (failures.length === 0) return ''
  const head = failures.length === 1
    ? '1 shell delivery failed and reached nobody:'
    : `${failures.length} shell deliveries failed and reached nobody:`
  const lines = failures.map(failure => `- ${failure.path}: ${failure.reason}`)
  return [head, ...lines, 'Fix the path or the manifest and deliver those files again.'].join('\n')
}

/** Failures recorded since the model was last told about them. */
export class DeliveryFailureBuffer {
  private pending: DeliveryFailure[] = []

  /**
   * Record one rejected spool entry for the next assembly.
   * @param failure - the path the entry named and the reason it was refused.
   */
  record(failure: DeliveryFailure): void {
    this.pending.push(failure)
  }

  /**
   * Materialise every unread failure and clear them, so the reminder appears in
   * exactly one assembly.
   * @returns the context text, or the empty string when nothing is pending.
   */
  take(): string {
    const text = renderDeliveryFailures(this.pending)
    this.pending = []
    return text
  }
}
