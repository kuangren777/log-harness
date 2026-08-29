# sci-literature — cross-index literature search, the merge, and the query history for the `sci` profile

English | [中文](README.zh.md)

The `sci` profile's model has `web_search`, which returns pages. A citation needs a work: a title with the authors who wrote it, the venue and year it appeared in, and an identifier a reader can resolve. This package is that capability. One query fans out to OpenAlex, Semantic Scholar, arXiv, and Crossref in parallel, the four answers are merged into one record per work, and the result carries a DOI or an arXiv id on every entry the model is told to cite from.

Nothing here is a provider-selection seam. `ctx.web` picks one provider per call and refuses when several are usable; a literature search wants all four indexes at once, because each knows something the others do not — OpenAlex has citation counts and open-access state, Crossref is authoritative for publisher metadata, arXiv has the preprint months before the journal, and Semantic Scholar has abstracts the other three sometimes lack. Fanning out is the contract, not an implementation detail, so `ctx.sciLiterature` is its own service rather than a fifth `ctx.web` provider.

## Surfaces

| Surface | Where | Config |
|---|---|---|
| Tool `literature_search` | `ctx.tools.register()`, render intent `generic` (`kind: 'search'`) | `sources`, `maxPerSource`, `timeoutMs` |
| Service `ctx.sciLiterature` | `LiteratureRuntime extends TypertRemoteService` | all of `Config` |
| Remote `sci.literature` | `search` / `recent` / `forget` | — |
| Storage domain `sci_literature` | table `sci_literature_history` | `historyLimit` (default `50`) |
| Session event `sci/literature-searched` | appended on the tool path only, `ignorable: true` | — |
| Prompt section `tool:literature_search` | order `111`, directly after `tool:web_search` | — |

## Config

| Field | Default | What it decides |
|---|---|---|
| `mailto` | `''` | Contact address sent to OpenAlex and Crossref. Empty keeps the layer out of both polite pools, which lowers the rate limit but still answers. |
| `s2ApiKeyEnv` | `'S2_API_KEY'` | Names the OPTIONAL Semantic Scholar key. The graph API answers keyless at a low shared-IP limit, so an absent key lowers throughput rather than removing the source. |
| `timeoutMs` | `8000` | Per-source budget for one fan-out. |
| `maxPerSource` | `15` | Records requested from each index before merging. |
| `userAgent` | `'camel-science/0.1 (+https://sci.camelco.de)'` | Product identity every outbound request announces; never a browser disguise. |
| `sources` | all four | Which indexes one search reaches. An empty list is refused at load. |
| `historyLimit` | `50` | Searches the history table retains before the oldest rows are dropped. |

## What one search does

`search(request, signal?)` validates first — a blank query, a query past 300 characters, a limit outside `1..20`, or a year range that ends before it starts is `LITERATURE_INVALID_REQUEST` before any index is contacted. Each configured source then runs under `AbortSignal.any([callerSignal, AbortSignal.timeout(timeoutMs)])`, and the four settle through `Promise.allSettled`. A source that failed becomes one `sourceErrors` entry naming the source and a machine-routable code; the records the others returned are still returned. Only a fan-out in which **no** index answered throws, as `LITERATURE_ALL_SOURCES_FAILED`.

Reported failure messages carry the source name and the HTTP status, never the transport detail — a refused connection reads as `arxiv: request failed`, because the address the harness could not reach is not something a model or a user needs.

## Identity and the merge

Four indexes describe one work four ways. A record is recognized by the strongest key it carries — DOI, then arXiv id, then the normalized title — and it joins an existing group when **any** of those three keys is already claimed. That is what lets the OpenAlex row with a DOI and the arXiv row with only an id land on one record, and it is why the keys a group answers to are re-registered after each merge: a group that only just gained a DOI must answer to it when Crossref returns the same work under a different title.

The merge keeps facts, never opinions. A present field beats an absent one; the citation count is the largest any source reported; the author list is the longer of the two, because a truncated list is not a fact; `sources` is the union in arrival order; and `source` names the index whose metadata is most complete (`openalex > semanticscholar > crossref > arxiv`), not whichever answered first.

Ranking is `Σ 1/(position + 1)` over every source list the work appeared in, plus `0.15 · log₁₀(citedBy + 1)`, with ties broken by descending year and then by title. Agreement across indexes is the dominant term and the citation term is logarithmic: 5000 citations are worth about 0.55, more than a second index ranking a work fourth and less than a second index ranking it first.

## The transport

Every adapter reaches its index through `src/http.ts`, so one set of rules holds for all four: `https:` only, a fixed allowlist of `api.openalex.org`, `api.semanticscholar.org`, `export.arxiv.org`, and `api.crossref.org`, `redirect: 'error'`, and a 2 MB cap enforced **while reading** rather than after the reply arrived. The model chooses the query but never the host, and an index that started answering with a redirect to somewhere the allowlist never cleared is refused rather than followed.

arXiv publishes no JSON and Node has no `DOMParser`, so `src/adapters/arxiv.ts` carries a reader for exactly the seven elements the record type needs. It is a reader for that one feed, not an XML parser: it assumes the well-formed, CDATA-free output the arXiv API actually produces, and a feed shaped differently yields fewer records rather than a wrong one. It also ANDs the query terms, because arXiv reads bare whitespace between terms as `OR` — an unquoted four-word topic would otherwise match anything containing any single word.

## The query history is not a projection

Every other `sci_*` table folds a session log. `sci_literature_history` cannot: a search run from the browser's search view has no agent session, so the row written at the end of `search()` is the only record that the query happened. Dropping the medium loses the history rather than rebuilding it. The table therefore holds nothing but what the "recent queries" strip shows, and no other layer reads it.

