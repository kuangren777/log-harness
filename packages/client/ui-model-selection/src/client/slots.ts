/**
 * ModelSelect's injected face. The target 'conversation.input.model' seat is
 * declared (children table) and typed by ui-conversation's composer-bar
 * entry; this package only contributes the single occupant, so no SlotMap
 * merge lives here.
 */
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ModelDirectoryState } from './directory.ts'

/**
 * Advisory lines another plugin attaches to one model row. The text is the
 * contributor's own vocabulary, already localized: this package places the
 * lines on the row it names and never reads or reformats them.
 */
export interface ModelHint {
  /** Provider group the row belongs to (`ModelProviderGroup.id`). */
  readonly provider: string
  /** Provider-owned model id (`ModelProviderGroup.models[].id`). */
  readonly model: string
  /** Lines of one row's bubble, shown in this order. */
  readonly lines: readonly string[]
}

/**
 * Reads every hint its contributor currently knows, called once per seat mount.
 * Hints for models the directory does not list are ignored, so a source may
 * answer with its whole catalog. A rejection and an empty answer are the same
 * outcome here — the rows stay unannotated — so a source reports its own
 * failures rather than raising them at the seat.
 */
export type ModelHintSource = () => Promise<readonly ModelHint[]>

/** Injected business face of the composer model seat. */
export interface ModelSelectInjected {
  /** Whether this session supports Agent-bound model inspection and selection. */
  available: boolean
  /** The session's shared directory store (same instance the /model popup reads). */
  directory: SnapshotStore<ModelDirectoryState>
  /** Refresh the advisory directory (fire-and-forget; errors land on the store). */
  load: () => void
  /**
   * Select a complete provider/model/reasoning selection.
   * @param selection - model selection and optional adapter-owned effort.
   * @returns whether the host accepted the selection.
   */
  select: (selection: ModelSelection) => Promise<boolean>
  /**
   * The registered hint source, absent while no plugin registered one. Without
   * it the rows carry no bubble and the seat renders exactly as it did before
   * any source existed.
   */
  loadHints?: ModelHintSource
}
