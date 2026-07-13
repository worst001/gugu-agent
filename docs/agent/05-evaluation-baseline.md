# AgentTask Evaluation Baseline

## 1. 目的

本基线定义可复现的 Bugfix 黄金任务、指标公式和采集方式，用于比较旧路径与 flag 开启后的 AgentTask 路径。本文不记录任何尚未实际运行的分数、耗时、token 或成功率。

评估对象是单 AgentTask 的 `intake -> scout -> plan -> execute -> verification -> review` 流程。Reasonix、Role Pack Runtime、长期 Memory、Model Gateway、产品级 Multi-Agent 和工作区恢复不参与本轮评估。

## 2. 黄金任务集选择规则

首个任务集固定为 **8 条**，落在允许的 5-10 条范围内。每条任务必须满足全部规则后才能进入黄金集：

1. 来自仓库中已确认的真实 Bug 或已合入修复，不能由评估者临时编造。
2. 固定 `base_commit`，该提交可安装、可构建，且在支持的平台上能稳定复现失败。
3. 提供一条无需网络和人工输入的 `repro_command`；连续 3 次在基线提交上得到相同失败信号。
4. 提供独立的 `verify_command`；正确补丁连续 3 次通过，回退补丁后连续 3 次失败。
5. 任务描述只包含用户可见症状、范围和约束，不泄露修复提交、目标文件或隐藏断言。
6. 单条任务应能在 30 分钟评估预算内完成，不要求外部账号、真实凭据、付费 API 或专用硬件。
7. 修复范围为 1-5 个生产文件；生成文件、锁文件和纯格式改动不计入生产文件数。
8. 至少一个断言验证行为而非字符串或快照外观；隐藏检查不得要求参考补丁的具体实现。
9. 任务之间不得共享同一根因或依赖前一任务留下的工作区状态；每次从独立干净工作区开始。
10. 任务入选后冻结描述、基线提交、命令、预算和隐藏测试；任何变更都提升 `task_version` 并重新跑两条路径。

## 3. 八类任务配额

以下是选择配额，不是虚构的已完成任务。每个槽位必须由满足第 2 节规则的真实历史 Bug 填充。

| ID | 类别 | 必须覆盖的故障形态 | 入选附加条件 |
| --- | --- | --- | --- |
| G01 | 纯逻辑边界 | 空值、边界值或非法状态转换 | 有快速单元测试，参考修复不超过 2 个生产文件 |
| G02 | 解析/序列化 | 合法输入误解析或畸形输入未拒绝 | fixture 固定，断言结构化结果或明确错误 |
| G03 | 持久化 | 写入、读取或 reopen 后状态不一致 | 使用临时目录，不依赖用户数据目录 |
| G04 | 事件/并发 | 重复、乱序、竞态或幂等性错误 | 至少 20 次受控重复无随机失败；禁止用 sleep 作为唯一同步 |
| G05 | 进程/恢复 | restart、取消或失败清理错误 | runner 可自动启动和结束子进程，无残留进程 |
| G06 | API/协议 | 请求校验、错误码或兼容字段错误 | 使用本地 server/fixture，不访问公网 |
| G07 | 桌面状态/UI | store 投影、Session 切换或交互状态错误 | Vitest/jsdom 可复现，断言用户可观察行为 |
| G08 | 权限/安全边界 | 被拒绝操作误放行或敏感数据外泄 | 只使用假凭据和沙箱路径；正确结果必须 fail closed |

若某类别没有满足规则的真实 Bug，不得用合成任务补位。该槽位保持 `unfilled`，基线报告同时给出有效样本数；在补齐前不得把不同样本数的总成功率直接比较。

## 4. 黄金任务清单格式

任务事实保存在版本化 manifest 中；本文只定义 schema。每条记录至少包含：

```yaml
id: G01
task_version: 1
status: unfilled
source_issue: null
base_commit: null
fix_commit: null
prompt_file: null
repro_command: null
verify_command: null
hidden_checks: []
supported_platforms: []
timeout_seconds: 1800
max_attempts: 1
expected_failure_signature: null
```

`status: ready` 前，所有 `null` 字段必须由可追溯的仓库事实填充。`fix_commit` 仅供评估维护者验证任务，不提供给被评路径。

## 5. 运行协议

每个 `{task, path}` 组合按以下协议运行：

1. checkout 固定的 `base_commit`，创建新的隔离工作区并确认 `git status --short` 为空。
2. 安装 manifest 声明的锁定依赖；依赖缓存可复用，但运行期间禁止联网。
3. 连续运行一次 `repro_command`，确认失败签名与 manifest 一致；不一致则记为 `invalid_run`，不计入成功率。
4. 使用冻结的任务描述启动一次任务。旧路径与新路径使用相同模型配置、权限、环境、超时和输入。
5. 任务结束后运行唯一的 `verify_command` 和隐藏检查。评估 runner 判定结果，模型自述不参与判定。
6. 保存事件 JSONL、runner 时间戳、工具调用记录、最终 diff、测试原始输出及 Evidence Pack。
7. 清理整个隔离工作区。下一次运行不得继承文件、进程、Session、事件或模型上下文。

对随机性做比较时，每条路径至少使用相同的预先登记 seed 集合运行 3 次；不支持 seed 的模型仍运行 3 次，并记录实际模型标识和服务端参数。发布门使用冻结后的完整样本，不挑选最好一次。

## 6. 判定状态

每次运行只允许一个主状态：

- `success`：所有必需验证和隐藏检查通过，且无范围外生产文件修改。
- `failed_verification`：任务结束但至少一个必需检查失败、超时或缺失。
- `agent_error`：任务在进入验证前因编排、工具或模型错误终止。
- `timeout`：超过预登记墙钟预算。
- `invalid_run`：基线无法复现、环境损坏或采集缺失；不进入效果指标分母，但必须单独报告。

