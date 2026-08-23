/** The browser credential's serialization, parsing, and two-part shape. */

import { describe, expect, it } from 'vitest'
import {
  clearedCookie, joinCredential, readCookie, sessionCookie, splitCredential,
} from '../src/cookie.ts'

describe('credential shape', () => {
  it('round-trips the session id and the token', () => {
    expect(splitCredential(joinCredential('sess-1', 'tok-abc'))).toEqual({
      authSessionId: 'sess-1',
      token: 'tok-abc',
    })
  })

  it('splits at the first separator, so a token containing one still round-trips', () => {
    expect(splitCredential('sess-1.tok.with.dots')).toEqual({
      authSessionId: 'sess-1',
      token: 'tok.with.dots',
    })
  })

  it('refuses a value that is not a credential', () => {
    expect(splitCredential('nodot')).toBeUndefined()
    expect(splitCredential('.leading')).toBeUndefined()
    expect(splitCredential('trailing.')).toBeUndefined()
    expect(splitCredential('')).toBeUndefined()
  })
})

describe('cookie serialization', () => {
  it('always carries the attributes that make the credential unreadable and non-cross-site', () => {
    expect(sessionCookie('dsh_session', 'v', true, 60))
      .toBe('dsh_session=v; HttpOnly; SameSite=Strict; Path=/; Max-Age=60; Secure')
  })

  it('omits Secure for a deployment reached over plain HTTP', () => {
    expect(sessionCookie('dsh_session', 'v', false, 60))
      .toBe('dsh_session=v; HttpOnly; SameSite=Strict; Path=/; Max-Age=60')
  })

  it('never writes a negative or fractional age', () => {
    expect(sessionCookie('n', 'v', false, -5)).toContain('Max-Age=0')
    expect(sessionCookie('n', 'v', false, 1.7)).toContain('Max-Age=1')
  })

  it('clears with an empty value and a zero age, keeping the same attributes', () => {
    expect(clearedCookie('dsh_session', true))
      .toBe('dsh_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0; Secure')
  })
})

describe('cookie reading', () => {
  it('reads the named cookie from either HTTP representation', () => {
    expect(readCookie(new Headers({ cookie: 'a=1; dsh_session=v; b=2' }), 'dsh_session')).toBe('v')
    expect(readCookie({ cookie: 'a=1; dsh_session=v' }, 'dsh_session')).toBe('v')
  })

  it('answers nothing for an absent header, an absent name, and a malformed pair', () => {
    expect(readCookie(new Headers(), 'dsh_session')).toBeUndefined()
    expect(readCookie({}, 'dsh_session')).toBeUndefined()
    expect(readCookie(new Headers({ cookie: 'a=1; b=2' }), 'dsh_session')).toBeUndefined()
    expect(readCookie(new Headers({ cookie: 'novalue; dsh_session=v' }), 'dsh_session')).toBe('v')
  })

  it('takes the first of a duplicated name, which is the most specific path a browser sends', () => {
    expect(readCookie(new Headers({ cookie: 'dsh_session=first; dsh_session=second' }), 'dsh_session'))
      .toBe('first')
  })
})
