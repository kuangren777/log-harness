# office/ — office documents

English | [中文](README.zh.md)

The office-document capability: spreadsheets, documents, and slides the model creates and edits through a Univer Gateway, and a browser Viewer that shows the same files inside the harness web app. One package today; the group exists so the Gateway runtime, the model-facing tools, and the Viewer keep one home when a second document engine or a second client surface arrives.

| Package | Role | ctx key / surface |
|---|---|---|
| [`univer/`](univer/README.md) | Univer Gateway subprocess as the `univer` Service Provider, the `univer_*` tools (mountable per preset through `./tools`), version-matched bundled skills, and the same-origin Viewer reverse proxy under `/univer-gw`. | `ctx.univer`, `ctx.tools`, `ctx.webServer` |

The files panel that opens these documents in the web app is a client plugin at [`../client/ui-sci-files/`](../client/ui-sci-files/README.md).
