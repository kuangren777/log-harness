/**
 * Which project a request is about.
 *
 * The model never states a project slug unless it has to, because the session
 * is already sitting in one: the agent's working directory is inside
 * `<projectRoot>/<slug>/`. So the tools infer the slug from that directory and
 * REFUSE when they cannot — a guess here would file a citation into the wrong
 * manuscript's bibliography, which is exactly the kind of quiet damage a
 * citekey's stability contract exists to prevent.
 * @module @deepseek-ai/dsh-sci-citations/src/project
 */

import { CitationsError, CITATIONS_INVALID_REQUEST } from './error.ts'

/**
 * Split a path into meaningful segments, folding `.` and `..` away.
 * @param path - any absolute or relative POSIX or Windows-shaped path.
 * @returns the resolved segments, without a leading root marker.
 */
export function pathSegments(path: string): string[] {
  const segments: string[] = []
  for (const raw of path.split(/[\\/]+/)) {
    if (raw === '' || raw === '.') continue
    if (raw === '..') {
      if (segments.length > 0 && segments[segments.length - 1] !== '..') segments.pop()
      else segments.push(raw)
      continue
    }
    segments.push(raw)
  }
  return segments
}

/**
 * The project one working directory sits in.
 * @param cwd - the session's working directory, or `undefined` when it has none.
 * @param projectRoot - the configured directory holding one folder per project.
 * @returns the project slug, or `undefined` when the directory is not under a project.
 */
export function projectSlugFromCwd(cwd: string | undefined, projectRoot: string): string | undefined {
  if (cwd === undefined) return undefined
  const rootSegments = pathSegments(projectRoot)
  const segments = pathSegments(cwd)
  if (segments.length <= rootSegments.length) return undefined
  for (const [index, segment] of rootSegments.entries()) {
    if (segments[index] !== segment) return undefined
  }
  return segments[rootSegments.length]
}

/** Path segments that name a directory relative to another one, never a project. */
const DOT_SEGMENTS: readonly string[] = ['.', '..']

/**
 * Check a project slug names one directory under `projectRoot` and nothing else.
 *
 * Every path this layer builds is `projectRoot` joined to the slug, so the slug
 * is the one component a caller controls. It is checked here rather than at each
 * join: an empty slug, a separator, and a dot segment all address something
 * outside the project the caller named.
 * @param project - the slug as the caller stated it.
 * @returns the trimmed slug.
 * @throws CitationsError `CITATIONS_INVALID_REQUEST` for an empty slug, one
 *   carrying a path separator, or a dot segment.
 */
export function assertProjectSlug(project: string): string {
  const slug = project.trim()
  const segments = pathSegments(slug)
  if (slug === '' || segments.length !== 1 || slug !== segments[0] || DOT_SEGMENTS.includes(slug)) {
    throw new CitationsError(`项目名 ${JSON.stringify(project)} 不是一个项目目录名`, CITATIONS_INVALID_REQUEST)
  }
  return slug
}
