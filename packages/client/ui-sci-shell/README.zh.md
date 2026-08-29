# @deepseek-ai/dsh-client-ui-sci-shell

[English](README.md) | 中文

CaMeL Science 工作台外壳：左侧图标轨、轨底的两个控件、账户浮层，以及极光背景层。图标轨占用 [ui-layout](../ui-layout/README.zh.md) 的通用 `rail` 槽位，因此把本包从 cordis.yml 里撤下时那一轨自然回到零宽，三栏重新占满整个框架。契约见[槽位系统标准](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.zh.md)。

这里没有任何与具体视图绑定的机制。图标轨把 `rail.item` 与 `rail.footer` 声明为普通的 root 作用域 list 槽位，并把框架的 `{ view, showView }` 原样交给两者——`showView` 与 `ctx.layout.showView` 是同一次写入。因此后续的视图包只需在本包自带的「研究流」按钮旁再注册一条 `rail.item`，并注册对应的 `view` key，就能加一个视图，两步都不必改动本包。按钮的激活态读自那份 owner share 而不是布局服务，所以它画出来的状态和它触发的跳转不会各说各话。

主题切换按钮通过 `apply` 里一次性构建的读取/订阅对访问 `ctx.theme`，点击时写回另一个具体主题。身份则是一次普通的同源 HTTP 读取：sci-gate 反代了这个页面，`/gate/api/me` 与 `/gate/api/credit/balance` 凭会话 cookie 作答，任何凭据都不会进入这里的代码。两个读取都收在 `gate-me.ts` 的完备词汇背后——非 2xx、非对象响应体、网关不可达，统统化为 `null`，不会在渲染期抛出——网关报出的每个 id 都归一为字符串，因为浮层是按 id 匹配当前 VM 的，绝不按 slug。

轨底头像与浮层是共用同一个 store handle 的两条注册，该 handle 在 `apply` 里构建一次，框架据此解析出唯一的 root 作用域实例：点击头像正是浮层观察到的那件事，浮层读到的网关身份也正是头像首字母的来源。读取发生在挂载时而非展开时，因为头像不该等用户先点开什么。卡片上的每一行都是网关答复过的事实——账户邮箱、角色与租户、当前 VM 的 slug 与镜像标签、余额及用尽标记——网关没有答复的行根本不渲染。读不到网关时只显示一行说明，不显示任何数字。

浮层所在的图层默认点击穿透，所以卡片只在显示期间重新接管指针事件：关闭状态的卡片不会截走任何本该落到下层应用的点击。按 `Esc` 或点击遮罩即关闭；退出登录会 POST `/gate/api/logout`，仅在网关接受之后才跳转 `/gate/login`。极光层带 `aria-hidden`、从不接收指针事件，并带 `data-sci-motion`，让 ui-brand-sci 的减弱动效规则只停掉它的漂移而不波及页面上其他动画；它以 `order: -100` 注册，远低于其他任何浮层条目，因为它是背景。

`SciLogo` 是本包从 [ui-brand-sci](../ui-brand-sci/README.zh.md) 引入的唯一符号，`CONVERSATION_VIEW` 是从 ui-layout 引入的唯一符号，两行都以 `dsh.client.external` 声明为模块图请求。`/client` 的导出只有插件体（`apply`/`inject`）——组件、store 工厂与网关读取都留在槽位注册之后的包内。

## Model Experience

None，本包是纯浏览器侧外壳，Node 半边只是一个惰性 loader 座位：不注册任何工具、提示词段落或会话事件，它展示的事实只来自浏览器自己的主题服务，以及本就在为这个页面服务的网关。

#### KV Cache effect

None；本包既不组装也不发送任何模型请求。

## Known Limitations and Deferred Work

- **网关不可达时浮层降级为一行。** 前面没有 sci-gate 的 dsh 页面（本地 `dsh web`、直连端口）没有 `/gate/api/*` 可答，卡片会说明未登录网关，并且不显示邮箱、VM 与余额。图标轨、主题切换与极光不受影响；本包刻意不在这种状态下渲染任何占位数字。
- **身份只在挂载时读一次，不保持实时。** 网关没有变更流可订阅，所以在另一个标签页里换过的 VM、花掉的余额，要到页面重载才会体现。轮询被否决：那是每个会话都要长期付出的代价，而多数用户很少展开这张卡片。
- **余额只展示不解释。** 卡片只给出合计额度，旁边跟随网关自己的 `exhausted` 标记；构成它的套餐额度与充值额度、订阅周期、充值入口都属于网关自己的额度页，浮层不做跳转，因为外壳目前还没有描述网关页面的路由词汇。
- **退出登录采取整页跳转，而不是就地拆除会话。** 这个页面本身位于网关的源内，清掉 cookie 就使正在运行的页面失效，跳转到登录页是唯一诚实的终态——尚未发送的输入框草稿会随之丢失。
