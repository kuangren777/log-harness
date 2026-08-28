/**
 * Identity of one plan declaration.
 * @module @deepseek-ai/dsh-sci-plan/src/plan-id
 */

import { randomUUID } from 'node:crypto'
import type { SciPlanId } from './types.ts'

/**
 * Mint one plan identity from an existing opaque string.
 * @param value - the opaque identity string.
 * @returns the same string, branded.
 */
export function SciPlanId(value: string): SciPlanId {
  return value as SciPlanId
}

/**
 * Mint a fresh plan identity.
 * @returns a random UUID branded as a plan identity.
 */
export function randomPlanId(): SciPlanId {
  return SciPlanId(randomUUID())
}
