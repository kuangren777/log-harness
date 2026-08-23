/**
 * What each outbound message says. The templates are pinned because their text
 * is what a recipient acts on, and because a secret must appear in exactly one
 * of them and nowhere else.
 */

import { describe, expect, it } from 'vitest'
import {
  emailVerificationMessage, groupAddedMessage, newSignInMessage, passwordChangedMessage,
  passwordResetMessage, twoFactorCodeMessage,
} from '../src/messages.ts'

describe('delivered messages', () => {
  it('puts the sign-in code in the body and never in the subject', () => {
    const message = twoFactorCodeMessage('user@example.test', '123456', 600_000)
    expect(message.subject).toBe('Your sign-in code')
    expect(message.subject).not.toContain('123456')
    expect(message.text).toContain('Your sign-in code is 123456.')
    expect(message.text).toContain('expires in 10 minutes')
  })

  it('rounds an expiry to whole minutes and never says zero', () => {
    expect(twoFactorCodeMessage('u@e.test', '1', 1_000).text).toContain('1 minute')
    expect(twoFactorCodeMessage('u@e.test', '1', 150_000).text).toContain('3 minutes')
  })

  it('carries the reset and confirmation links verbatim', () => {
    expect(passwordResetMessage('u@e.test', 'https://h.test/reset?token=t', 3_600_000).text)
      .toContain('https://h.test/reset?token=t')
    expect(emailVerificationMessage('u@e.test', 'https://h.test/verify?token=t', 3_600_000).text)
      .toContain('https://h.test/verify?token=t')
  })

  it('names the client a new sign-in came from, and says so even when the carrier knew neither fact', () => {
    expect(newSignInMessage('u@e.test', '10.0.0.1', 'Firefox').text).toContain('Address: 10.0.0.1\nBrowser: Firefox')
    expect(newSignInMessage('u@e.test', undefined, undefined).text).toContain('Address: unknown\nBrowser: unknown')
  })

  it('tells the account what a completed reset did, and which group it joined', () => {
    expect(passwordChangedMessage('u@e.test').text).toContain('every signed-in session was ended')
    expect(groupAddedMessage('u@e.test', 'admin').subject).toBe('You were added to the admin group')
  })

  it('addresses every message to the account it is about', () => {
    for (const message of [
      twoFactorCodeMessage('u@e.test', '1', 1),
      passwordResetMessage('u@e.test', 'https://h.test', 1),
      emailVerificationMessage('u@e.test', 'https://h.test', 1),
      newSignInMessage('u@e.test', undefined, undefined),
      passwordChangedMessage('u@e.test'),
      groupAddedMessage('u@e.test', 'g'),
    ]) {
      expect(message.to).toBe('u@e.test')
      expect(message.html).toBeUndefined()
    }
  })
})
