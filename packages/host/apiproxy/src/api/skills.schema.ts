/**
 * skills domain zod schemas (names derived from map keys: skillListRequestSchema /
 * skillListValueSchema, skillInventoryRequestSchema / skillInventoryValueSchema).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import { sessionIdSchema } from './sessions.schema.ts'
import type { SkillEntry, SkillInventoryEntry, SkillInventoryGroup } from './skills.ts'

/** SkillEntry row of skill.list. */
export const skillEntrySchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  whenToUse: z.string().optional(),
  modelInvocable: z.boolean(),
}) satisfies z.ZodType<Wire<SkillEntry>>

/** skill.list request payload. */
export const skillListRequestSchema = z.object({
  sessionId: sessionIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'skill.list'>>>

/** skill.list response value. */
export const skillListValueSchema = z.object({
  skills: z.array(skillEntrySchema),
}) satisfies z.ZodType<Wire<ResponseValue<'skill.list'>>>

/** Both invocation surfaces, as every inventory entry reports them twice (authored and effective). */
const skillInvocationSurfacesSchema = z.object({
  modelInvocable: z.boolean(),
  userInvocable: z.boolean(),
})

/** SkillInventoryEntry row: one discovered skill, winner or shadowed loser. */
export const skillInventoryEntrySchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  whenToUse: z.string().optional(),
  path: z.string().optional(),
  authored: skillInvocationSurfacesSchema,
  effective: skillInvocationSurfacesSchema,
  override: z.object({ model: z.boolean().optional(), user: z.boolean().optional() }).optional(),
  shadowed: z.boolean(),
}) satisfies z.ZodType<Wire<SkillInventoryEntry>>

/**
 * SkillInventoryGroup row. `source` stays an unconstrained string: the host's
 * origin vocabulary is open, and a client that cannot name a bucket still
 * renders its entries.
 */
export const skillInventoryGroupSchema = z.object({
  source: z.string(),
  rank: z.number(),
  root: z.string().optional(),
  layer: z.union([z.literal('global'), z.literal('scope')]),
  skills: z.array(skillInventoryEntrySchema),
}) satisfies z.ZodType<Wire<SkillInventoryGroup>>

/** skill.inventory request payload. */
export const skillInventoryRequestSchema = z.object({
  sessionId: sessionIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'skill.inventory'>>>

/** skill.inventory response value. */
export const skillInventoryValueSchema = z.object({
  groups: z.array(skillInventoryGroupSchema),
  complete: z.boolean(),
}) satisfies z.ZodType<Wire<ResponseValue<'skill.inventory'>>>
