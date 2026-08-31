/**
 * Stroke icon set for the dsh web UI. Geometry is lucide icon data rendered
 * through {@link StrokeIcon} (stroke="currentColor", fixed 1.7 stroke width);
 * every export keeps its former ic_ds_* name and default size so call sites
 * are unchanged. Icons that swap on state morph via {@link MorphStrokeIcon}.
 */
import {
  Archive,
  ArrowUpRight,
  Bot,
  Braces,
  Brain,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleQuestionMark,
  Code,
  Compass,
  Copy,
  Database,
  Download,
  Ellipsis,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Globe,
  Goal,
  Link,
  ListChecks,
  ListTodo,
  LoaderCircle,
  Maximize,
  Monitor,
  Moon,
  NotebookPen,
  PanelLeft,
  Paperclip,
  Pause,
  Pencil,
  Play,
  Plus,
  Puzzle,
  RefreshCw,
  ScanSearch,
  Search,
  Send,
  Settings,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Square,
  SquarePen,
  Sun,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  TriangleAlert,
  User,
  WandSparkles,
  X,
  Zap,
} from 'lucide'
import type { IconProps } from './props.ts'
import { StrokeIcon } from './stroke.tsx'

export type { IconProps } from './props.ts'
export { MorphStrokeIcon, StrokeIcon } from './stroke.tsx'
export type { MorphStrokeIconProps, StrokeIconProps } from './stroke.tsx'

/** Lucide icon data re-exported for the *Glyph wrappers and MorphStrokeIcon call sites. */
export {
  ArrowLeft, ArrowUp, Bookmark, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Compass, Copy, Database,
  Folder, FolderOpen, Moon, Pause, Play, Plus, Search, Send, Sparkles, Square, Sun, X,
} from 'lucide'

/** Custom stroke geometry with no lucide equivalent (tree elbow connector). */
const TREE_CORNER = [['path', { d: 'M9 3v8a5 5 0 0 0 5 5h7' }]] as const

/** ic_ds_new_chat_outline_16 */
export const IconNewChatOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={SquarePen} size={size} className={className} />
)

/** ic_ds_search_outline_16 */
export const IconSearchOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={Search} size={size} className={className} />
)

/** ic_ds_globe_outline_14 — meridian globe (harness-only figma extract). */
export const IconGlobeOutline14 = ({ size = 14, className }: IconProps) => (
  <StrokeIcon icon={Globe} size={size} className={className} />
)

/** ic_ds_settings_outline_14 */
export const IconSettingsOutline14 = ({ size = 14, className }: IconProps) => (
  <StrokeIcon icon={Settings} size={size} className={className} />
)

/** ic_ds_settings_outline_16 */
export const IconSettingsOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={Settings} size={size} className={className} />
)

/** ic_ds_panel_left_outline_16 */
export const IconPanelLeftOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={PanelLeft} size={size} className={className} />
)

/** ic_ds_ellipsis_outline_16 */
export const IconEllipsisOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={Ellipsis} size={size} className={className} />
)

/** ic_ds_plus_outline_16 */
export const IconPlusOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={Plus} size={size} className={className} />
)

/** ic_ds_check_outline_16 */
export const IconCheckOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={Check} size={size} className={className} />
)

/** ic_ds_check_outline_14 */
export const IconCheckOutline14 = ({ size = 14, className }: IconProps) => (
  <StrokeIcon icon={Check} size={size} className={className} />
)

/** ic_ds_branch_outline_16 */
export const IconBranchOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={GitBranch} size={size} className={className} />
)

/** ic_ds_chevron_down_outline_14 */
export const IconChevronDownOutline14 = ({ size = 14, className }: IconProps) => (
  <StrokeIcon icon={ChevronDown} size={size} className={className} />
)

/** ic_ds_chevron_left_outline_14 */
export const IconChevronLeftOutline14 = ({ size = 14, className }: IconProps) => (
  <StrokeIcon icon={ChevronLeft} size={size} className={className} />
)

/** ic_ds_chevron_right_outline_14 */
export const IconChevronRightOutline14 = ({ size = 14, className }: IconProps) => (
  <StrokeIcon icon={ChevronRight} size={size} className={className} />
)

/** ic_ds_triangle_right_fill_14 — tree expand arrow; points right, consumers rotate it 90° for the open state. */
export const IconTriangleRightFill14 = ({ size = 14, className }: IconProps) => (
  <StrokeIcon icon={Play} size={size} className={className} />
)

