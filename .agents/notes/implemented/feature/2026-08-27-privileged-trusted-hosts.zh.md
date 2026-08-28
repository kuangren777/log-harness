# Agent Note: `privilegedTrustedHosts` opens the configuration plane to declared authorities

Status: implemented

[English](2026-08-27-privileged-trusted-hosts.md) | 中文

## Problem

`/api` 浏览器信任围栏接受回环加上部署方声明的 `trustedHosts`，但特权方法集——`settings.*`、`credentials.*`、`agentPreset.read`/`copy`/`remove`/`openDocument`、`host.pickDirectory`/`openPath`、`llm.discoverModels`——是以空信任表过同一个围栏，因此被钉在回环。`authority: 'loopback'` 的 RPC 通道同理。浏览器侧只按页面 authority 镜像这个钉法：`connection.isLoopback` 为 describe 镜像和每个绑定 scope 选出 `'host'` 或 `'memory'` 持久化模式。

在 `trustedHosts` 只是 DNS 重绑定防护时，这是正确的。但对已经具备认证的部署就不对了：`dsh --profile sci --trusted-host sci.example --trusted-host sci2.example` 跑在具备认证能力的网关之后，服务的是已登录的操作者，可模型设置页仍然报「settings are unavailable in this browser」，agent（智能体） preset 选择器也保持禁用，因为页面只读自己的 hostname 就放弃了。这个钉法从一个本就补齐了缺失层的部署上拿掉了功能。

## Decision

`privilegedTrustedHosts`（布尔，默认 false）是部署方的显式声明：具备认证能力的反向代理置于本进程之前，并转发公网 `Host`。取值为 true 时，特权方法集与每条 `authority: 'loopback'` RPC 通道——独占通道路由与共享 `/api` interceptor——都使用与普通方法相同的 `trustedHosts` 名单过围栏。它绝不授予名单之外的任何 host，名单为空时是空操作，因为此时开关的名单正是钉法本就使用的那份空表。

node 半侧把解析后的取值以 `global` index-injection 行发布到页面：`__DSH_CONNECTION__ = { privilegedTrustedHosts }`。`src/boot-global.ts` 是属性名与取值字段的唯一归属地，两个半侧都从这里导入。

`ConnectionHandle` 新增 `configurationPlane: 'host' | 'memory'`：页面为回环，或 Host 发布了该开关时取 `'host'`。`isLoopback` 保持不变，并保留自己的消费者：宿主桌面操作（打开路径、选目录、General 设置里的文档操作）关心的是进程所在的机器，而不是谁有权配置它。ui-settings 的 describe 镜像与每个绑定 scope 改读 `configurationPlane`，因此在已开启的部署上，设置页面与 preset 选择器无需自身改动即可恢复。

`dsh web --privileged-trusted-hosts` 是本次调用的 flag。没有任何 `--trusted-host` 时它是用法错误；它沿用既有的 `webRuntime` 快照——与围栏 authority 同一份取值——传入 connection 行的配置。

## Alternatives considered

**在网关把 `Host` 改写成 `127.0.0.1`。** 否决，因为它对必须判断信任的进程隐藏了真实来源，而且并不能修好页面：浏览器读的是 `location.hostname`，客户端半侧仍会选内存持久化，设置页面照样坏着。

**只解开 agent（智能体） preset 的选择。** 否决，因为它只处理了抱怨中较小的那一半。设置页面自身的失败来自 settings 与 credentials 方法，所以该部署仍会看到不可用的模型页面。

**只要 `trustedHosts` 非空就隐式放宽。** 否决，因为 `--trusted-host` 正是普通局域网部署声明自己被哪些名字访问的方式，那里根本没有任何认证。隐式放宽会把凭据存储与 preset 名单交给每一个匿名局域网调用方，而该次调用的作者只要求了可达性。

## Consequences

在 authority 旁边加上 `--privileged-trusted-hosts` 的部署，可以在远程浏览器里正常使用设置、凭据与 preset 创作面，并且是持久化而不是内存镜像。其他部署不受影响：flag 默认关闭，未受信任的 `Host` 仍被拒绝，没有 `trustedHosts` 的调用什么也放宽不了。这个开关的强度完全等于它前面那层代理——没有代理，它就是把配置面公开给所有能访问已声明 authority 的人。

宿主桌面操作仍通过 `isLoopback` 只限回环：已开启的远程浏览器可以配置部署，但不会在宿主机上打开原生对话框或路径。

## Testing

包测试覆盖两处围栏点——既有手工构造的请求，也有真实 HTTP 服务器（被代理的浏览器发出的 Host header，由 Node 真实解析）、`trustedHosts` 为空时的空操作、开关下的 loopback-authority 独占通道与共享 `/api` interceptor，以及两种解析取值的 index-injection 行（含随 fiber 一起移除）。客户端半侧针对全局量存在、缺失、发布为 false 三种情况，在回环与公网 authority 上都做了固定。ui-settings 的插件套件双向断言持久化跟随 `configurationPlane`，web-app 套件覆盖 flag 解析、用法错误，以及 connection 行读取的 `webRuntime` 快照。`packages/bundle/web-app/tests/profile-flag-binding.spec.ts` 在真实 Loader 配置树上启动 `--profile` 调用真正经历的三跳——真实的 `web-startup` 与 `web-app` 插件体、bundle patch 自己的 `inject` 列表与配置表达式——并断言该取值抵达 `connection` 行解析后的配置；因为 bundle patch 的表达式是由 Loader 解析的，手工 `ctx.plugin` 调用对此证明不了任何东西。
