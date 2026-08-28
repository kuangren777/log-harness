/**
 * Wire and service types other packages read without importing the plugin.
 * @module @deepseek-ai/dsh-office-univer/types
 */

// The type of the public `ctx.univer.config`, which a Consumer mounted from
// its own cordis.yml row reads instead of restating the Provider's values.
export type { ResolvedConfig } from './host/config.ts'
export type * from './shared/wire/actions.ts'
export type * from './shared/wire/state.ts'
export type * from './shared/wire/status.ts'
export type * from './host/service/types.ts'
