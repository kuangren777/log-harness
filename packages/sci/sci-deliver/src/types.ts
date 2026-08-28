/**
 * Durable vocabulary of the delivery layer: the branded delivery identity, the
 * request one delivery carries, and the two session events this package
 * appends.
 * @module @deepseek-ai/dsh-sci-deliver/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ManifestKind } from '@deepseek-ai/dsh-sci-manifest'

/**
 * Opaque identity of one delivery. It names the snapshot directory the
 * delivered bytes were copied into and the card a user interface renders, so it
 * crosses the session-log, filesystem, and user-interface boundaries and is
 * branded rather than a bare string.
 */
export type DeliveryId = Branded<'DeliveryId'>

/**
 * What was delivered. `file` is an ordinary file from the delivery directory;
 * the other three are bundle manifests, which open a live workbench on the
 * user's side and may therefore be delivered only once per session.
 */
export type DeliveryKind = 'file' | ManifestKind

/**
 * Which channel produced a delivery. `tool` is the `deliver_files` call;
 * `spool` is the in-sandbox `sci deliver` command. The marker is a DISPLAY
 * field only: `<spoolDir>/pending/` is model-writable, so a model can write an
 * entry that this harness then reports as `spool`. Correctness comes solely
 * from re-running `validateDelivery` on this side, never from this field.
 */
export type DeliveryVia = 'tool' | 'spool'

/** One requested delivery, as the tool schema and one spool entry both express it. */
export interface DeliveryRequest {
  /** Path of the file to deliver, as the requester wrote it. */
  readonly path: string
  /** Card title shown to the user. */
  readonly title: string
  /** One-sentence explanation of what the file is; absent when the requester gave none. */
  readonly description?: string
}

/** Payload of {@link SessionEventMap['sci/delivered']}. */
export interface SciDeliveredData {
  /** Identity of this delivery, naming its snapshot directory and its card. */
  readonly deliveryId: DeliveryId
  /** Absolute path in the sandbox that was delivered. */
  readonly path: string
  /** Lowercase hex sha256 of the delivered bytes at delivery time. */
  readonly sha256: string
  /** Byte length of the delivered file at delivery time. */
  readonly size: number
  /** Card title shown to the user. */
  readonly title: string
  /** One-sentence explanation of the file; absent when the requester gave none. */
  readonly description?: string
  /** What was delivered — an ordinary file or one of the three bundle manifests. */
  readonly kind: DeliveryKind
  /** Display-only channel marker; see {@link DeliveryVia} for why it is not an authorization signal. */
  readonly via: DeliveryVia
}

/** Payload of {@link SessionEventMap['sci/delivery-failed']}. */
export interface SciDeliveryFailedData {
  /** Always `spool`: a rejected tool call reports its reason in the tool result instead. */
  readonly via: 'spool'
  /** Path the rejected spool entry named, as the entry wrote it. */
  readonly path: string
  /** Model-facing rejection reason, re-injected once as prompt context. */
  readonly reason: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One file reached the user, through the `deliver_files` tool or through
     * the shell spool. Log-only and non-surface: the card a user interface
     * renders is projected from this record, and nothing later in the log is
     * interpreted differently by its presence, so the producer appends it with
     * the envelope's `ignorable` marker and a reader that does not know the
     * type skips it instead of refusing the log. Within one session it is also
     * the authoritative record of which manifests were already delivered.
     * @param data - the delivery identity, the delivered bytes' digest and
     *   size, the card text, what kind of file it was, and which channel
     *   produced it.
     */
    'sci/delivered': SciDeliveredData
    /**
     * One spool entry was rejected. Log-only, non-surface, and appended with
     * the envelope's `ignorable` marker for the same reason as
     * `sci/delivered`: the model learns of the rejection through the prompt
     * context this package materialises once, not by re-reading the log.
     * @param data - the always-`spool` channel marker, the path the entry
     *   named, and the reason the validation chain produced.
     */
    'sci/delivery-failed': SciDeliveryFailedData
  }
}
