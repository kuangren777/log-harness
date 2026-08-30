# sci-citations — the per-project citation pool for the `sci` profile

English | [中文](README.zh.md)

`sci-library` remembers works the user cares about; this package tracks the ones one manuscript actually cites. A pool is scoped to one paper project: the entries in it, the groups a person filed them into, a deterministic confidence score, the number of times the manuscript really cites each citekey, and the `refs.bib` on disk that all of it is written into and read back out of.

## Surfaces

| Surface | Where | Config |
|---|---|---|
| Tool `citations_list` | `ctx.tools.register()`, render intent `generic` (`kind: 'read'`) | `projectRoot` |
| Tool `citations_add` | `ctx.tools.register()`, render intent `generic` (`kind: 'other'`) | `projectRoot`, `maxCitations` |
| Service `ctx.sciCitations` | `CitationsRuntime extends TypertRemoteService` | all of `Config` |
| Remote `sci.citations` | `projects` / `pool` / `upsertGroup` / `removeGroup` / `move` / `add` / `update` / `removeCitation` / `rescan` / `exportBibtex` | — |
| Storage domain `sci_citations` | tables `sci_citation`, `sci_citation_group` | `maxCitations` |
| Session event `sci/citations-changed` | appended on the tool path only, `ignorable: true` | — |
| Prompt section `tool:citations` | order `113`, directly after `tool:library` | — |
| Invariant `./invariant` | every committed row under the quarantine threshold carries the flag | — |

## Config

| Field | Default | What it decides |
|---|---|---|
| `projectRoot` | `/home/user/sci/projects` | Directory holding one subdirectory per project. The tools infer which pool a call is about by matching the session's working directory against it, and refuse when it does not match. |
| `scanMaxBytes` | `2000000` (2 MB) | Largest `.md` or `.tex` file the in-text scan reads. A file the backend reports as larger is skipped without being read. |
| `maxCitations` | `2000` | Citations one project's pool may hold. Past it, a new citekey is refused; re-adding one the pool already holds still works. |

The paper-bundle names around it are not configuration. `papers/<slug>/src/refs.bib` and `workspace/` are the layout every `sci-paper` skill run writes, so a deployment that renamed them would have broken the skill before it reached this package.

## The bibliography is authoritative, the decisions are not re-derivable

A citation row has two halves and they are owned differently.

The bibliographic half — title, authors, year, venue, DOI, arXiv id — comes from `refs.bib` and can always be read again, which is what `rescan` does: it parses every bundle's bibliography, creates a row for a citekey it has not seen, and refreshes the fields of one it has. The in-text `uses` count is re-derivable the same way, by scanning the project's own `.md` and `.tex` through the `ctx.fs` seam the model's `read` tool uses.

The other half has no second origin: which group a person filed a citation under, the note they attached, and a quarantine they set by hand. Nothing outside the table remembers those, so `rescan` never touches them. Confidence is recomputed only for a row whose sole provenance is `refs.bib`; a row that came from a real index carries signals the file never held (`citedBy` above all), and rescoring it from the file would lower it on every scan.

`upsertBibtexEntry` replaces exactly the span of the citekey it rewrites, so a bibliography full of comments, `@string` macros, and hand-tuned spacing survives the model writing one entry into it. A block the parser cannot read becomes one `parseErrors` entry carrying its file and line rather than disappearing from the pool.

## Confidence is arithmetic, not an opinion

The score is a pure function with no model call and no network: three or more agreeing sources `+45`, two `+35`, one `+15`; a known year `+10`; a venue `+10`; not being an arXiv-only preprint `+10`; the citation count contributes a log-scaled `0–25` that saturates at 1000. The sum is clamped to 100. An entry that exists only because `refs.bib` names it and carries no DOI scores 30 outright, because nothing in the formula's inputs was ever verified for it. A library status is a person's verdict rather than a signal, so it clamps afterwards: `verified` reads 100, `low-confidence` caps at 60.

Below 70 an entry is quarantined, and that half of the flag is nobody's to lower — `update({ quarantined: false })` and a move out of the `quarantine` group both leave a weak entry held back, and the row that comes back says so. Above the threshold the flag is purely a person's decision and no recomputation clears it.

## Model Experience

### Tool schemas

#### What the model sees

The generated [`citations_list` and `citations_add` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-sci-citations): `project` and `group` on the list side; `project`, `doi`, `arxiv_id`, `library_id`, `citekey`, and `group` on the add side. No parameter is required — `project` omitted means the project this session is working in.

#### Token effect

Fixed schema cost on every request where the tools are visible.

#### KV Cache effect

Prefix-stable while the definitions are unchanged; no configured value appears in either schema, so changing `projectRoot` or `maxCitations` does not rewrite them.

### Prompt section `tool:citations`

#### What the model sees

One section at order `113`, immediately after `tool:library`: route every citation through `citations_add`, cite with the citekey it returns, never invent one or hand-write a `refs.bib` entry, and run `citations_list` before handing a draft over.

##### Verbatim text of the section

```markdown
写论文或综述时，每引用一篇文献先调用 citations_add 放进本项目的引用池，它会解析文献并写入 papers/<slug>/src/refs.bib，然后用它返回的 citekey：LaTeX 里写 \cite{citekey}，Markdown 里写 `[citekey]`。不要自己编 citekey，也不要手写 refs.bib 条目——引用池里没有的 citekey 在排版后是 [?]。交付前调用 citations_list 核对：带「隔离」的条目不能出现在正文里，引用次数为 0 的条目要么用上要么移除。project 参数留空表示当前会话所在的项目。
```

#### Token effect

Fixed, roughly 190 tokens, on every request in a composition that mounts this package.

#### KV Cache effect

Prefix-stable: the text carries no configured value, so nothing in cordis.yml rewrites it.

### Tool-call history and results

#### What the model sees

`citations_list` renders a header line with the real counts, then one numbered line per citation — citekey, title, year, confidence, group, in-text uses, and `隔离` for a quarantined entry — and a closing reminder only when something is quarantined. `citations_add` renders one line naming the citekey and both spellings the manuscript may cite it with. A session that is not inside a project directory gets a refusal that names the directory shape it needs to be in, never a guessed slug.

#### Token effect

Proportional to the pool: roughly 30–50 tokens per line. A pool at the 2000-entry limit is far larger than one listing should be, so the `group` filter is the way to keep a check cheap.

#### KV Cache effect

Append-only; the counts change with every add, so two listings around one addition do not share a suffix.

## Known Limitations and Deferred Work

- **No `[n]` link from prose back to the pool.** `ui-primitives` parses inline-code mentions only, so a rendered `[key]` in a message is text; the seam that would make it a link into the pool view is not built.
- **Source disagreement is not shown.** `sci-literature` merges the four indexes before this layer sees them and discards the per-source values, so a work two indexes date differently reads as one year with no way to see the conflict. Surfacing the spread needs the merge to keep its inputs.
- **The tables are not reconstructable.** Changes made from the browser view have no session log to replay. The bibliographic half survives in `refs.bib` and comes back through `rescan`; the group, note, and hand-set quarantine do not.
- **`scannedFiles` is per-process.** The header's file count is what the last `rescan` walked in this process and reads `0` after a restart until the next scan. It is an ornament rather than a fact about the pool, and persisting it would mean a third table holding one number nobody can act on.
- **One bundle owns the bibliography.** `citations_add` writes into the first paper bundle in listing order. A project with two manuscripts that cite different works needs `rescan` plus a manual split; per-bundle pools are not modelled.
