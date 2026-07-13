# AgentTask P0-P6 实施与迁移路线

## 1. 范围与不变量

本轮交付一个 `software_engineer` Bugfix Task 纵向切片。它扩展现有 CLI/server/desktop，不替换 Session、旧 CLI Task、Scheduled Task、工具、权限或终端。

贯穿 P0-P6 的不变量：

- `AgentTask` 是独立事实源；旧 CLI Task 不可写回 AgentTask。
- 唯一开关是 `CC_GUGU_AGENT_TASK_RUNTIME=1`，默认关闭。
- 关闭开关时仅 capability 查询可见，新 API、工具和桌面 UI 均不生效。
- 所有文件、命令和计算机操作继续走既有工具与权限链。
- JSONL 只记录任务与 Session 关联，不声称恢复工作区或被杀死的进程。
- Verification 是硬门；Review 是软门。
- Reasonix、Role Pack Runtime、长期 Memory、Model Gateway 重写和产品级 Multi-Agent 不在本轮范围。
- 回滚只关闭开关，不删除事件或 Evidence。

## 2. 阶段状态

| 阶段 | 状态 | 主要交付 |
| --- | --- | --- |
| P0 | 完成 | 现状审计、差距矩阵、目标契约、风险/评估基线、5 个 ADR |
| P1 | 完成 | 独立 AgentTask、状态机、Session 关联、Flag、服务/API |
| P2 | 完成 | Event、JSONL、replay、并发 revision、尾行修复、restart recovery |
| P3 | 完成 | 固定阶段编排、AgentTask tool、Stage Router 可选计划/复核、权限拒绝投影 |
| P4 | 完成 | Evidence Pack、必需检查硬门、失败证据、完成约束 |
| P5 | 完成 | Review 软门、状态条、Workbench Evidence、Session 隔离 |
| P6 | 完成 | refresh/focus/poll 重建、restart/interrupted、失败矩阵、黄金流程测试 |

阶段编号表示依赖顺序，不表示已经发布。当前仍由默认关闭的 Feature Flag 保护。

## 3. P1 - 独立 AgentTask

**实现文件**

- `src/agentTask/types.ts`
- `src/agentTask/stateMachine.ts`
- `src/agentTask/featureFlag.ts`
- `src/agentTask/service.ts`
- `src/server/api/agent-tasks.ts`
- `src/server/router.ts`

**实现结果**

- 使用独立 task/run/attempt/revision 标识，不复用旧三态 Task 的文件。
- 状态固定为 `intake -> scout -> plan -> execute -> verify -> review -> completed`。
- `blocked` 只回到记录的 `resumeStatus`；`interrupted` 显式创建新 run/attempt。
- 同一 Session 可有多个 AgentTask；桌面选择最新非终态任务。
- revision 冲突返回冲突错误，不允许两个旧快照同时推进。

**回滚**

关闭 Flag 后不创建任务、不注册 AgentTask 工具行为、不展示桌面投影；旧 Task 无需迁移。

## 4. P2 - Event、JSONL 与恢复

**实现文件**

- `src/agentTask/events/jsonlEventLog.ts`
- `src/agentTask/events/reducer.ts`
- `src/agentTask/service.ts`

**实现结果**

- 事件写入 `~/.claude/agent-tasks/<taskId>/events.jsonl`。
- 每个 task 的 sequence 从 1 单调递增，追加在文件锁内完成并同步到磁盘。
- eventId、sequence、schemaVersion、task/run/attempt 和 payload 在读取时校验。
- 最后一行 JSON 被截断时，读取忽略该行；下一次追加在锁内先修复尾行。
- 中间损坏、序号缺口、重复 eventId 或身份错配视为 corruption，不推断完成。
- 服务重启扫描活动任务并追加 `task_interrupted`；恢复必须由用户或 Agent 显式触发。

**恢复边界**

恢复事件、任务状态、attempt 与 Session 关联；不恢复文件、git 状态、子进程、锁或 AbortController。

## 5. P3 - 固定工作流与权限复用

**实现文件**

- `src/agentTask/orchestrator.ts`
- `src/tools/AgentTaskTool/AgentTaskTool.ts`
- `src/tools.ts`
- `desktop/src/stores/chatStore.ts`

**实现结果**

