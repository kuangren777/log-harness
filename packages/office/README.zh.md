# office/ — 办公文档

[English](README.md) | 中文

办公文档能力：模型通过 Univer Gateway 创建和编辑的表格、文档与幻灯片，以及在 harness web 应用内展示同一批文件的浏览器 Viewer。目前只有一个包；单独成组是为了在第二个文档引擎或第二个客户端界面到来时，Gateway 运行时、模型侧工具和 Viewer 仍有同一个归属。

| 包 | 职责 | ctx key / 界面 |
|---|---|---|
| [`univer/`](univer/README.zh.md) | 作为 `univer` Service Provider 的 Univer Gateway 子进程、`univer_*` 工具（可经 `./tools` 按 preset 挂载）、版本匹配的内置 skills，以及 `/univer-gw` 下的同源 Viewer 反向代理。 | `ctx.univer`、`ctx.tools`、`ctx.webServer` |

在 web 应用中打开这些文档的文件面板是客户端插件 [`../client/ui-sci-files/`](../client/ui-sci-files/README.zh.md)。
