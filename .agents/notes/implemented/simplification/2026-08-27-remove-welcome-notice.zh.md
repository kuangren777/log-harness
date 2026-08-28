# Agent Note: 移除欢迎声明引导步骤

Status: implemented

[English](2026-08-27-remove-welcome-notice.md) | 中文

## 问题

[共用弹窗产品引导](../feature/2026-08-13-shared-modal-product-onboarding.zh.md)决策在[全屏内测声明移除](2026-08-13-remove-first-run-beta-notice.zh.md)之后，在 `ui-settings-models` 中恢复了一份简洁的首启声明，复用了 `ui-onboarding.welcomeNoticeVersion` 字段。该声明的既有文案仍以「内测声明」／「Internal Testing Notice」开头。产品现已部署给经过认证网关访问的外部用户，因此带有 DeepSeek 内测定位表述的插页文案对这批受众来说是错误的。一旦去掉内测定位表述，该步骤就不再承载任何实质性的首启内容——版本字段的唯一作用就是决定何时再次显示这段定位表述——因此一个没有实质内容的强制阻断式弹窗纯属打扰，与最初那次移除所指出的问题如出一辙。

## 决策

本决策把欢迎声明引导步骤从 `ui-settings-models` 中整体删除，而不是改写文案。`WelcomeNotice.tsx`、`WelcomeNotice.module.css`、`welcome-store.ts` 及其测试均被移除；`src/onboarding-copy.ts`——其中只保存欢迎文案、版本、确认字段和 `WELCOME_NOTICE_SETTINGS_NAMESPACE` 重导出——因包内再无其他消费者而被整体删除。`index.ts` 不再在 `settings.onboarding` 中注册 `welcome-notice` 条目；`deepseek-official` 步骤成为唯一的占用者，并继续使用既有的 `OnboardingModal` 包装自身的界面。`locales.ts` 删除了 `welcomeTitle`/`welcomeBody`/`welcomeContinue`/`welcomeError` 这几个键。与最初那次移除一样，Host 端（`ui-settings-general`）仍保留 `ui-onboarding` settings namespace 的注册，使早期版本写入的文档（`welcomeNoticeVersion`）继续通过校验；目前已发布的代码不再读写该字段。

## 曾考虑的替代方案

**改写文案去掉内测定位表述，但保留该步骤。** 不予采用：一旦去掉 DeepSeek 定位表述以及历史上的遥测说明（自 2026-08-13 移除后已不存在），凭据步骤之前就不再有任何值得用强制阻断式弹窗呈现的首启内容——这会重新引入最初那次移除刚刚消除的打扰。

**用部署环境开关控制该声明是否显示，而不是删除它。** 不予采用：目前没有任何按部署区分内测构建与对外网关构建的配置 seam，仅为隐藏一个已无实质内容的组件而新增一个开关，缺乏现有消费者的支撑。

**连 `ui-onboarding` namespace 一起注销。** 不予采用，理由与最初那次移除相同：既有设置文档已经包含该分节，设置 seam 会用已注册的 namespace 校验存储文档；保留注册就能让这些文档继续有效，且没有额外成本。

## 后果

`settings.onboarding` 现在只挂载 DeepSeek 官方凭据步骤；`OnboardingModal` 仍作为该步骤及未来步骤的共用界面保留，但目前只包装一个占用者。`ui-onboarding` namespace 及其 `welcomeNoticeVersion` 字段仍保持注册且与既有文档兼容，但没有任何已发布步骤使用它们。本次移除取代了[共用弹窗产品引导](../feature/2026-08-13-shared-modal-product-onboarding.zh.md)决策中「恢复声明」的那一半；该笔记中关于共用弹窗界面与凭据步骤的决策仍然有效。
