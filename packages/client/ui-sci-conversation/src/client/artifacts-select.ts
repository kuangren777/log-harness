/**
 * Which files one turn produced, and how a chip names them.
 *
 * Two Turn-scoped readings answer that, and the chips union them because
 * neither is complete alone. ui-deliverables' `deliverables` knows every
 * mutation the turn landed, by render intent rather than by tool name, but a
 * pure hand-over (`deliver_files`) or an office export writes through no
 * mutation card and leaves no trace in it. This package's own `sciArtifacts`
 * (see `./artifacts-node.ts`) knows exactly those calls and nothing else.
 * Together they are the files a researcher means by "output".
 *
 * Both readings arrive on the Turn the chain claim already holds, so the
 * claim is complete before anything mounts — the row needs no session read of
 * its own and never mounts to discover it had nothing to draw.
 */
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { producedForClosing } from '@deepseek-ai/dsh-client-ui-deliverables/client'
import { handedOverForClosing, SCI_ARTIFACTS_KEY } from './artifacts-node.ts'

/**
 * Claim the turn-tail chain when the closing turn produced at least one file.
 *
 * Mutations come first because they are what the turn wrote; hand-overs
 * follow. A path both readings name appears once, in the position the
 * mutation reading gave it.
 * @param owner - Turn-tail owner currency for the closing assistant.
 * @returns the produced paths as the row's match, or null to decline before mount.
 */
export function selectArtifacts(owner: TurnTailOwnerProps): readonly string[] | null {
  const mutated = producedForClosing(owner.turn.data.get('deliverables'), owner.seq)
  const handedOver = handedOverForClosing(owner.turn.data.get(SCI_ARTIFACTS_KEY), owner.seq)
  const seen = new Set<string>()
  const paths: string[] = []
  for (const path of [...mutated, ...handedOver]) {
    if (seen.has(path)) continue
    seen.add(path)
    paths.push(path)
  }
  return paths.length === 0 ? null : paths
}

/**
 * Trailing path segment: the part that identifies the file at a glance.
 * @param path - slash- or backslash-separated path.
 * @returns the final segment, or the whole string when separator-free.
 */
export function basename(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}

/**
 * The directory a chip shows under the file name.
 * @param path - slash- or backslash-separated path.
 * @returns the leading segments, or an empty string for a bare file name.
 */
export function dirname(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at <= 0 ? '' : path.slice(0, at)
}

/**
 * The chip's badge: the uppercase extension, or the first letters of a file
 * with none. Four characters is what the 34px square holds.
 * @param path - the produced path.
 * @returns the badge text.
 */
export function extensionBadge(path: string): string {
  const name = basename(path)
  const dot = name.lastIndexOf('.')
  const text = dot > 0 ? name.slice(dot + 1) : name
  return text.slice(0, 4).toUpperCase()
}
