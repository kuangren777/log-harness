# Agent Note: the filesystem seam gains an unguarded raw-byte write

Status: proposed

English | [中文](2026-08-30-fs-write-bytes.zh.md)

## Problem

`ctx.fs` reads raw bytes (`readBytes`) but can only write text. Every mutation on the seam — `writeText`, `editText` — decodes UTF-8, rejects NUL-sampled binaries, and normalizes line endings, so a host plugin holding a binary payload has no way to put it in the execution world where the model's tools and shell can see it.

`dsh-sci-deliver` already pays for the gap: `packages/sci/sci-deliver/src/fs.ts` declares its own path-shaped adapter around the seam because "`FileSystem` … offers no binary write", and the snapshot path stores binary content as base64 text under a `.base64` suffix. That workaround produces a file no other tool in the sandbox can open, and it is 4/3 the size of the payload it carries.

The knowledge-library work makes the gap blocking rather than annoying. `dsh-sci-library` downloads open-access PDFs and accepts browser file uploads (PDF, CSV, Parquet, xlsx, zip), then has to land them under the session's sandbox library root so the file panel, the `read` tool, and the model's PDF skill can all reach them. Base64 text is not an option for a file the user is going to open, and a second write path outside the seam would bypass the sandbox fence that `dsh-fs-sandbox` applies to every other mutation.

## Proposal

`FileSystem` gains a thirteenth primitive:

```ts ignore-check
abstract writeBytes(target: FsTarget, data: Uint8Array, signal: AbortSignal | undefined): Promise<void>
```

The parameter style follows `readBytes`, its read counterpart: a required positional `signal` rather than the optional trailing `signal?` the text mutations use, because there is no `expected` guard in front of it to make an optional signal readable.

What every backend owes callers:

- Missing parent directories are created, exactly as `writeText` does.
- Publication is atomic wherever the backend has an atomic replace: a reader observes the previous file or the complete new one, never a partial write.
- The write is unconditional. There is no `FsWriteIntent`, no version guard, and therefore no `fs/write-intent` decision — the `fs/*` event gate stays what it is today, the model-facing tool layer's policy over `writeText`/`editText`.
- A payload above the backend's configured `maxWriteBytes` is refused with the existing `FS_TOO_LARGE` code before any content leaves the host, so an oversized buffer never reaches remote transport or disk. No new `FsErrorCode` is needed: the taxonomy already names this failure for `readBytes`.
- An existing non-regular target is refused with `FS_NOT_REGULAR_FILE`, and a backend that confines mutations fences the call by the calling session's resolved sandbox policy (`FS_SANDBOX_DENIED`).

There is no per-call `sandboxPolicy` parameter, unlike `writeText`/`editText`. That parameter exists so the tool layer can stamp one approved escalation onto one model-requested call; `writeBytes` has no model-facing tool and therefore no escalation path, so its callers get the session's resolved policy and nothing wider.

### Providers

`dsh-fs-local` reuses `writeFileAtomic` from `src/fsio.ts`, whose `content` parameter widens from `string` to `string | Uint8Array` — the staging directory, exclusive `0o600` temp file, fsync, mode preservation, Windows DACL handling, and rename are all already correct for bytes, and a second copy of that machinery would be the real risk. The write takes the same per-target lock as `writeText`, so a byte write and a text write of one path cannot interleave.

`dsh-fs-sandbox` overrides `writeBytes` to run `checkedTarget()` — the same canonicalize-then-contain fence, on the freshly re-resolved target — before delegating to the inherited implementation.

`dsh-fs-e2b` uploads the payload as a binary body through envd's file API (`sandbox.files.write` accepts an `ArrayBuffer`), reusing the existing staging-directory publication. This is the point of an SDK-level bytes write: no base64 shell round trip, and no `commands.run` slot spent on the content, so the four-slot spawn cap that the [command-concurrency Agent Note](2026-08-27-fs-e2b-command-concurrency-cap.md) exists to protect is untouched by payload size. Only the surrounding `chmod` steps take slots, exactly as `writeText` does today. The payload is copied into an exactly sized `ArrayBuffer` rather than handed over as `data.buffer`, because a `Uint8Array` may be a view over a larger pool — every Node `Buffer` is.

`maxWriteBytes` is a validated `Config` field on both concrete providers, defaulting to 64 MiB and capped by the runtime's `buffer.constants.MAX_LENGTH`. It is a deployment choice, not a stability invariant: an upload limit follows what a deployment wants its users to be able to store, and `dsh-sci-library` sets its own 50 MiB limit above this seam. `dsh-fs-sandbox` inherits the local backend's config unchanged.

