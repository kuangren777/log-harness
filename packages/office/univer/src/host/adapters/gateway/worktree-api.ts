import type { WorktreeReviewAction } from '../../../shared/wire/actions.ts'
import type { JsonValue, UniverUnitKind } from '../../service/types.ts'
import type { GatewayClient } from './client.ts'
import { fileKeyOf } from './file-api.ts'

/** Gateway worktree API used by the Provider. */
export class GatewayWorktreeApi {
  constructor(private readonly client: GatewayClient) {}

  /**
   * Return merge-preview metadata for one worktree.
   * @param file - absolute path of the `.univer` file.
   * @param worktreeId - the worktree to preview.
   * @returns the Gateway's unvalidated preview body.
   */
  preview(file: string, worktreeId: string): Promise<JsonValue> {
    return this.client.get(`/uf/${fileKeyOf(file)}/worktrees/${encodeURIComponent(worktreeId)}/preview`)
  }

  /**
   * Create an isolated worktree for agent edits.
   * @param file - absolute path of the `.univer` file.
   * @param name - display name, or undefined for the default agent name.
   * @returns the Gateway's creation result body.
   */
  create(file: string, name: string | undefined): Promise<JsonValue> {
    return this.client.post(`/uf/${fileKeyOf(file)}/worktrees`, {
      agentId: 'dsh-agent',
      name: name ?? 'DSH agent worktree',
    })
  }

  /**
   * Return Units visible inside one worktree.
   * @param file - absolute path of the `.univer` file.
   * @param worktreeId - the worktree to list.
   * @returns the Gateway's unvalidated listing body.
   */
  listUnits(file: string, worktreeId: string): Promise<JsonValue> {
    return this.client.get(`/uf/${fileKeyOf(file)}/worktrees/${encodeURIComponent(worktreeId)}/units`)
  }

  /**
   * Create a Unit inside a draft worktree.
   * @param file - absolute path of the `.univer` file.
   * @param worktreeId - the draft worktree receiving the Unit.
   * @param kind - the Unit kind to create.
   * @param name - display name of the new Unit.
   * @param snapshot - imported Unit content, or undefined for an empty Unit.
   * @returns the Gateway's creation result body.
   */
  createUnit(
    file: string,
    worktreeId: string,
    kind: UniverUnitKind,
    name: string,
    snapshot?: JsonValue,
  ): Promise<JsonValue> {
    return this.client.post(
      `/uf/${fileKeyOf(file)}/worktrees/${encodeURIComponent(worktreeId)}/units`,
      { type: unitType(kind), name, ...(snapshot === undefined ? {} : { snapshot }) },
    )
  }

  /**
   * Remove a Unit inside a draft worktree.
   * @param file - absolute path of the `.univer` file.
   * @param worktreeId - the draft worktree holding the Unit.
   * @param unitId - the Unit to remove.
   * @returns the Gateway's removal result body.
   */
  removeUnit(file: string, worktreeId: string, unitId: string): Promise<JsonValue> {
    return this.client.post(
      `/uf/${fileKeyOf(file)}/worktrees/${encodeURIComponent(worktreeId)}/units/${encodeURIComponent(unitId)}/remove`,
      {},
    )
  }

  /**
   * Apply one worktree lifecycle transition.
   * @param file - absolute path of the `.univer` file.
   * @param worktreeId - the worktree to transition.
   * @param action - the review decision to apply.
   * @returns the Gateway's transition result body.
   */
  action(file: string, worktreeId: string, action: WorktreeReviewAction): Promise<JsonValue> {
    return this.client.post(`/uf/${fileKeyOf(file)}/worktrees/${encodeURIComponent(worktreeId)}/${action}`)
  }
}

function unitType(kind: UniverUnitKind): 1 | 2 | 3 | 5 | 6 {
  if (kind === 'doc') return 1
  if (kind === 'sheet') return 2
  if (kind === 'slide') return 3
  if (kind === 'base') return 5
  return 6
}
