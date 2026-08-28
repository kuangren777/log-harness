import type { LocaleId } from '@deepseek-ai/dsh-client-locale/client'
import { editViewerUrl } from './viewer-url.ts'

/** Locale tags understood by the bundled Univer Viewer. */
export type ViewerLocale = 'zh-CN' | 'en-US'

/** Viewer-locale accessor injected into DSH slot components. */
export interface ViewerLocaleInjected {
  readonly getViewerLocale: () => ViewerLocale
}

const VIEWER_LOCALES = {
  zh: 'zh-CN',
  en: 'en-US',
} as const satisfies Record<LocaleId, ViewerLocale>

/**
 * Map one DSH locale id to the corresponding Univer Viewer locale tag.
 * @param locale - the active DSH locale.
 * @returns the Viewer locale tag for it.
 */
export function viewerLocaleOf(locale: LocaleId): ViewerLocale {
  return VIEWER_LOCALES[locale]
}

/**
 * Add the active Viewer locale without reconstructing the Host-owned target.
 * @param url - the Viewer target the Host emitted.
 * @param locale - the Viewer locale tag to request.
 * @returns the target carrying `lang`, as absolute or relative as the input.
 */
export function localizeViewerUrl(url: string, locale: ViewerLocale): string {
  return editViewerUrl(url, (params) => { params.set('lang', locale) })
}
