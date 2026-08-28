import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import type { ResolvedConfig } from '../config.ts'
import type { UniverServiceMethods } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    univer: UniverService
  }
}

/** Service Definition for all Host-side Univer operations. */
export abstract class UniverService extends Service implements UniverServiceMethods {
  /**
   * The deployment's resolved Univer configuration, published by the Provider.
   *
   * Consumers mounted from their own cordis.yml row receive only the keys that
   * row owns, so every timeout, limit, and path they need comes from here. One
   * deployment therefore has exactly one set of values, and a Consumer cannot
   * drift from the Provider it talks to.
   */
  readonly config: ResolvedConfig

  constructor(ctx: Context, config: ResolvedConfig) {
    super(ctx, 'univer')
    this.config = config
  }

  abstract gatewayStatus(): ReturnType<UniverServiceMethods['gatewayStatus']>
  abstract ensureGateway(): ReturnType<UniverServiceMethods['ensureGateway']>
  abstract unitContentStatus(): ReturnType<UniverServiceMethods['unitContentStatus']>
  /**
   * Read one authorized file’s collaboration state and Viewer targets.
   * @param args - the request, and for cancellable operations an abort signal.
   * @returns the operation result, as declared on `UniverServiceMethods`.
   */
  abstract fileState(...args: Parameters<UniverServiceMethods['fileState']>): ReturnType<UniverServiceMethods['fileState']>
  /**
   * Apply one browser review decision to a worktree.
   * @param args - the request, and for cancellable operations an abort signal.
   * @returns the operation result, as declared on `UniverServiceMethods`.
   */
  abstract worktreeAction(...args: Parameters<UniverServiceMethods['worktreeAction']>): ReturnType<UniverServiceMethods['worktreeAction']>
  /**
   * Create one empty Univer container without an implicit Unit.
   * @param args - the request, and for cancellable operations an abort signal.
   * @returns the operation result, as declared on `UniverServiceMethods`.
   */
  abstract newFile(...args: Parameters<UniverServiceMethods['newFile']>): ReturnType<UniverServiceMethods['newFile']>
  /**
   * Report trunk and worktree identities a model needs before editing.
   * @param args - the request, and for cancellable operations an abort signal.
   * @returns the operation result, as declared on `UniverServiceMethods`.
   */
  abstract status(...args: Parameters<UniverServiceMethods['status']>): ReturnType<UniverServiceMethods['status']>
  /**
   * Create one worktree or move it through its lifecycle.
   * @param args - the request, and for cancellable operations an abort signal.
   * @returns the operation result, as declared on `UniverServiceMethods`.
   */
  abstract worktree(...args: Parameters<UniverServiceMethods['worktree']>): ReturnType<UniverServiceMethods['worktree']>
  /**
   * Create or remove one Unit inside a draft worktree.
   * @param args - the request, and for cancellable operations an abort signal.
   * @returns the operation result, as declared on `UniverServiceMethods`.
   */
  abstract unit(...args: Parameters<UniverServiceMethods['unit']>): ReturnType<UniverServiceMethods['unit']>
  /**
   * Inspect one explicit Unit in trunk or a worktree.
   * @param args - the request, and for cancellable operations an abort signal.
   * @returns the operation result, as declared on `UniverServiceMethods`.
   */
  abstract inspectUnitContent(...args: Parameters<UniverServiceMethods['inspectUnitContent']>): ReturnType<UniverServiceMethods['inspectUnitContent']>
  /**
   * Execute Facade code against one Unit in a draft worktree.
   * @param args - the request, and for cancellable operations an abort signal.
   * @returns the operation result, as declared on `UniverServiceMethods`.
   */
  abstract executeUnitContent(...args: Parameters<UniverServiceMethods['executeUnitContent']>): ReturnType<UniverServiceMethods['executeUnitContent']>
  /**
   * Import one Office file as a new Unit in a draft worktree.
   * @param args - the request, and for cancellable operations an abort signal.
   * @returns the operation result, as declared on `UniverServiceMethods`.
   */
  abstract importUnitContent(...args: Parameters<UniverServiceMethods['importUnitContent']>): ReturnType<UniverServiceMethods['importUnitContent']>
  /**
   * Export one explicit Unit to an authorized output path.
   * @param args - the request, and for cancellable operations an abort signal.
   * @returns the operation result, as declared on `UniverServiceMethods`.
   */
  abstract exportUnitContent(...args: Parameters<UniverServiceMethods['exportUnitContent']>): ReturnType<UniverServiceMethods['exportUnitContent']>
  /**
   * Analyze deterministic Slide layout facts without rendering.
   * @param args - the request, and for cancellable operations an abort signal.
   * @returns the operation result, as declared on `UniverServiceMethods`.
   */
  abstract lintUnitLayout(...args: Parameters<UniverServiceMethods['lintUnitLayout']>): ReturnType<UniverServiceMethods['lintUnitLayout']>
  /**
   * Render one explicit Unit into workspace images.
   * @param args - the request, and for cancellable operations an abort signal.
   * @returns the operation result, as declared on `UniverServiceMethods`.
   */
  abstract screenshotUnit(...args: Parameters<UniverServiceMethods['screenshotUnit']>): ReturnType<UniverServiceMethods['screenshotUnit']>
  /**
   * Compile one SVG into Slide mutations on a draft worktree.
   * @param args - the request, and for cancellable operations an abort signal.
   * @returns the operation result, as declared on `UniverServiceMethods`.
   */
  abstract compileSvg(...args: Parameters<UniverServiceMethods['compileSvg']>): ReturnType<UniverServiceMethods['compileSvg']>
  /**
   * Search or show the Facade API reference bundled with this version.
   * @param args - the request, and for cancellable operations an abort signal.
   * @returns the operation result, as declared on `UniverServiceMethods`.
   */
  abstract apiReference(...args: Parameters<UniverServiceMethods['apiReference']>): ReturnType<UniverServiceMethods['apiReference']>
  /**
   * Search, read, export, or clear the bundled SVG resource library.
   * @param args - the request, and for cancellable operations an abort signal.
   * @returns the operation result, as declared on `UniverServiceMethods`.
   */
  abstract resources(...args: Parameters<UniverServiceMethods['resources']>): ReturnType<UniverServiceMethods['resources']>
}
