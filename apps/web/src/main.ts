/**
 * Web application entry: thin bootstrap over the shell library. Everything —
 * module-table seeding, the boot page, and the UI-renderer handoff — lives
 * in @deepseek-ai/dsh-client-web; this file only finds the mount point and
 * asks for the app-shell service worker.
 */
import { AppWebEntry } from '@deepseek-ai/dsh-client-web'
import { registerServiceWorker } from './service-worker-registration.ts'

const el = document.getElementById('root')
if (el === null) throw new Error('web app: missing #root')
void new AppWebEntry(el).run()

// Off the boot path: install support is an enhancement, and its outcome never
// gates the application starting.
void registerServiceWorker({ location: window.location, serviceWorker: navigator.serviceWorker })
