# Compound Engineering 斜杠命令（`/ce-*`）速查

本文档说明本项目通过 **Compound Engineering** 插件挂载的 Skills（斜杠命令）。这些命令对应 `.claude/skills/` 下指向 `third-party/compound-engineering-plugin/plugins/compound-engineering/skills/` 的符号链接。

> **注意**：没有单独的 `/ce` 命令；均以 `/ce-…` 前缀区分功能，另有 `/lfg` 表示端到端流水线。  
> 若在 TUI 中看不到命令，请确认符号链接存在，并重启 `./bin/cc-gugu`。

---

## 规划 / 需求 / 文档

| 命令 | 大致用途 |
|------|----------|
| `/ce-brainstorm` | 协作澄清需求与范围，并写出体量合适的说明文档 |
| `/ce-ideate` | 围绕主题产生有依据的点子并做批判性筛选 |
| `/ce-plan` | 多步任务的结构化计划；也可对已有计划做「加深」式审阅 |
| `/ce-strategy` | 维护 `STRATEGY.md`（问题、方案、用户、指标、工作线等） |
| `/ce-doc-review` | 多角色视角审阅需求/计划类 Markdown |

---

## 写代码 / 改代码 / 排错

| 命令 | 大致用途 |
|------|----------|
| `/ce-work` | 按任务高效落地实现，兼顾质量与收尾 |
| `/ce-work-beta` | 与 `ce-work` 类似，含实验性 Codex 委派等（BETA） |
| `/ce-worktree` | 创建 git worktree，并行开发或 PR 评审时不污染当前工作区 |
| `/ce-debug` | 系统排错：根因、测试失败、issue 复现、堆栈等 |
| `/ce-simplify-code` | 在保持行为不变前提下简化、提炼近期改动代码 |
| `/ce-code-review` | 结构化 Code Review（多 persona、置信度、合并去重） |
| `/ce-resolve-pr-feedback` | 处理 PR Review 评论：判断合理性并并行修复 |

---

## Git / 提交 / PR

| 命令 | 大致用途 |
|------|----------|
| `/ce-commit` | 撰写清晰、符合习惯的 commit message 并提交 |
| `/ce-commit-push-pr` | 提交、推送、开 PR；也可仅生成 PR 描述 |
| `/ce-clean-gone-branches` | 清理远端已删除对应的本地跟踪分支及关联 worktree |

---

## 前端 / 设计 / 专项栈

| 命令 | 大致用途 |
|------|----------|
| `/ce-frontend-design` | 有设计质量的 Web 界面（组件、后台、落地页等） |
| `/ce-dhh-rails-style` | DHH / 37signals 风格的 Ruby on Rails |
| `/ce-gemini-imagegen` | 基于 Gemini 的文生图、改图等（见技能正文中的 API 说明） |

---

## 测试 / 演示 / 质量

| 命令 | 大致用途 |
|------|----------|
| `/ce-test-browser` | 针对当前 PR/分支影响页面做浏览器侧测试 |
| `/ce-test-xcode` | 使用 XcodeBuildMCP 在模拟器构建、测试 iOS |
| `/ce-demo-reel` | 为 PR 准备 GIF / 录屏 / 截图等演示材料 |
| `/ce-polish-beta` | BETA：起 dev server、浏览器中联调迭代 |
| `/ce-optimize` | 指标驱动的优化循环（实验、打分、收敛） |

---

## Agent / 架构

| 命令 | 大致用途 |
|------|----------|
| `/ce-agent-native-architecture` | Agent 优先的系统设计（MCP、编排、自迭代等） |
| `/ce-agent-native-audit` | Agent-Native 架构评审与原则打分 |

---

## 知识沉淀 / 对内信息

| 命令 | 大致用途 |
|------|----------|
| `/ce-compound` | 把已解决问题沉淀为团队可复用文档 |
| `/ce-compound-refresh` | 刷新 `docs/solutions/` 下过时或重复的学习文档 |
| `/ce-slack-research` | Slack 检索并综合决策与讨论脉络 |
| `/ce-product-pulse` | 按时间窗口输出产品脉搏类报告（需本地配置） |
| `/ce-riffrec-feedback-analysis` | Riffrec 反馈包（zip、session 等）的分析工作流 |

---

## 协作 / 历史会话

| 命令 | 大致用途 |
|------|----------|
| `/ce-proof` | 通过 Proof 做人机协同审阅 Markdown |
| `/ce-sessions` | 跨 Claude Code / Codex / Cursor 检索与问答历史会话 |

---

## 插件运维

| 命令 | 大致用途 |
|------|----------|
| `/ce-setup` | 检查 compound-engineering 环境与仓库配置 |
| `/ce-update` | 检查插件版本并给出更新命令 |
| `/ce-release-notes` | 查看插件近期发布说明或按版本查变更 |
| `/ce-report-bug` | 向 compound-engineering 插件上报问题 |

---

## 一键端到端流水线

| 命令 | 大致用途 |
|------|----------|
| `/lfg` | 规划→实现→评审→测试→提交→推送→PR→盯 CI→修至通过；**仅**在用户明确要求放手自动化且给出功能描述时使用 |

---

## 维护说明

- 插件源码路径：`.claude/skills/third-party/compound-engineering-plugin/`
- 本项目 Skills 加载规则：仅识别 **`.claude/skills/<名称>/SKILL.md`**（一级子目录），因此需在 `.claude/skills/` 下为各技能目录建立指向插件内 `plugins/compound-engineering/skills/<名称>` 的符号链接。
- 更新插件或重新克隆仓库后，若链接丢失，需重新创建符号链接并重启 CLI。

详细行为以各技能目录内 `SKILL.md` 正文为准。
