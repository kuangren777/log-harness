// The two `mcp__clawsgo__declare_workflow_plan` calls recorded verbatim in
// `ClawsGO-System/02-MCP/clawsgo-server.md` §3. They are the only observed
// real-world uses of the schema this package reproduces, so every suite that
// claims compatibility validates against these exact objects.
import type { PlanInput } from '@deepseek-ai/dsh-sci-plan'

/** The three-agent, edge-free call: repository review, environment check, safety review. */
export const ARCHIVED_SURVEY: PlanInput = {
  agents: [
    { id: 'repo-inspector', name: '仓库说明核查', icon: 'web', task: '核查 GitHub 仓库的安装方式、依赖和使用说明。' },
    { id: 'environment-checker', name: '本机环境检查', icon: 'search', task: '检查当前项目与可用工具，判断该连接器应安装到哪里。' },
    { id: 'safety-reviewer', name: '安装风险复核', icon: 'security', task: '审阅安装脚本与权限影响，识别需要避免的风险。' },
  ],
}

/**
 * The two-agent call with one edge: the verifier waits for the installer. Both
 * agents produce (`code` installs, `check` delivers) and nothing refutes, which
 * is the producer-only shape `validatePlan` now refuses; {@link AUDITED_INSTALL}
 * is the same call with the adversary the rule demands.
 */
export const ARCHIVED_INSTALL: PlanInput = {
  agents: [
    { icon: 'code', id: 'installer', name: '连接器安装', task: '在项目临时目录执行预检、获取并启动已获授权的客户端。' },
    { icon: 'check', id: 'verifier', name: '安装结果验证', task: '核对安装命令退出状态及项目内留下的可见安装记录。' },
  ],
  edges: [['installer', 'verifier']],
}

/** The archived install call as the composition rule accepts it: an adversary downstream of the installer. */
export const AUDITED_INSTALL: PlanInput = {
  agents: [
    ...ARCHIVED_INSTALL.agents,
    { icon: 'security', id: 'auditor', name: '安装结果证伪', task: '重跑安装命令并核对进程与文件痕迹，报出与安装报告不符之处。' },
  ],
  edges: [['installer', 'verifier'], ['installer', 'auditor']],
}
