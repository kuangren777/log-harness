/**
 * auth.admin domain zod schemas (names derived from map keys:
 * authAdminUsersListRequestSchema / authAdminUsersListValueSchema, ...).
 * UserId and GroupId brand cast points: {@link userIdSchema} and
 * {@link groupIdSchema}, and only there.
 */

import { z } from 'zod'
import type { GroupId, UserId } from '@deepseek-ai/dsh-auth/types'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { AdminGroupView, AdminRuleView, AdminUserView } from './auth-admin.ts'

/** UserId: one brand cast after non-empty string validation. */
export const userIdSchema = z.string().min(1) as unknown as z.ZodType<UserId>

/** GroupId: one brand cast after non-empty string validation. */
export const groupIdSchema = z.string().min(1) as unknown as z.ZodType<GroupId>

/** One rule, in both directions: the rules a group carries and the rules a save submits. */
export const adminRuleSchema = z.object({
  domain: z.union([
    z.literal('skill'), z.literal('tool'), z.literal('model'), z.literal('settings-section'),
  ]),
  pattern: z.string().min(1),
  effect: z.union([z.literal('allow'), z.literal('deny')]),
}) satisfies z.ZodType<Wire<AdminRuleView>>

/** AdminUserView row of auth.admin.users.list. */
export const adminUserSchema = z.object({
  userId: userIdSchema,
  email: z.string(),
  emailVerified: z.boolean(),
  disabled: z.boolean(),
  createdAt: z.number(),
}) satisfies z.ZodType<Wire<AdminUserView>>

/** AdminGroupView row of auth.admin.groups.list. */
export const adminGroupSchema = z.object({
  groupId: groupIdSchema,
  name: z.string(),
  builtin: z.boolean(),
  createdAt: z.number(),
  members: z.array(userIdSchema),
  rules: z.array(adminRuleSchema),
}) satisfies z.ZodType<Wire<AdminGroupView>>

/** auth.admin.users.list request payload. */
export const authAdminUsersListRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'auth.admin.users.list'>>>

/** auth.admin.users.list response value. */
export const authAdminUsersListValueSchema = z.object({
  users: z.array(adminUserSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'auth.admin.users.list'>>>

/** auth.admin.users.create request payload. */
export const authAdminUsersCreateRequestSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'auth.admin.users.create'>>>

/** auth.admin.users.create response value. */
export const authAdminUsersCreateValueSchema = z.object({
  userId: userIdSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'auth.admin.users.create'>>>

/** auth.admin.users.disable request payload. */
export const authAdminUsersDisableRequestSchema = z.object({
  userId: userIdSchema,
  disabled: z.boolean(),
}) satisfies z.ZodType<Wire<RequestPayload<'auth.admin.users.disable'>>>

/** auth.admin.users.disable response value. */
export const authAdminUsersDisableValueSchema = z.object({}) satisfies z.ZodType<Wire<ResponseValue<'auth.admin.users.disable'>>>

/** auth.admin.groups.list request payload. */
export const authAdminGroupsListRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'auth.admin.groups.list'>>>

/** auth.admin.groups.list response value. */
export const authAdminGroupsListValueSchema = z.object({
  groups: z.array(adminGroupSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'auth.admin.groups.list'>>>

/** auth.admin.groups.create request payload. */
export const authAdminGroupsCreateRequestSchema = z.object({
  name: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'auth.admin.groups.create'>>>

/** auth.admin.groups.create response value. */
export const authAdminGroupsCreateValueSchema = z.object({
  groupId: groupIdSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'auth.admin.groups.create'>>>

/** auth.admin.groups.delete request payload. */
export const authAdminGroupsDeleteRequestSchema = z.object({
  groupId: groupIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'auth.admin.groups.delete'>>>

/** auth.admin.groups.delete response value. */
export const authAdminGroupsDeleteValueSchema = z.object({}) satisfies z.ZodType<Wire<ResponseValue<'auth.admin.groups.delete'>>>

/** auth.admin.groups.rename request payload. */
export const authAdminGroupsRenameRequestSchema = z.object({
  groupId: groupIdSchema,
  name: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'auth.admin.groups.rename'>>>

/** auth.admin.groups.rename response value. */
export const authAdminGroupsRenameValueSchema = z.object({}) satisfies z.ZodType<Wire<ResponseValue<'auth.admin.groups.rename'>>>

/** auth.admin.members.set request payload. */
export const authAdminMembersSetRequestSchema = z.object({
  groupId: groupIdSchema,
  userIds: z.array(userIdSchema),
}) satisfies z.ZodType<Wire<RequestPayload<'auth.admin.members.set'>>>

/** auth.admin.members.set response value. */
export const authAdminMembersSetValueSchema = z.object({
  added: z.array(userIdSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'auth.admin.members.set'>>>

/** auth.admin.rules.set request payload. */
export const authAdminRulesSetRequestSchema = z.object({
  groupId: groupIdSchema,
  rules: z.array(adminRuleSchema),
}) satisfies z.ZodType<Wire<RequestPayload<'auth.admin.rules.set'>>>

/** auth.admin.rules.set response value. */
export const authAdminRulesSetValueSchema = z.object({}) satisfies z.ZodType<Wire<ResponseValue<'auth.admin.rules.set'>>>
