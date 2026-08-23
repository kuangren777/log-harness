/**
 * Copy dictionaries for the sign-in surface.
 *
 * Every failure string is deliberately uninformative. The Host answers a wrong
 * password, an unknown address, a disabled account, and an expired code with
 * one shapeless `failed`, and this copy keeps it that way: wording that named
 * the difference would restore the account oracle the server refuses to be.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  title: '登录',
  intro: '此部署需要登录后使用。',
  email: '邮箱地址',
  password: '密码',
  signIn: '登录',
  signingIn: '正在验证…',
  codeTitle: '输入验证码',
  codeIntro: '六位验证码已发送到你的邮箱，请在有效期内输入。',
  code: '验证码',
  verify: '验证',
  verifying: '正在验证…',
  back: '返回',
  signInFailed: '登录失败，请检查邮箱地址和密码后重试。',
  codeFailed: '验证码不正确或已失效，请重新输入。',
  rateLimited: '尝试过于频繁，请稍后再试。',
  forgotLink: '忘记密码？',
  forgotTitle: '重设密码',
  forgotIntro: '填写邮箱地址。如果该地址有账号，重设链接会发送到这个邮箱。',
  forgotSubmit: '发送重设链接',
  forgotSending: '正在发送…',
  forgotSent: '如果该地址有账号，重设链接已经发出，请查收邮件。',
  resetTitle: '设置新密码',
  resetIntro: '为账号设置新密码。设置成功后，此账号的全部登录会话都会失效。',
  newPassword: '新密码',
  resetSubmit: '保存新密码',
  resetSaving: '正在保存…',
  resetDone: '密码已更新，请用新密码登录。',
  resetFailed: '此链接无效或已失效，请重新申请重设密码。',
  verifyTitle: '确认邮箱',
  verifyPending: '正在确认邮箱…',
  verified: '邮箱已确认。',
  verifyFailed: '此确认链接无效或已失效。',
  continueToSignIn: '前往登录',
  account: '账号',
  accountOf: '已登录：{email}',
  signOut: '退出登录',
  signOutEverywhere: '退出全部设备',
  signingOut: '正在退出…',
}

/** English strings (same key set as {@link zh}). */
export const en: Record<keyof typeof zh, string> = {
  title: 'Sign in',
  intro: 'This deployment requires you to sign in.',
  email: 'E-mail address',
  password: 'Password',
  signIn: 'Sign in',
  signingIn: 'Checking…',
  codeTitle: 'Enter the code',
  codeIntro: 'A six-digit code was sent to your mailbox. Enter it before it expires.',
  code: 'Code',
  verify: 'Verify',
  verifying: 'Checking…',
  back: 'Back',
  signInFailed: 'Sign-in failed. Check the address and password, then try again.',
  codeFailed: 'That code is wrong or no longer valid. Enter it again.',
  rateLimited: 'Too many attempts. Try again later.',
  forgotLink: 'Forgot your password?',
  forgotTitle: 'Reset your password',
  forgotIntro: 'Enter your address. If it has an account, a reset link goes to that mailbox.',
  forgotSubmit: 'Send the reset link',
  forgotSending: 'Sending…',
  forgotSent: 'If that address has an account, the reset link is on its way.',
  resetTitle: 'Set a new password',
  resetIntro: 'Choose a new password. Every signed-in session of this account ends once it is saved.',
  newPassword: 'New password',
  resetSubmit: 'Save the new password',
  resetSaving: 'Saving…',
  resetDone: 'The password is updated. Sign in with it.',
  resetFailed: 'That link is not valid any more. Ask for a new reset link.',
  verifyTitle: 'Confirm your address',
  verifyPending: 'Confirming the address…',
  verified: 'The address is confirmed.',
  verifyFailed: 'That confirmation link is not valid any more.',
  continueToSignIn: 'Go to sign-in',
  account: 'Account',
  accountOf: 'Signed in as {email}',
  signOut: 'Sign out',
  signOutEverywhere: 'Sign out everywhere',
  signingOut: 'Signing out…',
}

/** Copy keys this plugin's namespace owns. */
export type AuthKey = keyof typeof zh

/** Bound translate for this namespace. */
export type AuthTranslate = (key: AuthKey, params?: Record<string, unknown>) => string
