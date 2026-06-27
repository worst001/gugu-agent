# Gugu 场景能力图谱 Phase Plan

更新时间：2026-06-25

关联需求文档：

- `docs/plans/gugu-scenario-capability-graph-product-definition.md`
- `docs/plans/gugu-context-router-requirements.md`
- `docs/plans/gugu-context-router-phase-plan.md`

## 总体策略

这条线不做用户可见的“知识图谱”页面，也不开放“项目资料 / Profile”设置栏。

目标是让 Gugu 在用户自然提问时，自动识别任务场景，选择合适的模型、Skill、MCP、工具和检查清单，并在活动面板里用人话解释当前在做什么。

建议拆成 **6 个 Phase：P0-P5**。

- **P0-P2**：发布前必须稳定，解决泄漏、串上下文、错误路由。
- **P3-P4**：体验增强，让用户感受到 Gugu 更懂场景。
- **P5**：回归、发布门槛和后续扩展，不引入重存储。

## P0：收口当前实现与发布保护

预计：0.5-1 天

### 目标

把当前已经做出来的 Context Router / 场景能力图谱能力收口成“可发内测”的状态，避免把未成熟的 Profile UI 暴露给用户。

### 改动点

- 默认隐藏 `Project Profile / 资料` 设置入口。
- 旧 deep link 或内部 pending tab 访问 `projectProfile` 时，回退到 `General`。
- 保留底层任务路由代码，但不宣传“知识图谱”。
- 明确 claude-mem 默认关闭，不作为默认跨会话记忆。
- 检查用户气泡、会话标题、聊天历史、复制内容中不出现内部 scaffold。

### 重点文件

- `desktop/src/pages/Settings.tsx`
- `desktop/src/__tests__/generalSettings.test.tsx`
- `desktop/src/stores/chatStore.ts`
- `desktop/src/utils/sessionTitle.ts`
- `docs/plans/gugu-scenario-capability-graph-product-definition.md`

### 验收

- 设置页没有“资料 / Profile”入口。
- 通过旧入口跳转不会打开隐藏页。
- 用户消息不出现 `[Office toolbox: ...]`、`<attachment_parse_results>`、Context Router scaffold。
- 会话标题不被内部 scaffold 污染。

### 测试

```bash
cd desktop
bun run test -- src/__tests__/generalSettings.test.tsx src/stores/chatStore.test.ts src/utils/sessionTitle.test.ts
bun run lint
```

## P1：任务识别内核稳定化

预计：1-2 天

### 目标

让 Gugu 能稳定识别用户当前任务属于什么场景，不靠用户手动选择“知识图谱”。

### 改动点

- 完善任务类型枚举：
  - 普通对话
  - 编码 / Bug 修复
  - 文档总结
  - 表格分析
  - PPT 制作
  - 邮件草稿
  - 文件处理
  - 品牌内容
  - 社媒文案
  - 报告写作
  - 网页调研
  - Computer Use
- 统一输入信号：
  - 用户文本
  - 工具箱选择
  - 附件类型
  - 当前项目目录
  - 明确输出格式，例如“做成 PPT / PDF / Excel”
- 用户显式选择优先于自动识别。
- 识别失败时回退普通对话，不阻塞。

### 重点文件

- `desktop/src/constants/taskContextGraph.ts`
- `desktop/src/components/chat/ChatInput.tsx`
- `desktop/src/components/chat/ChatInputSubmit.test.tsx`

### 验收

- “写个小红书文案”能识别为品牌内容 / 社媒文案。
- “帮我做 PPT”能识别为 PPT 制作。
- 上传 xlsx 并说“分析一下”能识别为表格分析。
- “看下这个报错”能识别为编码 / Bug 修复。
- 未命中时不会强行走奇怪能力。

### 测试

```bash
cd desktop
bun run test -- src/constants/taskContextGraph.test.ts src/components/chat/ChatInputSubmit.test.tsx
```

## P2：模型、Skill、MCP、工具路由

预计：2 天

### 目标

把“识别到任务”转成可执行策略：该用什么模型、Skill、MCP 和工具，并且不可用时能自然回退。

### 改动点

- 模型建议：
  - 简单短任务可以建议轻量模型，但不要过度自动降级。
  - 编码、长文案、PPT、复杂推理、支付/文件写入等高风险任务走强模型。
  - 视觉、图片、PDF/Office 理解走视觉或文件解析链路。
- Skill 路由：
  - PPT：`ppt-master`
  - Word：`word-master`
  - PDF：`pdf-master`
  - Excel：`excel-master` / `spreadsheet-master`
  - 文件整理：`local-office-files` / `file-master`
  - 邮件：`mail-master`
  - 办公总入口：`office-suite`
- MCP 路由：
  - 编码结构理解优先 CodeGraph。
  - claude-mem 不默认作为跨会话记忆，只能作为显式增强或后续可选能力。
- 工具不可用时显示回退原因，不让用户安装宿主命令才能进入基础流程。

### 重点文件

- `desktop/src/constants/taskContextGraph.ts`
- `.agents/skills/office-suite/SKILL.md`
- `.agents/skills/*-master/SKILL.md`
- `desktop/src/stores/chatStore.ts`

### 验收

