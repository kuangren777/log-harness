# sci-agent —— 不依赖 Dormice 的科研层

[English](README.md) | 中文

两个可运行组合，对应 `sci` profile 的两个档位，跑在本地文件系统与沙箱 provider 上。[`cordis.yml`](cordis.yml) 是均衡档；[`cluster.cordis.yml`](cluster.cordis.yml) 是同一棵树翻到集群档、挂上 `declare_research_plan` 以及其后的进程内委派栈，所以两个文件的 diff 正好就是第二个 preset 多出来的东西。

相对 `dsh --profile sci` 缺的是部署而不是科研：Dormice 沙箱被 `fs-local` + `sandbox-local` 替代，Typert RPC 面（`sci.recall.*`、`sci.hosts.*`、`sci.tier.fork`）不在，因为这里没有任何东西服务浏览器。模型真正能碰到的每个插件——路径门禁、授权门禁、交付、skills、档位 guard——都与 profile 挂的是同一个。

## 怎么跑

`DSH_SCI_PROJECT_ROOT` 选定项目树，缺省为进程 cwd。科研层把路径按 `<projectRoot>/<project>/<role>/…` 分类，所以一个项目是该根目录**下面**的一个目录：

```
$DSH_SCI_PROJECT_ROOT/
  demo/           ← one project
    workspace/    ← the delivery area
    tmp/          ← scratch, never deliverable
    papers/ sciplots/
  .sci/spool/     ← the delivery spool the in-sandbox CLI writes into
```

## 快照

[`tests/sci-gates.snapshot.ts`](tests/sci-gates.snapshot.ts) 记录本 profile 欠模型的五种拒绝：均衡档扇出 guard、集群档声明 latch、交付区规则、不可逆操作问询、manifest 字段所有权。每一份记录下来的输出都由 harness 产生而非模型产生，所以这些场景通过 app 自己的 `boot()` 启动真实配置，直接驱动工具注册表；不读任何 key，也不发任何模型请求。重录用 `pnpm run test:snapshot:record -- examples/sci-agent`。