Rows are keyed by `sha1` of the case-folded, whitespace-collapsed query, so re-searching the same thing moves one chip to the front instead of stacking a second identical one. `./invariant` asserts that relationship over the committed rows: a row stored under a key its own query does not derive is a chip the user could never remove, because the `forget` call would silently hit nothing.

## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`literature_search` schema](../../../docs/tool-catalog.md#deepseek-aidsh-sci-literature): a required `query` string plus optional `year_from`, `year_to`, and `limit`. The description names the four indexes and states the division of labour — use this instead of `web_search` whenever the answer is a paper. The declared `output.schema` is the full record shape (`id`, `title`, `authors[]`, `year`, `venue`, `abstract`, `doi`, `arxivId`, `url`, `pdfUrl`, `citedBy`, `source`, `sources[]`) plus `total`, `sourceErrors[]`, and `elapsedMs`, so a Code Mode program reads `records[i].doi` directly instead of parsing the rendered list.

#### Token effect

Fixed schema cost on every request where the tool is visible.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged. `MAX_QUERY_LENGTH` and `MAX_SEARCH_LIMIT` appear in the parameter descriptions, so changing either invalidates the prefix; `mailto`, `sources`, `timeoutMs`, `maxPerSource`, and `historyLimit` do not appear anywhere the model sees and can be changed without cost.

### Prompt section `tool:literature_search`

#### What the model sees

One section at order `111`, immediately after `tool:web_search`, stating which tool papers go through, that a citation may name only an identifier the search returned, what to say when nothing came back, and that a partial result is still usable.

##### Verbatim text of the section

```markdown
查学术文献用 literature_search，不要用 web_search：它同时检索 OpenAlex、Semantic Scholar、arXiv、Crossref，返回带 DOI 或 arXiv id 的结构化文献记录。引用时只写返回记录里的 DOI 或 arXiv id，不要凭印象补全或改写。返回为空时直接说没有检索到，不要编造文献。部分来源失败时结果仍然可用，在回答里说明少了哪个来源。
```

#### Token effect

Fixed, roughly 130 tokens, on every request in a composition that mounts this package.

#### KV Cache effect

Prefix-stable: the text is a literal with no interpolation, so no configuration change rewrites it. It sits in the system prompt ahead of the conversation, so mounting or unmounting the package invalidates everything after it.

### Tool-call history and result

#### What the model sees

A numbered list, one line per returned record: title, up to three authors then `et al.`, venue, year, `被引 N`, `doi:…` or `arXiv:…`, and the open-access PDF link when there is one. The head line states the merged total and how many were returned, so a truncated result never reads as complete. Sources that failed are named with their codes on a `来源错误：` line, and every result ends with `引用时写 DOI 或 arXiv id。`. An empty search renders `没有检索到文献。` rather than an empty list. The call renders as a `generic` card (`kind: 'search'`) titled with the query; the completed card is `generic`, so a UI without the literature card falls back to this same text. The `sci/literature-searched` event is log-only and never enters model history.

#### Token effect

Proportional to the returned records: roughly one line of 30–60 tokens each, so the default limit of 10 costs a few hundred tokens once. Abstracts are in the canonical value for Code Mode but not in the rendered text, which is what keeps the line count flat.

#### KV Cache effect

Append-only; a search adds a tool call and its result and disturbs no earlier prefix. `elapsedMs` and the merged total vary per call, so two identical queries do not share a result prefix.

## Known Limitations and Deferred Work

- **The query history is not reconstructable.** It is the one `sci_*` table that is not a log projection (see above). A profile that loses its storage medium loses every recent query with no way to rebuild them, and a search run from the browser view leaves no trace anywhere else.
- **Semantic Scholar is rate-limited by shared IP.** Without a key the graph API allows about 100 requests per 5 minutes across everyone on the address, so `429` is the ordinary failure in a busy deployment. It lands in `sourceErrors` and the other three sources still answer, but a deployment that wants Semantic Scholar reliably has to supply `S2_API_KEY`.
- **The arXiv reader covers a fixed subset of Atom.** `id`, `title`, `summary`, `author/name`, `published`, the `title="pdf"` link, `arxiv:doi`, and `arxiv:journal_ref` — nothing else. A feed carrying CDATA, a namespace prefix other than `arxiv:`, or an entry whose title is split across nested elements yields fewer records rather than a wrong one, and no diagnostic distinguishes "arXiv returned nothing" from "the reader understood nothing".
- **Year bounds are approximate for arXiv.** The API has no year filter, so a bounded search asks for `maxPerSource` entries and drops the ones outside the range afterwards. A bounded query whose matches all fall outside the first `maxPerSource` relevance hits returns nothing from arXiv while the other three sources answer normally.
- **Cross-key merging is single-pass.** Two records are grouped when one carries a key the group already answers to. Three records that would only transitively be one work — A shares a title with B, B shares a DOI with C, and C arrives before B — stay as two groups, because a group registers its gained keys only after the merge that gained them.
- **Crossref is restricted to `journal-article`.** Conference proceedings, book chapters, datasets, and preprints registered with Crossref are not returned by that source. They still reach the result through OpenAlex or arXiv when those indexes hold them.
- **No keyless snapshot is recorded yet.** `literature_search` is a model-visible change and owes one, and the scenario is written; recording it needs `DEEPSEEK_API_KEY` and the composition entry that mounts this package in `examples/sci-agent`. Until then the assembled-transcript tier is covered only by this package's real-composition test.
