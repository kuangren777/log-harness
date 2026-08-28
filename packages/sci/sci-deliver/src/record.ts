/**
 * The one commit point of a delivery: resolve, validate, snapshot, log.
 *
 * Both channels — the `deliver_files` tool and the shell spool — go through
 * this function, so the `sci/delivered` event they produce is identical apart
 * from its `via` marker, and a card is projected from one record shape rather
 * than two. Nothing is published before the snapshot succeeds: the event is the
 * authoritative record that a user received those exact bytes.
 * @module @deepseek-ai/dsh-sci-deliver/src/record
 */

import { randomUUID } from 'node:crypto'
import type { Session } from '@deepseek-ai/dsh-session'
import { directoryName, normalizeSegments } from './paths.ts'
import type { DeliveryPathConfig } from './paths.ts'
import { snapshotDelivery } from './snapshot.ts'
import { validateDelivery } from './validate.ts'
import type { DeliveryIo } from './validate.ts'
import type { DeliveryFileSystem } from './fs.ts'
import type { DeliveryId, DeliveryKind, DeliveryRequest, DeliveryVia } from './types.ts'

/**
 * Mint one delivery identity.
 * @param value - the opaque identity string.
 * @returns the same string, branded.
 */
export function DeliveryId(value: string): DeliveryId {
  return value as DeliveryId
}

/** What a logged delivery reports back to its caller. */
export interface DeliveryRecord {
  /** Identity of this delivery, naming its snapshot directory and its card. */
  readonly deliveryId: DeliveryId
  /** The resolved sandbox path that was delivered. */
  readonly path: string
  /** Card title shown to the user. */
  readonly title: string
  /** What was delivered. */
  readonly kind: DeliveryKind
  /** Byte length of the delivered file. */
  readonly size: number
  /** Lowercase hex sha256 of the delivered bytes. */
  readonly sha256: string
}

/** The outcome of one delivery attempt. */
export type DeliveryOutcome =
  | { readonly ok: true; readonly record: DeliveryRecord }
  | { readonly ok: false; readonly reason: string }

/** Deployment-resolved inputs every delivery shares. */
export interface RecorderOptions {
  /** The sandbox filesystem, or a test double. */
  readonly fs: DeliveryFileSystem
  /** The project layout the delivery-area rule is evaluated against. */
  readonly paths: DeliveryPathConfig
  /** Absolute path of the directory holding one subdirectory per delivery. */
  readonly snapshotDir: string
  /** How deep a canvas manifest's own directory is walked for referenced assets. */
  readonly canvasAssetDepth: number
  /** Inclusive byte cap on a deliverable file. */
  readonly maxDeliveryBytes: number
  /**
   * Mint the next delivery identity. Injected so a test can pin the snapshot
   * directory a delivery writes to.
   * @returns a fresh delivery identity.
   */
  readonly newDeliveryId: () => DeliveryId
}

/** Records one requested delivery against one session. */
export type Recorder = (session: Session, request: DeliveryRequest, via: DeliveryVia) => Promise<DeliveryOutcome>

/**
 * Build the delivery commit point for one deployment.
 * @param options - the filesystem, the project layout, the snapshot root, the
 *   caps, and the identity source.
 * @returns a function that validates, snapshots, and logs one delivery.
 */
export function createRecorder(options: RecorderOptions): Recorder {
  const { fs, paths } = options
  return async (session, request, via) => {
    const path = await fs.resolve(request.path, session.header.cwd)
    const io: DeliveryIo = {
      paths,
      exists: candidate => fs.exists(candidate),
      isFile: candidate => fs.isFile(candidate),
      readManifest: async (manifestPath) => {
        const [text, assets] = await Promise.all([
          fs.readText(manifestPath),
          fs.listAssets(directoryName(manifestPath), options.canvasAssetDepth),
        ])
        return { text, assetExists: relativePath => assets.has(normalizeSegments(relativePath).join('/')) }
      },
      alreadyDelivered: manifestPath => session.events.some(
        event => event.type === 'sci/delivered' && event.data.path === manifestPath,
      ),
    }
    const decision = await validateDelivery({ ...request, path }, io)
    if (!decision.ok) return { ok: false, reason: decision.reason }
    const deliveryId = options.newDeliveryId()
    const snapshot = await snapshotDelivery(fs, {
      path,
      deliveryId,
      snapshotDir: options.snapshotDir,
      maxBytes: options.maxDeliveryBytes,
    })
    session.append('sci/delivered', {
      deliveryId,
      path,
      sha256: snapshot.sha256,
      size: snapshot.size,
      title: request.title,
      ...request.description === undefined ? {} : { description: request.description },
      kind: decision.kind,
      via,
    }, { ignorable: true })
    return {
      ok: true,
      record: {
        deliveryId,
        path,
        title: request.title,
        kind: decision.kind,
        size: snapshot.size,
        sha256: snapshot.sha256,
      },
    }
  }
}

/**
 * The default delivery-identity source: a random UUID, so a snapshot directory
 * never collides across sessions or processes.
 * @returns a fresh delivery identity.
 */
export function randomDeliveryId(): DeliveryId {
  return DeliveryId(randomUUID())
}
