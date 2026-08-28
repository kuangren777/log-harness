/**
 * The page global through which the Host half publishes connection facts the
 * browser half cannot derive from `location`. The Node half contributes it as
 * a `global` index-injection row; the browser half reads it while building
 * `ctx.connection`. Both halves import this module so the property name and
 * the value's fields have one home.
 */

/** Property name of the connection boot global on `globalThis`. */
export const CONNECTION_BOOT_GLOBAL = '__DSH_CONNECTION__'

/** Connection facts the Host publishes to the page. */
export interface ConnectionBootFacts {
  /**
   * Whether this deployment opted its trusted authorities into the privileged
   * method set. False (and absent) means the configuration plane is
   * loopback-only, so a page on a public authority keeps its settings,
   * credential, and preset-authoring surfaces in memory.
   */
  privilegedTrustedHosts: boolean
}

/** Page global carrying {@link ConnectionBootFacts}; absent on a page the Host did not render. */
export interface ConnectionBootGlobal {
  __DSH_CONNECTION__?: ConnectionBootFacts
}
