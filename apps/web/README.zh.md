# `@deepseek-ai/dsh-web-frontend`

[English](README.md) | 中文

覆盖 [`dsh-client-web`](../../packages/client/web/README.zh.md) 外壳库的 Vite 构建。它不是独立应用：裸跑 `vite dev` 与 `vite preview` 会刻意失败，因为只有 Host 能注入 `window.__DSH_BOOT__`。在仓库检出中请运行 `pnpm dsh web`；已安装的 `dsh web` 提供的正是构建出的 `dist/`。

[`src/main.ts`](src/main.ts) 找到挂载点、启动 `AppWebEntry`，并申请应用外壳 service worker。其余部分——模块表播种、启动页、UI renderer 交接——都属于外壳库。

## 安装到主屏幕

每个 dsh 部署都从自己的 origin 提供一份可安装的渐进式 Web 应用。[`public/manifest.webmanifest`](public/manifest.webmanifest) 声明一个 standalone、竖屏的应用，其主题色与背景色取自浅色主题的 `--dsw-alias-bg-base`；跟随用户所选主题的运行时 `<meta name="theme-color">` 由 ui-layout 的主题呈现器写入，这也是 [`index.html`](index.html) 不放静态同名节点的原因——静态节点会在文档顺序上压过它。图标集由 [`public/favicon.svg`](public/favicon.svg) 生成：192 与 512 的 `any` 图块、一个标记完全落在 80% 安全圆内的 512 `maskable` 变体，以及 180px 的 `apple-touch-icon.png`，因为 iOS 既不读 manifest 的 icons 也不读它的 display 模式。`viewport-fit=cover` 是让 `env(safe-area-inset-*)` 解析出非零值的前提，外壳框架会用这些内边距为自己留白。

[`public/sw.js`](public/sw.js) 缓存应用外壳，使得没有网络时启动也能打开页面。它是手写并原样发布的，而非构建产物，因此其 URL 在各次部署间稳定为 `/sw.js`，浏览器的逐字节比较才能识别出更新。它**绝不**为 `/api` 之下的任何请求作答——该前缀承载全部 RPC 调用与两条事件下行——因为那里的缓存应答会报告一个 Host 已不再持有的会话、审批或权限状态；离线时正确的答案是报错，而不是一个自信的错误答案。导航请求优先走网络，因此在线页面总能拿到刚部署的文档，缓存永远只是离线回退。worker 以 `skipWaiting` 加 `clients.claim` 接管，并且**不**重载页面：重新部署的 worker 会立即替换已安装的那一个，而不必等待所有标签页关闭，同时不会丢掉正在进行的一轮对话的界面状态。

只有在浏览器允许的地方才会注册——`https:`，或明文 http 下的回环主机名（[`src/service-worker-registration.ts`](src/service-worker-registration.ts)）。因此通过局域网地址以明文 http 访问的部署只能在线运行，也不会出现安装提示。这是浏览器的规则，不是本应用的规则。

## 一个 origin 一个应用

PWA 绑定在它被安装时的那个 origin 上，而本部署的会话 cookie 是 `SameSite=Strict`。因此从服务器 A 安装的应用无法向服务器 B 认证：cookie 不会被发送，况且已安装的 scope 本来也覆盖不到 B。这里刻意没有跨 origin 的"服务器地址"设置项，因为这样的设置项不可能生效。

受支持的形态恰好相反：每个 dsh 部署各自提供一份可安装的应用，每个已安装应用为自己的 origin 保管自己的 cookie。切换服务器意味着导航到另一个 origin——如果那是你会常去的地方，也把它装上。应用内的"最近使用过的 origin"列表只会导航过去，绝不代理它们。
