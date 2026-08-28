# @deepseek-ai/dsh-client-ui-brand-sci

[English](README.md) | 中文

`sci` 档 Web 客户端的 CaMeL Science 视觉层。本包用 CaMeL Science 标记（圆角锥形渐变方块）与字标填充 `sidebar.brand.mark`、`sidebar.brand.name`、`conversation.hero.brand.mark` 三个槽位，通过 `ctx.theme.overrideTokens` 在 `--dsw-*` 基础调色板之上叠一层别名 token，并挂载一张插件自有的样式表，重定义上游样式已经读取的动效曲线、时长与字体栈。profile 会禁用 `ui-brand-official` 并插入本行；两行占用同一组 `single` 槽位，因此绝不会共存。

三个占位者与官方包一样，通过嵌套的 `slots.inject()` 作为一组声明感知的注册集合安装：无论本行在侧栏与会话声明者之前还是之后激活都能工作，任一声明塌缩时整组撤出，HMR 期间不会留下混搭的品牌。token 层为每个名字都提供两种配色模式（深色为近黑底 + 发丝线边框，浅色为米白底 + 白色表面，单色主按钮，iOS 语义状态色），切换配色时不会出现不可读的覆盖值。销毁本行会同时恢复内置品牌、基础调色板与上游动效曲线。本包不保留运行时状态；node 半边是一个空的 Loader 席位。

## 模型体验

无。本包只贡献浏览器端呈现，没有任何内容进入模型请求。

#### KV 缓存影响

无；本包既不组装也不发送供应商请求。

## 已知限制与后续工作

- **只改颜色，不改几何** —— token 层只改调色板；组件圆角与间距仍由各 UI 包自己的样式表决定。
- **浏览器标题独立** —— `DSH_CLIENT_TITLE` 在构建期选择标题文本，不经由 UI 槽位。
- **单一占位集合** —— 其他呈现方案应放在占用同一组槽位的另一个 Cordis 包里。
