/**
 * CaMeL Science alias-token layer: an Apple-style palette stacked over the
 * `--dsw-*` base sheets through `ctx.theme.overrideTokens`. Every entry
 * carries both modes so the layer never goes illegible on a scheme switch.
 */
import type { ThemeTokenOverrides } from '@deepseek-ai/dsh-client-ui-theme/client'

/** Layer identity passed to `overrideTokens`; names the origin in inspection. */
export const TOKEN_SOURCE = '@deepseek-ai/dsh-client-ui-brand-sci'

/**
 * Build one `{ light, dark }` pair.
 * @param light - value while the light base palette is active.
 * @param dark - value while the dark base palette is active.
 * @returns the pair in the override-layer shape.
 */
function pair(light: string, dark: string): { light: string; dark: string } {
  return { light, dark }
}

/** Alias-token overrides: neutral grounds, hairline borders, system accents. */
export const SCI_TOKENS: ThemeTokenOverrides = Object.freeze({
  // Grounds: near-black stack in dark, cool off-white ground with white cards in light.
  '--dsw-alias-bg-base': pair('#f5f5f7', '#000000'),
  '--dsw-alias-bg-layer-1': pair('#ffffff', '#0d0d10'),
  '--dsw-alias-bg-layer-2': pair('#ffffff', '#1c1c1e'),
  '--dsw-alias-bg-layer-3': pair('#ffffff', '#2c2c2e'),
  '--dsw-alias-bg-overlay': pair('#ffffff', '#2c2c2e'),
  '--dsw-alias-bg-module-platform': pair('#f5f5f7', '#1c1c1e'),
  '--dsw-alias-bg-multi-select': pair('#f5f5f7', '#1c1c1e'),
  '--dsw-alias-bg-skeleton': pair('rgba(0, 0, 0, 0.05)', 'rgba(255, 255, 255, 0.07)'),
  // Hairlines.
  '--dsw-alias-border-l1': pair('rgba(0, 0, 0, 0.06)', 'rgba(255, 255, 255, 0.06)'),
  '--dsw-alias-border-l2': pair('rgba(0, 0, 0, 0.1)', 'rgba(255, 255, 255, 0.1)'),
  '--dsw-alias-border-l2-darkmode-thin': pair('rgba(0, 0, 0, 0.1)', 'rgba(255, 255, 255, 0.08)'),
  '--dsw-alias-border-l3': pair('rgba(0, 0, 0, 0.14)', 'rgba(255, 255, 255, 0.14)'),
  '--dsw-alias-border-l4': pair('rgba(0, 0, 0, 0.2)', 'rgba(255, 255, 255, 0.2)'),
  // Brand: monochrome primary (white pill on dark, ink pill on light).
  '--dsw-alias-brand-primary': pair('#1d1d1f', '#f5f5f7'),
  '--dsw-alias-brand-primary-invert': pair('#1d1d1f', '#f5f5f7'),
  '--dsw-alias-brand-text': pair('#1d1d1f', '#f5f5f7'),
  '--dsw-alias-brand-primary-new-colorprimary-new-color': pair('#0071e3', '#0a84ff'),
  '--dsw-alias-button-primary-fill': pair('#1d1d1f', '#f5f5f7'),
  '--dsw-alias-button-primary-hover': pair('#000000', '#ffffff'),
  '--dsw-alias-button-primary-dimmed': pair('#e8e8ed', '#3a3a3c'),
  '--dsw-alias-button-info-fill': pair('#0071e3', '#0a84ff'),
  '--dsw-alias-button-info-hover': pair('#0077ed', '#409cff'),
  '--dsw-alias-button-elevated-fill': pair('#ffffff', '#1c1c1e'),
  '--dsw-alias-button-floating-fill': pair('#ffffff', '#1c1c1e'),
  '--dsw-alias-button-floating-hover': pair('#f5f5f7', '#2c2c2e'),
  '--dsw-alias-button-ghost-active-fill': pair('#e8e8ed', '#2c2c2e'),
  '--dsw-alias-button-ghost-active-hover': pair('#dcdce2', '#3a3a3c'),
  '--dsw-alias-button-ghost-active-border': pair('rgba(0, 0, 0, 0.2)', 'rgba(255, 255, 255, 0.2)'),
  // Interaction washes.
  '--dsw-alias-interactive-bg-hover': pair('rgba(0, 0, 0, 0.05)', 'rgba(255, 255, 255, 0.07)'),
  '--dsw-alias-interactive-bg-active': pair('rgba(0, 0, 0, 0.09)', 'rgba(255, 255, 255, 0.12)'),
  '--dsw-alias-interactive-bg-hover-accent': pair('rgba(0, 113, 227, 0.12)', 'rgba(10, 132, 255, 0.2)'),
  '--dsw-alias-interactive-bg-hover-solid': pair('#ebebf0', '#2c2c2e'),
  '--dsw-alias-interactive-bg-hover-danger': pair('rgba(255, 59, 48, 0.08)', 'rgba(255, 69, 58, 0.16)'),
  // Type.
  '--dsw-alias-label-primary': pair('#1d1d1f', '#f5f5f7'),
  '--dsw-alias-label-primary-dimmed': pair('#2c2c2e', '#e5e5ea'),
  '--dsw-alias-label-primary-bluish': pair('#0a3d91', '#e5e5ea'),
  '--dsw-alias-label-primary-foreground': pair('#ffffff', '#000000'),
  '--dsw-alias-label-primary-inverted': pair('#ffffff', '#1d1d1f'),
  '--dsw-alias-label-secondary': pair('#515154', '#a1a1a6'),
  '--dsw-alias-label-tertiary': pair('#86868b', '#86868b'),
  '--dsw-alias-label-caption': pair('#a1a1a6', '#6e6e73'),
  '--dsw-alias-label-dimmed': pair('#d2d2d7', '#3a3a3c'),
  // Markdown surfaces.
  '--dsw-alias-markdown-code-block': pair('#f5f5f7', '#141416'),
  '--dsw-alias-markdown-code-block-banner': pair('#ebebf0', '#1c1c1e'),
  '--dsw-alias-markdown-inline-code': pair('#e8e8ed', '#2c2c2e'),
  '--dsw-alias-markdown-citation': pair('#e8e8ed', '#2c2c2e'),
  '--dsw-alias-markdown-tag': pair('#ebebf0', '#2c2c2e'),
  '--dsw-alias-markdown-placeholder': pair('#f5f5f7', '#1c1c1e'),
  '--dsw-alias-markdown-code-segment-selected': pair('#ffffff', '#2c2c2e'),
  '--dsw-alias-markdown-code-segment-unselected': pair('#ebebf0', '#1c1c1e'),
  // System states (iOS semantic colours).
  '--dsw-alias-state-success-primary': pair('#34c759', '#30d158'),
  '--dsw-alias-state-success-secondary': pair('#30d158', '#4cd964'),
  '--dsw-alias-state-success-tertiary': pair('rgba(52, 199, 89, 0.14)', 'rgba(48, 209, 88, 0.18)'),
  '--dsw-alias-state-error-primary': pair('#ff3b30', '#ff453a'),
  '--dsw-alias-state-error-secondary': pair('#ff6961', '#ff6961'),
  '--dsw-alias-state-warn-primary': pair('#ff9f0a', '#ffd60a'),
  '--dsw-alias-state-warn-secondary': pair('#ffb340', '#ffe04b'),
  '--dsw-alias-state-warn-tertiary': pair('rgba(255, 159, 10, 0.14)', 'rgba(255, 214, 10, 0.16)'),
  '--dsw-alias-state-warn-label': pair('#c77700', '#ffd60a'),
  '--dsw-alias-state-business-primary': pair('#0071e3', '#0a84ff'),
  '--dsw-alias-state-business-tertiary': pair('rgba(0, 113, 227, 0.12)', 'rgba(10, 132, 255, 0.18)'),
  // Floating surfaces.
  '--dsw-alias-toast-bg': pair('#1d1d1f', '#2c2c2e'),
  '--dsw-alias-tooltip-bg': pair('#1d1d1f', '#3a3a3c'),
  '--dsw-alias-scrollbar-bg-l1': pair('rgba(0, 0, 0, 0.16)', 'rgba(255, 255, 255, 0.16)'),
  '--dsw-alias-scrollbar-bg-l2': pair('rgba(0, 0, 0, 0.16)', 'rgba(255, 255, 255, 0.16)'),
  '--dsw-alias-scrollbar-hover-l1': pair('rgba(0, 0, 0, 0.28)', 'rgba(255, 255, 255, 0.28)'),
  '--dsw-alias-scrollbar-hover-l2': pair('rgba(0, 0, 0, 0.28)', 'rgba(255, 255, 255, 0.28)'),
  // Product-specific surfaces.
  '--dsw-specific-sidebar-fill': pair('#f5f5f7', '#0d0d10'),
  '--dsw-specific-sidebar-nav-item-hover': pair('#ebebf0', '#1c1c1e'),
  '--dsw-specific-sidebar-nav-item-active': pair('#e3e3e8', '#2c2c2e'),
  '--dsw-specific-sidebar-nav-item-active-accent': pair('rgba(0, 113, 227, 0.14)', 'rgba(10, 132, 255, 0.2)'),
  '--dsw-specific-bubble': pair('#e9e9ee', '#1c1c1e'),
  '--dsw-specific-bubble-highlight': pair('#dcdce2', '#2c2c2e'),
  '--dsw-specific-input-major': pair('#ffffff', '#1c1c1e'),
  '--dsw-specific-login-input': pair('#f5f5f7', '#1c1c1e'),
  '--dsw-specific-selector': pair('#f5f5f7', '#1c1c1e'),
  '--dsw-specific-tip': pair('#f5f5f7', '#2c2c2e'),
  // Workbench surfaces: the sci shell's glass, cards, chips, and accents.
  // Scheme-invariant values repeat so the layer stays legible either way.
  '--dsw-sci-accent-a': pair('#0a68ff', '#0a68ff'),
  '--dsw-sci-accent-b': pair('#7a3cff', '#7a3cff'),
  '--dsw-sci-glass-bg': pair('rgba(251, 251, 253, 0.85)', 'rgba(16, 16, 24, 0.75)'),
  '--dsw-sci-glass-border': pair('rgba(0, 0, 0, 0.12)', 'rgba(255, 255, 255, 0.14)'),
  '--dsw-sci-card-bg': pair('#ffffff', 'rgba(255, 255, 255, 0.03)'),
  '--dsw-sci-chip-bg': pair('rgba(0, 0, 0, 0.04)', 'rgba(255, 255, 255, 0.04)'),
  '--dsw-sci-hover-bg': pair('rgba(0, 0, 0, 0.06)', 'rgba(255, 255, 255, 0.08)'),
  '--dsw-sci-user-bubble-bg': pair('#ffffff', 'rgba(255, 255, 255, 0.06)'),
  '--dsw-sci-aurora-opacity': pair('0.12', '0.3'),
  '--dsw-sci-radius-card': pair('16px', '16px'),
  '--dsw-sci-radius-pill': pair('980px', '980px'),
})