Review 是软门，不改变确定性成功判定。人工 reviewer 可记录质量标签，但不能把 `failed_verification` 改为 `success`。

## 7. 核心指标与公式

令 `V` 为有效运行集合，即排除 `invalid_run`；`N = |V|`。令 `S` 为 `success` 集合。

| 指标 | 公式 | 说明 |
| --- | --- | --- |
| Task Success Rate | `TSR = |S| / N` | 必须同时报告 `|S|/N`，避免小样本百分比误导 |
| First-pass Success Rate | `FPSR = 首次验证即全部通过的运行数 / N` | 中途自测不算最终验证；硬门第一次执行为 first pass |
| Regression-free Rate | `RFR = 无隐藏回归且必需检查通过的运行数 / N` | 范围外回归计为失败 |
| Scope Compliance Rate | `SCR = 未修改允许范围外生产文件的运行数 / N` | 允许范围由任务 manifest 冻结 |
| Evidence Completeness | `ECR = 必填证据字段完整且哈希可校验的运行数 / N` | 缺任一必填字段即不完整 |
| Recovery Correctness | `RCR = 恢复后快照与事件 oracle 一致的注入场景数 / 有效恢复场景数` | 仅用于含 restart/reconnect 注入的任务 |
| Median Time to Verified | `median(t_hard_gate_pass - t_task_start), run in S` | 只对成功运行统计，同时报告 p90 和样本数 |
| Median Tool Calls | `median(tool_call_count), run in V` | 工具重试每次都计数 |
| Token per Success | `sum(input_tokens + output_tokens over V) / |S|` | `|S| = 0` 时报告 `undefined`，不得写 0 |
| Intervention Rate | `IR = 需要非预登记人工输入的运行数 / N` | 预登记的权限确认不算额外干预 |

比较新旧路径时，同时报告绝对差和相对差：

```text
absolute_delta(metric) = metric_new - metric_old
relative_delta(metric) = (metric_new - metric_old) / metric_old
```

当 `metric_old = 0` 时，相对差报告 `undefined`。比例指标附 Wilson 95% 区间；耗时、token 和工具调用同时报告中位数、p90、样本数，不只报告均值。

## 8. 事件级完整性指标

为验证 P2/P6，runner 从 JSONL 独立重算以下指标：

```text
event_gap_count = sum(max(0, seq_i - seq_(i-1) - 1)) per task
duplicate_event_rate = duplicate_event_ids / observed_event_count
terminal_state_violations = count(tasks with zero or more than one effective terminal state)
replay_mismatch_rate = mismatched_replayed_snapshots / replayed_tasks
session_link_error_rate = incorrectly linked tasks / recovered_tasks
```

除 `duplicate_event_rate` 可记录传输层重复外，reducer 应保证重复事件不改变最终快照。任何 gap、终态违规、replay mismatch 或 Session 误关联均单独列出，不能被总体成功率掩盖。

## 9. 采集来源

| 数据 | 唯一采集来源 | 采集方式 |
| --- | --- | --- |
| 状态与阶段 | AgentTask Event JSONL | 按 task ID、事件 ID、seq 读取；保留原文件哈希 |
| 开始/结束/硬门时间 | runner 单调时钟 + 对应事件 | 墙钟用于展示，耗时用单调时钟计算 |
| 验证结果 | verifier 退出码和原始输出 | 原始输出归档，报告存脱敏摘要与哈希 |
| 文件范围 | `git diff --name-only` 与最终 patch | 相对 `base_commit` 采集；生成文件按 manifest 分类 |
| 工具调用 | 工具调用事件 | 每个实际调用计一次，按工具名聚合 |
| token | 模型响应 usage 字段 | 缺失时标记 `missing`，不得估算为 0 |
| Review | Review 事件 | 与硬门结果分开存储和报告 |
| 恢复正确性 | JSONL replay 快照与测试 oracle | restart/reconnect 前后分别哈希并比较 |
| 环境 | runner manifest | 记录 commit、OS、runtime、依赖锁哈希、模型标识、flag 和 seed |

采集器只读取执行产物，不根据自然语言总结补字段。敏感值在归档前脱敏；原始日志、patch、manifest 和 Evidence Pack 使用内容哈希互相引用。

## 10. 报告模板

未运行前所有结果保持空值，不使用示例数字：

| Path | Valid / Invalid | TSR | FPSR | RFR | SCR | ECR | Median TTV | p90 TTV | Token / Success | IR |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 旧路径 | `未测量` | `未测量` | `未测量` | `未测量` | `未测量` | `未测量` | `未测量` | `未测量` | `未测量` | `未测量` |
| AgentTask flag on | `未测量` | `未测量` | `未测量` | `未测量` | `未测量` | `未测量` | `未测量` | `未测量` | `未测量` | `未测量` |
| Absolute delta | `n/a` | `未测量` | `未测量` | `未测量` | `未测量` | `未测量` | `未测量` | `未测量` | `未测量` | `未测量` |

报告必须附 8 个任务槽位的 `ready/unfilled` 状态、每个任务的逐次运行结果、invalid 原因、事件完整性指标和原始产物索引。未达到相同有效样本数时，只报告逐任务配对结果，不给出聚合优劣结论。

## 11. 当前 known gaps

- 8 个槽位尚未绑定真实 issue、提交和复现命令，因此当前只定义方法，不产生基线结果。
- 性能预算和放量阈值需在首轮有效数据后登记；在此之前不设置推测性目标。
- 第一版恢复评估只覆盖任务、事件和 Session 关联，不覆盖工作区恢复。
