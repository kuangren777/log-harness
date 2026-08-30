# sci-library — the user's paper and dataset library for the `sci` profile

English | [中文](README.zh.md)

`literature_search` finds works in the public indexes; nothing remembered them. This package is the remembering: a per-profile library of papers, datasets, and notes with the user's own tags, reading status, and notes, the files that belong to each entry inside the sandbox where every tool and skill can open them, and the tools and Remote surface through which the model and the 知识库 view read and write the same table.

## Surfaces

| Surface | Where | Config |
|---|---|---|
| Tool `library_search` | `ctx.tools.register()`, render intent `generic` (`kind: 'search'`) | `maxEntries` |
| Tool `library_add` | `ctx.tools.register()`, render intent `generic` | `maxFileBytes`, `fetchTimeoutMs` |
| Service `ctx.sciLibrary` | `LibraryRuntime extends TypertRemoteService` | all of `Config` |
| Remote `sci.library` | `list` / `get` / `add` / `update` / `remove` / `related` / `fetchPdf` | — |
| HTTP routes | `POST /library-api/upload`, `GET /library-api/file` (trusted requests only) | `maxFileBytes` |
| Storage domain `sci_library` | table `sci_library_entry` | `maxEntries` |
| Session event `sci/library-changed` | appended on the tool path only, `ignorable: true` | — |
| Prompt section `tool:library` | order `112`, directly after `tool:literature_search` | — |

## Config

| Field | Default | What it decides |
|---|---|---|
| `libraryRoot` | `/home/user/sci/library` | Sandbox directory holding one subdirectory per entry. The prompt section names it so the model opens stored files with `read` instead of re-downloading them. |
| `maxFileBytes` | `52428800` (50 MiB) | Upper bound for one uploaded or fetched file, enforced while the bytes stream. |
| `maxEntries` | `5000` | Entries the table retains. Past it, the oldest by `updatedAt` that carry no files are dropped first; an entry with files is never trimmed. |
| `fetchTimeoutMs` | `30000` | Budget for one open-access PDF download. |

## Entries, identity, and the merge

An entry's id is the literature record's id (`doi:…` / `arxiv:…` / `title:…`) when it came from the search layer, `file:<sha256>` for a bare upload, and `note:<ulid>` for a note. Adding an id the table already holds merges: tags union, files union, absent fields fill in, and the reply says `created: false`. Deleting can also delete the entry's directory, but only when asked.

Listing is a lexical scan — tokens of the query scored over title (×3), tags (×2), abstract (×1), and authors (×1); no query means newest-updated first. Filters (`kind`, `status`, `tag`) apply before pagination, and every reply carries the real `counts` and tag histogram the 知识库 view draws its chips from. There is no embedding index anywhere in this repository, and this package does not pretend otherwise.

## Files: uploads, downloads, and fetched PDFs

The browser cannot write into the sandbox through any pre-existing surface, so this package registers `/library-api` on the host web server behind the same request-trust check the Univer routes use. `POST /library-api/upload` takes one multipart file (extension allowlist, sanitized name, `413` over the cap, `415` for a type outside the list), writes it through `ctx.fs.writeBytes` into `<libraryRoot>/<entry-dir>/`, and returns the updated entry. `GET /library-api/file` streams a stored file back for preview or download — the path around `workspace.readFile`'s 8 MiB reply cap.

`fetchPdf` (and `library_add` with `with_pdf`) downloads a known open-access PDF server-side: `https:` only, private hosts refused at every redirect hop (at most three), the size cap enforced while reading, and a reply that is neither `application/pdf` nor `%PDF`-prefixed rejected — a login page saved as `paper.pdf` is the failure this check exists for.

## The library is not a projection

Like `sci_literature_history`, the table is written directly: the 知识库 view adds, edits, and deletes entries with no agent session to replay. `sci/library-changed` is appended only on the tool path, where a session exists, and carries the operation and the id — the record text already sits in the neighbouring `tool/result`.

## Model Experience

### Tool schemas

#### What the model sees

The generated [`library_search` and `library_add` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-sci-library): free-text `query` with `kind` / `status` / `tag` / `limit` filters on the search side; `doi` / `arxiv_id` / `title` / `url` / `tags` / `with_pdf` on the add side.

#### Token effect

Fixed schema cost on every request where the tools are visible.

#### KV Cache effect

Prefix-stable while the definitions are unchanged; the page limit appears in a parameter description, so changing `maxEntries` does not rewrite the schema but changing the limit constant would.

### Prompt section `tool:library`

#### What the model sees

One section at order `112`, immediately after `tool:literature_search`: search the user's own collection first, save keepers with `library_add`, cite only identifiers the entries carry, and open stored files from `<libraryRoot>/<entry-dir>/` with `read` instead of re-downloading.

##### Verbatim text of the section

```markdown
用户的知识库用 library_search 查：里面是用户自己收藏的文献、数据集和笔记，还带着他们自己写的标签、状态和笔记。问题涉及「我收藏的」「我之前存的」资料时先查知识库，再决定要不要用 literature_search 检索公开索引。把值得长期留存的文献用 library_add 存进去：给了 doi 或 arxiv_id 会自动补全元数据，只有标题时按手工条目保存。引用知识库条目时写它自己的 DOI 或 arXiv id，不要凭印象补全。条目的文件就在沙箱里 /home/user/sci/library/<条目目录>/ 下，library_search 的结果里给的是完整路径，读 PDF 或数据文件直接用 read 或 pdf 技能打开那个路径，不要重新下载。
```

The `libraryRoot` inside the text follows the configured value; the default is shown.

#### Token effect

Fixed, roughly 160 tokens, on every request in a composition that mounts this package.

#### KV Cache effect

Prefix-stable for a fixed `libraryRoot`; changing that config value rewrites the section and breaks the prefix once.

### Tool-call history and results

#### What the model sees

`library_search` renders one line per entry — title, up to three authors then `et al.`, year, status, up to three tags, the identifier, and the entry's file paths — plus the real counts line. `library_add` renders one confirmation line naming the entry, whether it was created or merged, and any PDF-fetch error.

#### Token effect

Proportional to the returned entries, roughly 30–60 tokens per line at the default limit of 50; a targeted query costs far less.

#### KV Cache effect

Append-only; timestamps vary per call, so two identical searches do not share a suffix.

## Known Limitations and Deferred Work

- **Search is lexical.** Title/tags/abstract/authors token scoring only; no semantic index exists in the repository. A miss for a paraphrased query is expected behaviour, not a bug.
- **The table is not reconstructable.** Browser-made changes have no session log to replay; losing the storage medium loses the library rows (the files under `libraryRoot` survive with the sandbox).
- **Inline preview stops at 8 MiB.** The 知识库 view previews files through `workspace.readFile`; anything larger is offered through `/library-api/file` as a download instead.
- **`sci-deliver` still snapshots as `.base64` text.** The deliver spool predates `FileSystem.writeBytes` and is not migrated this cycle.
- **No keyless snapshot is recorded yet.** `library_search` / `library_add` are model-visible and owe one; the scenario file is written and recording it is an assembly step.
