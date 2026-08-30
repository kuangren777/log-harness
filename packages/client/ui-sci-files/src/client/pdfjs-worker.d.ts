/**
 * The worker bundle ships no declarations; it is imported for its side value
 * only (published as `globalThis.pdfjsWorker`, pdf.js's main-thread path).
 */
declare module 'pdfjs-dist/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown
}
