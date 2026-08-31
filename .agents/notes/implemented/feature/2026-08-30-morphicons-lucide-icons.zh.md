# Agent Note:Web 客户端图标系统切换为 morphicons + lucide

状态:implemented

[English](2026-08-30-morphicons-lucide-icons.md) | 中文

## 问题

Web 客户端原本带两套无法动画的手绘图标:`ui-primitives` 画了 70 个 fill 实心风格的 `ic_ds_*` 字形(deepsuite figma 导出),五个 `ui-sci-*` 包各自按设计稿重画描边字形。状态变化时组件直接互换、单帧跳变 —— 主题太阳/月亮、文件夹开/合、chevron 展开、复制/对勾反馈、发送/停止、播放/暂停 —— 没有任何过渡,而且两套图标在同一界面上风格不一致。

## 决策

图标系统改为 morphicons + lucide 数据,遵循该库自身的契约:morphicons 是变形引擎、不附带图标,几何数据来自 lucide 的 `IconNode`(`import { Search } from 'lucide'`)。

内核在 `ui-primitives/src/icons/stroke.tsx`。`StrokeIcon` 把 `IconNode` 渲染为静态描边 SVG(stroke 为 `currentColor`、1.7 网格单位线宽、24×24 网格)。`MorphStrokeIcon` 包装 `morphicons/react` 的 `MorphIcon`,沿用同一描边契约 —— 用网格单位而非 `absoluteStrokeWidth`,变形图标与静态图标在任何尺寸下线宽一致 —— 并设 `reducedMotion="user"`:`icon` prop 一变,路径就从旧几何弹簧变形到新几何。70 个 `Icon*` 导出全部保留原名、`IconProps` 签名与默认尺寸,调用方零改动;fill 变体(Like/Dislike Fill、CloseFill)合并到对应的描边基字形。只有 `IconTreeCorner8x10` 保留自定义几何(树形拐角连线没有 lucide 对应物),仍是描边数据、仍可变形。五个 sci 包的 `icons.tsx` 改为委托 `StrokeIcon` + barrel 转出的 lucide 数据,不再重画路径。

13 处状态切换点从组件三元(或 InputBar 发送/停止的内联裸 SVG)改为单个 `MorphStrokeIcon` 翻转 `icon` prop:主题开关、三处文件夹树、四处 chevron 展开、两处复制→对勾反馈、目标栏的播放/暂停(两个条件块合并为一个按钮)、输入栏的发送↔停止。CSS 旋转类切换(三角展开符、工具卡 chevron)保持原样 —— 旋转本身已有动画,让 chevron 变形为自身没有收益。

## 验证

`icons.client.spec.tsx` 保持原有结构契约(70 个导出、逐字形默认尺寸、`currentColor`、无硬编码色值),并新增内核覆盖:`StrokeIcon` 的元素渲染与 undefined 属性丢弃、`MorphStrokeIcon` 在 `reducedMotion="always"` 下的几何切换与显式 spring。所有触及包的测试通过(`ui-primitives`、五个 sci 包、`ui-conversation`、`ui-settings-models`、`ui-workspace`、`ui-directory-picker-browse`、`ui-sci-files`、`ui-goal`、`ui-tool`、`ui-settings-general`,共 2261 个测试),另有 `typecheck:contracts-ready` 与 `lint:contracts-ready`。`web-card` 的几何同一性测试不受影响,因为 `web-row.tsx` 渲染的是共享组件而非几何副本。

## 备选方案

**把 fill 几何转成描边轮廓。** fill 绘制的字形没有诚实的描边等价物,且 morphicons 直接拒绝纯 fill 图标;换用 lucide 是受支持的路径。

**每个消费包直接依赖 lucide。** 同样的数据要多五条依赖边;barrel 集中转出 glyph 包装与 morph 站点用到的 23 个数据常量,只有 `ui-primitives` 依赖 `lucide` 和 `morphicons`。

**所有切换都走 morph,包括 CSS 旋转。** class 翻转的 chevron 旋转本就有动画;改走变形引擎等于用逐帧路径插值替换合成器变换,没有可见收益。

## 影响

全部图标现在是 1.7 网格单位线宽的描边风格;与旧 fill 字形的视觉差异是有意的、全站性的。新增图标 = 一行 lucide 映射包装;新的状态切换应翻转 `MorphStrokeIcon` 的 `icon` prop,而不是三元两个组件。品牌资产(`FishLogo`、`BrandWordmark`、`SciLogo`、`StateDot`)按设计不动。70 个导出名是数量测试的承载面;清理死导出(LikeFill/DislikeFill 无人使用)留给后续 hygiene。