- `AgentTask` 工具仅在 Flag 开启时对模型可用。
- Agent 通过 create/begin/scout/plan/execution/verification/review 推进固定顺序。
- 计划和 Review 可显式复用现有 Stage Router；未开启时不隐式调用外部适配器。
- AgentTask 工具不读写项目文件、不启动命令；这些行为继续由原有工具承担。
- 现有权限批准流程不变；用户拒绝普通工具或 Computer Use 时，当前 Session 的 AgentTask 追加原因并转为 `blocked`。
- `blocked` 的继续按钮只恢复原阶段，不会补发或绕过被拒绝的工具调用。

## 6. P4 - Verification 与 Evidence Pack

**实现文件**

- `src/agentTask/evidence/evidenceStore.ts`
- `src/agentTask/completionPolicy.ts`
- `src/agentTask/service.ts`

**实现结果**

- Evidence 先写临时文件、同步并原子重命名，再追加 `evidence_persisted`。
- Evidence 绑定 taskId、runId、attempt、检查命令、退出码、输出、时间、改动文件和产物。
- 每个必需检查必须恰有一个结果，命令必须与任务声明一致。
- 只有 `status=passed` 且 `exitCode=0` 才通过；空必需检查集不能完成。
- 缺失、失败、超时、中断、重复或命令错配均不能进入 `completed`。
- 失败结果仍持久化 Evidence，便于诊断。
- `completed` 还要求 replay 后可见 Evidence 引用和 Review 结果/警告。

**当前信任边界**

P1-P6 不新增绕过权限的 verifier shell runner。Verification 结果来自既有 Shell/PowerShell 工具实际执行后，由 AgentTask tool 或受信本地 API 提交；服务校验声明命令、结果结构和完成不变量。Evidence 尚未与具体 `toolUseId` 做不可伪造绑定，这是后续增强点，不影响当前硬门的状态约束，但影响证据来源强度。

## 7. P5 - Review 与桌面投影

**实现文件**

- `src/agentTask/review/reviewPolicy.ts`
- `desktop/src/types/agentTask.ts`
- `desktop/src/api/agentTasks.ts`
- `desktop/src/stores/agentTaskStore.ts`
- `desktop/src/components/chat/AgentTaskStatusBar.tsx`
- `desktop/src/components/workbench/AgentTaskEvidenceView.tsx`
- `desktop/src/components/workbench/WorkbenchPanel.tsx`
- `desktop/src/pages/ActiveSession.tsx`

**实现结果**

- Review 的 passed/warning/unavailable 均为持久化结果；Review 不可覆盖失败检查。
- 状态条展示阶段、attempt、恢复/继续动作和 Evidence 入口。
- Evidence 作为现有 Workbench 的条件式第五个标签，不新增导航或桌面框架。
- Workbench 展示结构化检查、退出码、命令、错误输出、改动文件、产物和 Review。
- Flag 关闭或当前 Session 无 AgentTask 时，不显示状态条或 Evidence 标签。
- 旧 `SessionTaskBar` 保持原数据和清理语义。

## 8. P6 - Refresh、Reconnect 与故障矩阵

**实现结果**

- ActiveSession 初次挂载、窗口重新聚焦、visibility 恢复及 2 秒轮询都会从服务端重建 AgentTask。
- store 以 Session ID 隔离，详情只在 task revision 变化时重取。
- HTTP 临时失败记录在 store 中，并由后续轮询恢复。
- server restart 把活动任务转为 `interrupted`；显式 resume 产生新 runId 和 attempt。
- JSONL 尾行、并发 transition、权限拒绝、验证失败、Review unavailable、页面刷新和 Flag 关闭均有回归测试。
- REST 黄金测试覆盖 create 到 completed 的完整链路，并在 verify 前重建服务实例模拟页面刷新。

## 9. 放量与回滚

放量前必须完成：

1. 绑定真实 Bugfix 评估任务，记录 Flag off/on 基线。
2. 运行 root AgentTask/server/tool 测试。
3. 运行 desktop 相关 Vitest、`bun run lint`、production build。
4. 运行 `git diff --check`，确认 gateway 未被修改或纳入提交。
5. 按桌面发布规范准备 release notes、版本文件、签名更新包和 `latest.json`。

本轮不发布。出现数据完整性、权限或旧路径回归时，关闭 `CC_GUGU_AGENT_TASK_RUNTIME`，保留 JSONL/Evidence 诊断，不做破坏性清理。