/**
 * Kahn topological sort over a plan's dependency graph, expressed entirely in
 * agent indices.
 *
 * The graph is index-based rather than id-based so that resolving an id to a
 * node happens once, in {@link validatePlan}, where an unresolvable id is the
 * dangling-edge error a model can act on. By the time a graph reaches this
 * module every endpoint is known, so the sort has no failure mode except a
 * cycle.
 * @module @deepseek-ai/dsh-sci-plan/src/graph
 */

/** One dependency as indices into the agent list: `from` must finish before `to` starts. */
export type EdgeIndices = readonly [from: number, to: number]

/**
 * The result of sorting one plan: either a run order covering every node, or
 * the nodes that could never reach in-degree zero, which are exactly the nodes
 * on or downstream of a cycle.
 */
export type TopologicalSort =
  | { readonly ok: true; readonly order: readonly number[] }
  | { readonly ok: false; readonly cycle: readonly number[] }

/**
 * Order the nodes so that every dependency precedes its dependent.
 *
 * Nodes ready at the same time keep declaration order, so the run order a model
 * reads back is stable and a rendered plan is reproducible from the log. A
 * dependency declared twice counts once: a repeated pair states the same
 * ordering, and counting it twice would leave the target permanently blocked
 * and report a cycle that does not exist.
 * @param size - how many nodes the graph has; node ids are `0` to `size - 1`.
 * @param edges - the dependencies, whose endpoints must be valid node indices
 *   and must differ.
 * @returns the run order when the graph is acyclic, otherwise the nodes on or
 *   below the cycle, in declaration order.
 */
export function topologicalSort(size: number, edges: readonly EdgeIndices[]): TopologicalSort {
  const indegree = new Map<number, number>()
  const outgoing = new Map<number, number[]>()
  /**
   * Unresolved incoming-edge count of one node.
   * @param node - the node index.
   * @returns its current in-degree; zero for a node no edge targets.
   */
  const degreeOf = (node: number): number => indegree.get(node) ?? 0

  const declared = new Set<string>()
  for (const [from, to] of edges) {
    const pair = `${from}>${to}`
    if (declared.has(pair)) continue
    declared.add(pair)
    const targets = outgoing.get(from)
    if (targets === undefined) outgoing.set(from, [to])
    else targets.push(to)
    indegree.set(to, degreeOf(to) + 1)
  }

  const order: number[] = []
  for (let node = 0; node < size; node += 1) {
    if (degreeOf(node) === 0) order.push(node)
  }
  // The array iterator reads the live length, so nodes appended below are
  // visited in the same pass.
  for (const node of order) {
    for (const to of outgoing.get(node) ?? []) {
      const remaining = degreeOf(to) - 1
      indegree.set(to, remaining)
      if (remaining === 0) order.push(to)
    }
  }
  if (order.length === size) return { ok: true, order }

  const placed = new Set(order)
  const cycle: number[] = []
  for (let node = 0; node < size; node += 1) {
    if (!placed.has(node)) cycle.push(node)
  }
  return { ok: false, cycle }
}