/** ic_ds_chevron_up_outline_14 */
export const IconChevronUpOutline14 = ({ size = 14, className }: IconProps) => (
  <StrokeIcon icon={ChevronUp} size={size} className={className} />
)

/** ic_ds_close_outline_16 */
export const IconCloseOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={X} size={size} className={className} />
)

/** ic_ds_close_fill_14 */
export const IconCloseFill14 = ({ size = 14, className }: IconProps) => (
  <StrokeIcon icon={X} size={size} className={className} />
)

/** ic_ds_copy_outline_16 */
export const IconCopyOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={Copy} size={size} className={className} />
)

/** ic_ds_refresh_outline_16 */
export const IconRefreshOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={RefreshCw} size={size} className={className} />
)

/** ic_ds_refresh_outline_14 */
export const IconRefreshOutline14 = ({ size = 14, className }: IconProps) => (
  <StrokeIcon icon={RefreshCw} size={size} className={className} />
)

/** ic_ds_like_outline_16 */
export const IconLikeOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={ThumbsUp} size={size} className={className} />
)

/** ic_ds_like_fill_16 */
export const IconLikeFill16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={ThumbsUp} size={size} className={className} />
)

/** ic_ds_dislike_outline_16 */
export const IconDislikeOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={ThumbsDown} size={size} className={className} />
)

/** ic_ds_dislike_fill_16 */
export const IconDislikeFill16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={ThumbsDown} size={size} className={className} />
)

/** ic_ds_share_outline_16 */
export const IconShareOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={Share2} size={size} className={className} />
)

/** ic_ds_edit_outline_16 */
export const IconEditOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={Pencil} size={size} className={className} />
)

/** ic_ds_think_outline_14 */
export const IconThinkOutline14 = ({ size = 14, className }: IconProps) => (
  <StrokeIcon icon={Brain} size={size} className={className} />
)

/** ic_ds_think_outline_16 */
export const IconThinkOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={Brain} size={size} className={className} />
)

/** ic_ds_agent_preset_outline_16 (figma extract): node interiors knock out to transparency via mask, so the glyph sits on any fill. */
export const IconAgentPresetOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={Bot} size={size} className={className} />
)

/** ic_ds_browse_outline_16 */
export const IconBrowseOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={Compass} size={size} className={className} />
)

/** ic_ds_link_outline_14 */
export const IconLinkOutline14 = ({ size = 14, className }: IconProps) => (
  <StrokeIcon icon={Link} size={size} className={className} />
)

/** ic_ds_link_outline_16 */
export const IconLinkOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={Link} size={size} className={className} />
)

/** ic_ds_right_up_outline_14 */
export const IconRightUpOutline14 = ({ size = 8, className }: IconProps) => (
  <StrokeIcon icon={ArrowUpRight} size={size} className={className} />
)

/** ic_ds_right_up_outline_16 */
export const IconRightUpOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={ArrowUpRight} size={size} className={className} />
)

/** ic_ds_enhance_outline_16 */
export const IconEnhanceOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={WandSparkles} size={size} className={className} />
)

/** ic_ds_trash_outline_16 */
export const IconTrashOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={Trash2} size={size} className={className} />
)

/** ic_ds_warning_outline_16 */
export const IconWarningOutline16 = ({ size = 14, className }: IconProps) => (
  <StrokeIcon icon={TriangleAlert} size={size} className={className} />
)

/** ic_ds_user_outline_16 */
export const IconUserOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={User} size={size} className={className} />
)

/** ic_ds_send_outline_16 */
export const IconSendOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={Send} size={size} className={className} />
)

/** ic_ds_stop_fill_16 */
export const IconStopFill16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={Square} size={size} className={className} />
)

/** ic_ds_paperclip_outline_16 */
export const IconPaperclipOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={Paperclip} size={size} className={className} />
)

/** ic_ds_loading_outline_16 */
export const IconLoadingOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={LoaderCircle} size={size} className={className} />
)

/** ic_ds_download_outline_16 */
export const IconDownloadOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={Download} size={size} className={className} />
)

/** ic_ds_play_outline_16 */
export const IconPlayOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={Play} size={size} className={className} />
)

/** ic_ds_pause_outline_16 */
export const IconPauseOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={Pause} size={size} className={className} />
)

/** ic_ds_fullscreen_outline_16 */
export const IconFullscreenOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={Maximize} size={size} className={className} />
)

/** ic_ds_code_outline_16 */
export const IconCodeOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={Code} size={size} className={className} />
)

