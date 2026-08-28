# sci-agent — the science-research layer without Dormice

English | [中文](README.zh.md)

Two runnable compositions, one per tier of the `sci` profile, over local filesystem and sandbox providers. [`cordis.yml`](cordis.yml) is the balanced tier; [`cluster.cordis.yml`](cluster.cordis.yml) is the same tree with the tier flipped, `declare_research_plan` mounted, and the in-process delegation stack behind it, so a diff between the two files is exactly what the second preset adds.

What is missing relative to `dsh --profile sci` is deployment, not science: the Dormice sandbox is replaced by `fs-local` over `sandbox-local`, and the Typert RPC surfaces (`sci.recall.*`, `sci.hosts.*`, `sci.tier.fork`) are absent because nothing here serves a browser. Every plugin a model can actually reach — the path gate, the authorization gate, delivery, skills, the tier guard — is the one the profile mounts.

## Running it

`DSH_SCI_PROJECT_ROOT` selects the project tree and defaults to the process cwd. The science layer classifies paths as `<projectRoot>/<project>/<role>/…`, so a project is a directory UNDER that root:

```
$DSH_SCI_PROJECT_ROOT/
  demo/           ← one project
    workspace/    ← the delivery area
    tmp/          ← scratch, never deliverable
    papers/ sciplots/
  .sci/spool/     ← the delivery spool the in-sandbox CLI writes into
```

## Snapshots

[`tests/sci-gates.snapshot.ts`](tests/sci-gates.snapshot.ts) records the five refusals the profile owes a model: the balanced tier's fan-out guard, the cluster tier's declaration latch, the delivery-area rule, the irreversible-action question, and manifest field ownership. Every recorded output is produced by the harness rather than by a model, so the scenarios boot the real config through the app's own `boot()` and drive the tool registry directly; no key is read and no model call is made. Re-record with `pnpm run test:snapshot:record -- examples/sci-agent`.
