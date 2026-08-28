/**
 * Viewer targets are same-origin paths now that the Gateway sits behind the
 * reverse proxy, so every browser-side edit has to survive a URL with no
 * origin — `new URL(path)` rejects one outright.
 */

import { describe, expect, it } from 'vitest'
import { localizeViewerUrl, viewerLocaleOf } from '../src/client/viewer-locale.ts'
import { editViewerUrl } from '../src/client/viewer-url.ts'

describe('editViewerUrl', () => {
  it('edits a relative Host target and returns it relative', () => {
    expect(editViewerUrl('/univer-gw/?file=KEY', (params) => { params.set('unit', 'u1') }))
      .toBe('/univer-gw/?file=KEY&unit=u1')
  })

  it('applies several edits in one pass', () => {
    expect(editViewerUrl('/univer-gw/?file=KEY&mode=embedded', (params) => {
      params.delete('mode')
      params.set('sidebar', 'collapsed')
    })).toBe('/univer-gw/?file=KEY&sidebar=collapsed')
  })

  it('preserves an absolute target rather than reducing it to a path', () => {
    expect(editViewerUrl('http://127.0.0.1:9080/?file=KEY', (params) => { params.set('lang', 'en-US') }))
      .toBe('http://127.0.0.1:9080/?file=KEY&lang=en-US')
  })

  it('encodes a value that would otherwise break the query string', () => {
    expect(editViewerUrl('/univer-gw/', (params) => { params.set('file', 'a&b=c') }))
      .toBe('/univer-gw/?file=a%26b%3Dc')
  })
})

describe('localizeViewerUrl', () => {
  it('adds the active Viewer locale to a relative target', () => {
    expect(localizeViewerUrl('/univer-gw/?file=KEY', viewerLocaleOf('zh')))
      .toBe('/univer-gw/?file=KEY&lang=zh-CN')
    expect(localizeViewerUrl('/univer-gw/?file=KEY', viewerLocaleOf('en')))
      .toBe('/univer-gw/?file=KEY&lang=en-US')
  })

  it('replaces a locale that is already present', () => {
    expect(localizeViewerUrl('/univer-gw/?file=KEY&lang=en-US', viewerLocaleOf('zh')))
      .toBe('/univer-gw/?file=KEY&lang=zh-CN')
  })
})
