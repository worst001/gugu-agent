# AgentTask 风险登记册

## 1. 使用规则

- Owner 是负责关闭风险的职能角色，不代表唯一实施者。
- 状态仅使用 `Open`、`Mitigating`、`Closed`；只有满足关闭条件并附验证证据后才能标记 `Closed`。
- 触发信号应来自事件、日志、测试或用户可观察行为，不以模型自述为依据。
- feature flag 默认关闭。出现 P0/P1 数据完整性、权限或旧路径回归风险时，先关 flag，再保全 JSONL 和 Evidence Pack。

## 2. 风险表

| ID | 风险 | 触发信号 | 缓解措施 | Owner | 关闭条件 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| R01 | AgentTask 与旧 CLI Task 形成双写、双事实来源 | 同一 task 的状态或终态在两个模型中不一致；旧 CLI 写入改变 AgentTask | 强制 `AgentTask -> CLI Task` 单向投影；核心层禁止依赖旧 Task；增加契约测试 | Agent Runtime | 架构依赖测试和投影契约测试通过，故障注入下无反向写入 | Open |
| R02 | flag 关闭仍改变旧路径 | flag 关闭时出现新 API/UI、额外文件写入、状态或权限提示差异 | 默认关闭；入口处单点分流；建立关闭态差分回归 | Release | 关闭态 E2E 与基线请求、输出、持久化副作用一致 | Open |
| R03 | JSONL 尾行截断或部分写导致任务不可恢复 | 启动解析失败；最后事件缺失；日志在崩溃后无法继续追加 | 单 writer 串行追加；完整行提交；忽略并报告截断尾行；保留原文件 | Persistence | 截断、掉电模拟和 reopen 测试通过，完整前缀可全部 replay | Open |
| R04 | 重复、乱序或旧版本事件使状态倒退 | 序号回退、重复 Review、完成态回到运行态、未知版本被静默接受 | task 内单调序号；事件 ID 去重；reducer 拒绝非法转换；未知版本 fail closed | Persistence | 属性/表驱动测试覆盖重复、乱序和未知版本且无状态倒退 | Open |
| R05 | replay 结果依赖时间、网络或进程内状态 | 同一 JSONL 多次 replay 得到不同快照或哈希 | reducer 保持纯函数；时间、ID 和外部结果全部写入事件；对快照做稳定哈希 | Persistence | 固定事件集在独立进程和多次运行中得到相同快照哈希 | Open |
| R06 | 首版恢复能力被误解为工作区恢复 | restart 后任务显示继续运行，但文件、锁或子进程已丢失 | 非终态恢复为明确的中断状态；UI 标注需重新执行；文档固定不恢复工作区 | Product Runtime | restart E2E 不自动续跑，UI 和 API 均返回中断原因 | Open |
| R07 | 四阶段编排绕过现有工具权限 | 新代码出现独立 allowlist；被拒绝的工具在 execute 中成功 | 复用现有 tool registry、permission context 和审批结果；禁止权限复制 | Security | 权限契约测试覆盖 allow/ask/deny，安全审查确认单一判定入口 | Open |
| R08 | 阶段失败后继续执行或产生多个终态 | `scout`/`plan` 失败后仍有 execute 事件；同一阶段多个完成/失败事件 | 状态机短路；终态 compare-and-set；取消信号贯穿 runner | Agent Runtime | 并发取消与故障注入测试中每阶段最多一个终态且无后续阶段 | Open |
| R09 | 确定性验证被模型文本或 Review 绕过 | 测试失败但任务显示完成；Evidence Pack 无命令/退出码 | 完成状态只由 verifier 结果驱动；Review 仅在硬门之后；服务端校验转换 | Verification | 所有绕过测试失败关闭，失败/超时/空检查集均不可完成 | Open |
| R10 | 验证命令扩大执行面或造成破坏 | 自动安装依赖、执行未声明脚本、超时进程残留 | 仅运行仓库已有或任务声明命令；沿用权限边界；超时终止并记录 | Verification | 命令选择契约、安全测试和超时清理测试通过 | Open |
| R11 | Evidence Pack 泄露 token、路径或敏感输出 | 证据中出现凭据模式、完整环境变量、超量原始日志 | 持久化前脱敏；输出限长；环境变量 allowlist；保存摘要和哈希 | Security | 敏感样本测试无明文泄露，人工抽检通过 | Open |
| R12 | Evidence Pack 不足以复现判定 | 缺基线版本、命令、时间、退出码、变更清单或内容哈希 | schema 设置必填字段；缺项时硬门失败；schema 版本化 | Verification | 完整性测试覆盖每个必填字段，缺任一字段均无法通过 | Open |
| R13 | Review 软门变成第二个不可恢复硬门 | 无 reviewer 时任务永久等待；拒绝后无可执行状态 | Review 策略明确自动通过/人工确认；超时仅提醒；拒绝产生可重试状态 | Product | 自动与人工策略 E2E 通过，拒绝和无人处理均有明确后续动作 | Open |
| R14 | SessionTaskBar/Workbench 串 Session 或展示陈旧状态 | 切换 Session 后看到别的任务；refresh 后状态回退 | store 按 Session/task ID 归一化；先快照后增量；组件不保存事实状态 | Desktop | 多 Session、refresh 和快速切换测试无串数据或状态倒退 | Open |
| R15 | reconnect 造成事件丢失或重复应用 | 事件序号出现缺口；任务重复；同一 Review 操作执行两次 | 使用服务端游标；缺口时请求快照；按事件 ID 去重；操作带幂等键 | Desktop + Server | 断线窗口和重复投递 E2E 中最终快照与服务端一致 | Open |
| R16 | 事件日志无限增长拖慢启动 | replay 时间或日志大小持续越过预算；启动超时 | 先测量；本轮只设告警阈值和诊断。快照/压缩在数据证明需要后单独设计 | Persistence | 代表性上限数据下满足启动预算，或已有经验证的后续快照方案 | Open |
| R17 | 并发任务争用 writer 或覆盖 Session 关联 | 丢序号、跨 task 事件写错、关联被最后写覆盖 | 单 writer 队列；每 task 序号校验；关联创建后不可变更或显式事件化 | Persistence | 并发压力测试无丢失、重复序号或跨 task 污染 | Open |
| R18 | 新协议破坏旧桌面/服务端组合 | 旧客户端解析失败；新客户端在旧服务端持续报错 | 新字段可选；事件和 API 版本化；能力协商；flag 关闭时不发送新消息 | Server + Desktop | 新旧组合兼容矩阵通过，未知消息可忽略并记录 | Open |
| R19 | 指标采集本身改变行为或包含虚构结果 | 结果无法追溯到原始事件；手填时长/通过率；采集导致额外执行 | 指标仅从 runner、JSONL、测试退出码和 Evidence Pack 派生；原始数据只读归档 | Evaluation | 每个指标可追溯到 task/event ID，重算结果一致，无手填结果 | Open |
| R20 | 范围蔓延到本轮明确排除项 | PR 出现 Reasonix、Role Pack Runtime、长期 Memory、Model Gateway、产品 Multi-Agent 或工作区恢复代码 | 计划和 review checklist 明确非目标；拆分独立提案 | Tech Lead | P1-P6 合入内容不含排除项，相关需求均有独立决策记录 | Open |

## 3. 升级与处置

以下任一信号触发立即停止放量并关闭 flag：权限绕过、旧路径回归、事件日志覆盖/丢失、失败验证进入完成态、跨 Session 数据泄露。处置时保留原始 JSONL、服务日志和 Evidence Pack；不得用自动修复覆盖原始证据。

其余风险按 Owner 进入 `Mitigating`，在对应 P 的退出评审中提交触发信号、修复提交、测试命令和证据哈希。仅“未再次观察到”不能作为关闭条件。
