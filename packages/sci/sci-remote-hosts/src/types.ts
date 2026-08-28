/**
 * Durable vocabulary of the remote-host layer: one registered machine, the
 * connection options every rendered entry carries, the four RPC request and
 * result forms, and the ranked causes an `ssh -v` transcript is classified into.
 *
 * A host alias is a plain string rather than a `Branded` id: the model types it
 * verbatim into `ssh <alias>`, the user reads it in a picker, and the archived
 * skill teaches `grep '^Host ' ~/.ssh/config` as the way to enumerate them, so
 * it is a name the whole system is meant to read, not an opaque token.
 * @module @deepseek-ai/dsh-sci-remote-hosts/types
 */

/**
 * One remote machine as the managed block records it. The private key is
 * deliberately absent: it lives in the credential seam, and only its path
 * reaches this record.
 */
export interface RemoteHost {
  /** Name of the entry, used as `ssh <alias>` and as the key file's suffix. */
  readonly alias: string
  /** The `HostName` the entry resolves to: a DNS name or a literal address. */
  readonly hostName: string
  /** The `User` the entry authenticates as. */
  readonly user: string
  /** The `Port` the entry connects to; absent leaves ssh its own default of 22. */
  readonly port?: number
  /** Whether the entry is live; a switched-off host stays in the block, commented out. */
  readonly enabled: boolean
}

/** The deployment-owned values every rendered entry shares. */
export interface ManagedBlockOptions {
  /** Absolute directory holding the per-alias private keys, without a trailing slash. */
  readonly identityDir: string
  /** Seconds ssh waits for the TCP connection before failing the call. */
  readonly connectTimeoutSeconds: number
  /** Seconds between keep-alive probes on an established connection. */
  readonly serverAliveIntervalSeconds: number
}

/** One registered host as a caller sees it, with the key path the entry points at. */
export interface RemoteHostView extends RemoteHost {
  /** Absolute path of this alias's private key inside the sandbox. */
  readonly identityFile: string
}

/** Everything `sci.hosts.list` returns. */
export interface HostsListValue {
  /** The registered hosts in alias order, switched-off entries included. */
  readonly hosts: readonly RemoteHostView[]
}

/** One host registration or replacement. */
export interface UpsertHostRequest {
  /** Name of the entry; lowercase letters, digits, and hyphens, starting with a letter. */
  readonly alias: string
  /** The `HostName` to connect to. */
  readonly hostName: string
  /** The `User` to authenticate as. */
  readonly user: string
  /** The `Port` to connect to; omitted leaves ssh its default. */
  readonly port?: number
  /** PEM private key material; written through the credential seam and never logged. */
  readonly privateKey: string
  /** Whether the entry is live once written; omitted registers it enabled. */
  readonly enabled?: boolean
}

/** One host deregistration. */
export interface RemoveHostRequest {
  /** The entry to remove. */
  readonly alias: string
}

/** One switch of an existing host's live state. */
export interface ToggleHostRequest {
  /** The entry to switch. */
  readonly alias: string
  /** The state to leave it in. */
  readonly enabled: boolean
}

/**
 * Why one host operation was refused.
 *
 * `malformed-config` is the operator-visible half of the bidirectional
 * guarantee: a start marker with no end marker leaves no way to tell the
 * managed region from the user's own entries, and rewriting on a guess would
 * either duplicate the block or swallow everything after it.
 */
export type HostsFailureCode = 'invalid-alias' | 'invalid-field' | 'unknown-alias' | 'malformed-config'

/** One refused host operation, in terms a configuration surface can render. */
export interface HostsFailure {
  /** Which refusal this is. */
  readonly code: HostsFailureCode
  /** The alias the operation named; absent when the refusal is about the file rather than one entry. */
  readonly alias?: string
  /** One sentence naming what to change; never carries key material. */
  readonly detail: string
}

/**
 * The result of one host operation.
 * @template T - the value the operation produces when it succeeds.
 */
export type HostsResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: HostsFailure }

/**
 * Why one `ssh <alias>` attempt failed, as an `ssh -v` transcript shows it.
 *
 * The first three are the archived skill's own ranked causes
 * (`ClawsGO-System/01-Skills/_raw-skills/clawsgo-remote-hosts/SKILL.md`, "When a
 * connection fails"). `key-unusable` is separated from them because the same
 * skill states that a private key must be `chmod 600` or ssh refuses it: that
 * failure never reaches the server at all, and reporting it as a missing
 * `authorized_keys` entry would send the user to fix a machine that is fine.
 */
export type SshFailureCause =
  | 'host-unreachable'
  | 'key-unusable'
  | 'wrong-username'
  | 'key-not-authorized'
  | 'unclassified'

/** One classified connection failure and what to do about it. */
export interface SshDiagnosis {
  /** The cause the transcript supports. */
  readonly cause: SshFailureCause
  /** The transcript line the classification rests on; absent when nothing matched. */
  readonly evidence?: string
  /** What the user should change, in one sentence. */
  readonly remedy: string
}