/** ic_ds_cordis_plugin_outline_14 */
export const IconCordisPluginOutline14 = ({ size = 14, className }: IconProps) => (
  <StrokeIcon icon={Puzzle} size={size} className={className} />
)

/** ic_ds_api_outline (figma extract) */
export const IconApiOutline14 = ({ size = 14, className }: IconProps) => (
  <StrokeIcon icon={Braces} size={size} className={className} />
)

/** ic_ds_personalization_outline_16 (figma extract) */
export const IconPersonalizationOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={SlidersHorizontal} size={size} className={className} />
)

/** ic_ds_project_add_outline_16 (figma extract) */
export const IconProjectAddOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={FolderPlus} size={size} className={className} />
)

/**
 * folder_open_16, outline layer only: the duotone original above reads a rung
 * heavier than the …Outline16 family, so an icon-button row mixing them looks
 * mismatched — this is the same geometry without the 20%-opacity inner fill.
 */
export const IconFolderOpenOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={FolderOpen} size={size} className={className} />
)

/** folder_open_16 (figma extract): outline at full ink + 20%-opacity inner fill riding the same currentColor. */
export const IconFolderOpen16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={FolderOpen} size={size} className={className} />
)

/** folder_close_16 (figma extract) */
export const IconFolderClose16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={Folder} size={size} className={className} />
)

/** tree_corner_8x10 (figma extract; session-tree "L" connector, stroke geometry pre-expanded) */
export const IconTreeCorner8x10 = ({ size = 10, className }: IconProps) => (
  <StrokeIcon icon={TREE_CORNER} size={size} className={className} />
)

/** ic_ds_light_outline_16 */
export const IconLightOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={Sun} size={size} className={className} />
)

/** ic_ds_dark_outline_16 */
export const IconDarkOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={Moon} size={size} className={className} />
)

/** ic_ds_followsystem_outline_16 */
export const IconFollowsystemOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={Monitor} size={size} className={className} />
)

/** ic_ds_data_outline_16 */
export const IconDataOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={Database} size={size} className={className} />
)

/** ic_send_outline_14 (figma extract): thin-stroke upward send arrow. */
export const IconSendOutline14 = ({ size = 14, className }: IconProps) => (
  <StrokeIcon icon={Send} size={size} className={className} />
)

/** ic_queue_outline_14 (figma extract): open chat bubble with two queued lines. */
export const IconQueueOutline14 = ({ size = 14, className }: IconProps) => (
  <StrokeIcon icon={ListTodo} size={size} className={className} />
)

/** ic_checklist_outline_14 (figma extract): two rings + two list bars. */
export const IconChecklistOutline14 = ({ size = 14, className }: IconProps) => (
  <StrokeIcon icon={ListChecks} size={size} className={className} />
)

/** ic_ds_List_Pen_outline_16 */
export const IconListPenOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={NotebookPen} size={size} className={className} />
)

/** ic_ds_goal_outline_16 (goal strip leading glyph: dartboard with a landed arrow) */
export const IconGoalOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={Goal} size={size} className={className} />
)

/** sparkle_16 (Others tool-row leading glyph; hand-authored three-star
 *  approximation — the figma 43:31850 glyph is an SF Symbols "sparkles" text glyph,
 *  not extractable as vector data) */
export const IconSparkle16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={Sparkles} size={size} className={className} />
)

/** inspect_outline_12 (shared tool-row trajectory affordance glyph) */
export const IconInspectOutline12 = ({ size = 12, className }: IconProps) => (
  <StrokeIcon icon={ScanSearch} size={size} className={className} />
)

/** skill_outline_16 (skill tool-row glyph; document instructions + sparkle) */
export const IconSkillOutline16 = ({ size = 16, className }: IconProps) => (
  <StrokeIcon icon={Zap} size={size} className={className} />
)

/** ic_ds_question_outline_14 (figma extract): ring + question glyph. */
export const IconQuestionOutline14 = ({ size = 14, className }: IconProps) => (
  <StrokeIcon icon={CircleQuestionMark} size={size} className={className} />
)

/** ic_ds_archive_outline_20 (figma extract): lidded box + label slot. The export's
 *  0.11px stroke ring around the box contour is dropped — it restates the same
 *  contour in the same ink, which currentColor already carries. */
export const IconArchiveOutline20 = ({ size = 20, className }: IconProps) => (
  <StrokeIcon icon={Archive} size={size} className={className} />
)