## Alternatives considered

**Keep base64 text over `writeText`, as `sci-deliver` does.** Rejected as the load-bearing path: the stored file is unopenable by every other consumer in the sandbox — the `read` tool, the file panel's preview, a PDF skill, any shell command — which is exactly what a library of user-visible documents needs. It also inflates every payload by a third and burns a full UTF-8 decode on both sides. `sci-deliver`'s existing `.base64` snapshots stay as they are; migrating them is separate work with its own compatibility question.

**Give `writeBytes` an `FsWriteIntent` and a `sandboxPolicy`, symmetric with `writeText`.** Rejected for want of a consumer: both parameters exist to serve the model-facing tool layer — the observation policy that forces read-before-overwrite, and the one-call escalation grant. `writeBytes` has no tool. Adding the parameters now would mean an untested guard path in three providers and a `fs/write-intent` waterfall that no listener is written to answer for a binary payload. The seam's pre-release stance is to add them when a consumer needs them, and the missing guard is recorded as a known limitation on `dsh-fs`.

**Return an `FsWriteOutcome` like `writeText`.** Rejected: `before`/`after` are LF-normalized *text* for the consumer's contextual diff, and `operation`/`version` serve the guarded-write flow this method does not have. Returning a version no caller can use would invite a caller to build a byte-level compare-and-set the providers do not implement.

**A separate binary-filesystem seam, or a `writeStream`.** Rejected as premature. A second seam splits the sandbox fence, the per-target lock, and the target vocabulary across two services for one method. A streamed write is the real answer to payloads that should not be buffered whole, but no current consumer produces one — the library route buffers the multipart body anyway — so the bounded single-buffer write is what a current consumer needs, and `maxWriteBytes` makes the buffer's cost explicit.

**Put the cap in the caller instead of the provider.** Rejected: the bound must hold for every caller of the seam, and the provider is the one place that knows what its transport can carry. `dsh-sci-library`'s own smaller limit is a product policy layered on top, not a substitute.

## Acceptance criteria

- `FileSystem` declares `writeBytes`, and `dsh-fs-local`, `dsh-fs-sandbox`, and `dsh-fs-e2b` implement it; `pnpm exec tsc -b tsconfig.host.json` exits 0 with every in-repo `FileSystem` subclass concrete.
- Each concrete provider round-trips 1 MiB of random bytes through `readBytes` unchanged, creates missing parent directories, preserves an existing file's POSIX mode, refuses a payload one byte past `maxWriteBytes` with `FS_TOO_LARGE` while leaving the prior file intact, and refuses a directory target with `FS_NOT_REGULAR_FILE`.
- A `writeBytes` racing a version-guarded `writeText` on one target is serialized by the provider's per-target lock: the byte write commits and the text write behind it reports `FS_STALE_VERSION`.
- `dsh-fs-sandbox` denies `writeBytes` under `read-only` and under `workspace-write` for a target outside the writable roots (including through a symlinked-out directory), leaving no file on disk, and passes it through under `danger-full-access`.
- `dsh-fs-e2b` sends an `ArrayBuffer` body through `sandbox.files.write` and issues no `base64 -d` command for the payload.
- `packages/fs` and `packages/e2b` stay at per-file 100% coverage.

## Risks

- **The seam grows a method with no guard.** A future model-facing binary write tool would need the intent parameter added to three providers and the observation policy taught to answer for it. The limitation is recorded on `dsh-fs`'s README so the gap is visible before someone builds the tool on the unguarded method.
- **`writeFileAtomic` now serves two content types.** Its `handle.writeFile` call passes `encoding: 'utf8'` for both, which Node ignores for a `Uint8Array`. If that parameter ever stops being ignored, a byte write silently corrupts; the round-trip tests in `fs-local` catch it.
- **The 64 MiB default is a judgement, not a measurement.** It bounds one host-side buffer per in-flight write, so a deployment fanning out many concurrent large writes can still pressure host memory. The seam has no streamed write to fall back to, which is the deferral this note knowingly accepts.
- **`dsh-fs-e2b` gains its first `Config`.** Its README previously advertised "no config"; a deployment that mounts it with an unusable `maxWriteBytes` now fails loud at load rather than at the first large write, which is the intended direction but is a new failure point at boot.
