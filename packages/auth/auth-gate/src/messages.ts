/**
 * The messages this gate sends. Every template is a pure function of its
 * arguments, so what a recipient reads is decided here and nowhere else.
 *
 * A one-time secret appears in exactly two of them, and only in the body of
 * the message it is being delivered by; nothing here writes a secret into a
 * subject line, a log, or a notice.
 * @module @deepseek-ai/dsh-auth-gate/messages
 */

import type { MailMessage } from '@deepseek-ai/dsh-mail'

/** Whole minutes, for a human-readable expiry. */
function minutes(ttlMs: number): string {
  const value = Math.max(1, Math.round(ttlMs / 60_000))
  return value === 1 ? '1 minute' : `${String(value)} minutes`
}

/**
 * The second factor for one sign-in attempt.
 * @param to - the account's address.
 * @param code - the six-digit code.
 * @param ttlMs - how long the code stays valid.
 * @returns the message to deliver.
 */
export function twoFactorCodeMessage(to: string, code: string, ttlMs: number): MailMessage {
  return {
    to,
    subject: 'Your sign-in code',
    text: [
      `Your sign-in code is ${code}.`,
      `It expires in ${minutes(ttlMs)} and can be used once.`,
      'If you did not try to sign in, ignore this message and change your password.',
    ].join('\n\n'),
  }
}

/**
 * The link that sets a new password.
 * @param to - the account's address.
 * @param url - the reset link, carrying the one-time token.
 * @param ttlMs - how long the link stays valid.
 * @returns the message to deliver.
 */
export function passwordResetMessage(to: string, url: string, ttlMs: number): MailMessage {
  return {
    to,
    subject: 'Reset your password',
    text: [
      'Use this link to choose a new password:',
      url,
      `The link expires in ${minutes(ttlMs)} and can be used once.`,
      'If you did not ask for it, no action is needed; your current password still works.',
    ].join('\n\n'),
  }
}

/**
 * The link that confirms an address.
 * @param to - the address being confirmed.
 * @param url - the confirmation link, carrying the one-time token.
 * @param ttlMs - how long the link stays valid.
 * @returns the message to deliver.
 */
export function emailVerificationMessage(to: string, url: string, ttlMs: number): MailMessage {
  return {
    to,
    subject: 'Confirm your e-mail address',
    text: [
      'Use this link to confirm this address:',
      url,
      `The link expires in ${minutes(ttlMs)} and can be used once.`,
    ].join('\n\n'),
  }
}

/**
 * The notice a sign-in from an unrecognized client earns.
 *
 * It names the client address and the user-agent string because those are the
 * two facts a recipient can act on, and neither is a secret the message is
 * disclosing — both came from the recipient's own request.
 * @param to - the account's address.
 * @param ip - the client address the session was issued to, when the carrier knew one.
 * @param userAgent - the user-agent string the session was issued to, when the request carried one.
 * @returns the message to deliver.
 */
export function newSignInMessage(to: string, ip: string | undefined, userAgent: string | undefined): MailMessage {
  return {
    to,
    subject: 'New sign-in to your account',
    text: [
      'Your account was signed in to from a client this host has not seen before.',
      `Address: ${ip ?? 'unknown'}\nBrowser: ${userAgent ?? 'unknown'}`,
      'If this was not you, reset your password and sign out everywhere.',
    ].join('\n\n'),
  }
}

/**
 * The notice a completed password reset earns. It is sent to the address the
 * reset was performed for, which is the one place a hijacked reset would be
 * noticed.
 * @param to - the account's address.
 * @returns the message to deliver.
 */
export function passwordChangedMessage(to: string): MailMessage {
  return {
    to,
    subject: 'Your password was changed',
    text: [
      'The password for your account was just changed, and every signed-in session was ended.',
      'If this was not you, use the password reset link on the sign-in page immediately.',
    ].join('\n\n'),
  }
}

/**
 * The notice a group addition earns. Group membership decides what an account
 * may reach, so a change to it is a security event for its subject even when
 * an administrator made it deliberately.
 * @param to - the account's address.
 * @param groupName - the group the account was added to.
 * @returns the message to deliver.
 */
export function groupAddedMessage(to: string, groupName: string): MailMessage {
  return {
    to,
    subject: `You were added to the ${groupName} group`,
    text: [
      `An administrator added your account to the ${groupName} group.`,
      'Group membership decides what your account may reach.',
      'If you did not expect this, tell whoever runs this host.',
    ].join('\n\n'),
  }
}