- 选择“做 PPT”或用户明确说“做 PPT”时，优先走 `ppt-master`。
- 用户明确要求输出某格式时，格式优先于自动判断。
- CodeGraph 不可用时，编码任务仍能继续普通检索。
- 不因自动路由把用户选择的模型强行覆盖成弱模型。

### 测试

```bash
cd desktop
bun run test -- src/constants/taskContextGraph.test.ts src/stores/chatStore.test.ts
```

## P3：活动面板解释与用户信任

预计：2 天

### 目标

让用户知道 Gugu 正在做什么，但不看到内部 prompt、scaffold 或工程术语。

### 改动点

- 在活动面板展示短状态：
  - 正在识别任务类型
  - 已识别：品牌内容 / 小红书文案
  - 准备使用：PPT 制作能力
  - CodeGraph 不可用，改用普通代码检索
  - 正在解析附件
  - 正在等待权限确认
- 长任务超过阈值时给阶段性提示。
- “模型长时间无响应 / 从这里继续”失败时只展示中文恢复建议，不暴露内部错误。
- 权限等待要明确是哪个工具在等用户确认。

### 重点文件

- `desktop/src/components/chat/*Activity*`
- `desktop/src/components/chat/MessageList.tsx`
- `desktop/src/stores/chatStore.ts`
- `desktop/src/i18n/locales/zh.ts`
- `desktop/src/i18n/locales/en.ts`

### 验收

- 用户不会长时间只看到“思考中”。
- Bash、Write、WebFetch、Skill、附件解析、MCP、模型长时间无响应都有清晰阶段提示。
- 不展示内部错误堆栈和上游英文错误。

### 测试

```bash
cd desktop
bun run test -- src/components/chat/MessageList.test.tsx src/stores/chatStore.test.ts
```

## P4：场景模板与检查清单

预计：2-3 天

### 目标

让 Gugu 的输出更像具体岗位/行业的交付物，而不是通用聊天答案。

### 改动点

- 增加内置场景模板：
  - 品牌内容
  - 小红书 / 抖音 / Bilibili / 公众号文案
  - PPT 制作
  - 表格分析
  - 日报 / 周报
  - 邮件草稿
  - 代码修复
- 每个模板只注入轻量检查清单，不引入大段知识。
- 模板不作为表单暴露，不要求用户先填写资料。
- 可以在工具箱 tips 和新手任务里体现“适合做什么”。

### 重点文件

- `desktop/src/constants/taskContextGraph.ts`
- `desktop/src/components/chat/officeTools.ts`
- `desktop/src/pages/EmptySession.tsx`
- `.agents/skills/office-suite/SKILL.md`

### 验收

- 品牌内容输出包含平台风格、用户痛点、可信理由、行动建议。
- PPT 输出先有结构，再进入制作。
- 表格分析先看字段和异常，再给结论。
- 邮件只生成草稿，不自动发送。

### 测试

```bash
cd desktop
bun run test -- src/constants/taskContextGraph.test.ts src/components/chat/ChatInputSubmit.test.tsx
```

## P5：发布验收与稳定性护栏

预计：1-2 天

### 目标

把这条能力纳入发布前必测，避免再次出现隐藏 prompt 泄漏、串会话、标题污染、路由误伤等问题。

### 改动点

- 增加发布 smoke checklist：
  - 新会话普通聊天
  - 工具箱任务
  - PPT
  - 表格
  - 编码
  - 文件处理
  - 多 session 切换
  - Rewind / Fork
  - 隐藏 scaffold 检查
- 增加回归测试：
  - 用户消息干净
  - 标题干净
  - displayContent / wireContent 分离
  - pending hidden settings tab 回退
- 文档更新：
  - 不宣传知识图谱。
  - 不开放项目资料。
  - 宣传“按任务自动选择能力”。

### 重点文件

- `docs/plans/desktop-release-packaging-runbook.md`
- `docs/plans/gugu-scenario-capability-graph-product-definition.md`
- `docs/plans/gugu-scenario-capability-graph-phase-plan.md`
- `desktop/src/stores/chatStore.test.ts`
- `desktop/src/utils/sessionTitle.test.ts`

### 验收

- 发布前 smoke 可以人工完整跑通。
- 自动测试覆盖主要泄漏风险。
- 打包文档明确这不是知识图谱 UI。
- 新用户不需要理解“资料”“图谱”“MCP”也能使用。

### 测试

```bash
cd desktop
bun run test -- src/__tests__/generalSettings.test.tsx src/components/chat/ChatInputSubmit.test.tsx src/stores/chatStore.test.ts src/utils/sessionTitle.test.ts src/constants/taskContextGraph.test.ts
bun run lint
```

## 发布建议

第一版建议只发布到 **P0-P2**：

- P0 保证不出丑。
- P1 让 Gugu 初步懂任务。
- P2 让 Gugu 能选对能力。

P3-P5 可以在下一轮内测继续打磨。这样每一步都能独立验收，风险小，也不会把“知识图谱”误做成一个复杂设置页。

## 非目标确认

以下内容本轮不做：

- 不做“知识图谱”侧边栏。
- 不做“项目资料 / Profile”设置页。
- 不做图谱可视化。
- 不做图数据库。
- 不做向量数据库。
- 不做默认跨会话记忆。
- 不把用户附件、聊天记录或项目文件长期沉淀到云端。
- 不让用户手动维护节点、标签和关系。
