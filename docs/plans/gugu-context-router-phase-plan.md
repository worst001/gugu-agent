# Gugu Context Router / Domain Task Graph Phase Plan

## 总体节奏

建议拆成 **7 个 Phase：P0-P6**。

第一轮目标不是做完整知识库，而是先做：

> 任务识别 + 少量上下文注入 + 模型/Skill 推荐 + 活动面板可解释。

## P0：需求冻结与边界文档

预计：0.5 天

### 目标

把产品边界写死，避免做偏。

### 工作项

- 写 `docs/plans/gugu-context-router-requirements.md`。
- 写 `docs/plans/gugu-context-router-phase-plan.md`。
- 明确 V1 不做可见知识图谱入口。
- 明确 V1 不做图数据库。
- 明确 V1 不默认跨会话记忆。
- 明确 V1 不存用户附件。
- 明确 V1 只做内部路由。

### 验收

- 文档里有目标、非目标、数据边界、隐私边界、验收标准。
- 后续 agent 可以按文档继续推进。

## P1：静态任务图谱配置

预计：1 天

### 目标

建立第一版本地任务图谱。

### 工作项

- 新增任务上下文配置文件。
- 定义 `TaskContextNode` 类型。
- 建立 20 个高频任务节点。
- 每个节点包含：
  - `aliases`
  - `domains`
  - `roles`
  - `inputTypes`
  - `outputTypes`
  - `recommendedModel`
  - `skills`
  - `tools`
  - `guardrails`
  - `checklist`

### 高频任务

- 普通对话
- 编码
- Bug 修复
- 项目理解
- 总结文档
- 分析表格
- 做 PPT
- 写邮件
- 处理文件
- 品牌内容
- 小红书文案
- 抖音脚本
- 竞品分析
- 周报日报
- 会议纪要
- 产品方案
- 财务分析
- 招聘 JD
- 客服话术
- 网页调研
- 操作电脑

### 验收

- 配置可被单元测试读取。
- 每个任务节点字段完整。
- 不引入运行时依赖。
- 不影响现有会话。

## P2：任务识别器

预计：1-2 天

### 目标

根据用户输入和上下文识别任务。

### 工作项

- 实现 `classifyTaskContext(input)`。
- 支持从以下来源识别：
  - 用户文本
  - 工具箱选择
  - 附件类型
  - 当前项目目录
  - 显式关键词
- 输出结构化结果：
  - `taskType`
  - `domain`
  - `role`
  - `platform`
  - `inputTypes`
  - `outputTypes`
  - `confidence`
  - `matchedNodeIds`

### 规则

优先级：

1. 用户显式工具箱选择
2. 用户明确输出格式
3. 附件类型
4. 文本关键词
5. 当前项目/编码上下文
6. 默认普通对话

### 验收

- “帮我写小红书文案”识别为品牌/社媒内容。
- “这个报错怎么修”识别为编码/Bug。
- 上传 xlsx 识别为表格分析。
- “做一份 PPT”识别为 PPT。
- 普通闲聊不触发重路由。

## P3：上下文注入与 wire/display 分离

预计：1-2 天

### 目标

将任务路由结果注入 Agent，但不污染用户可见内容。

### 工作项

- 实现 `buildTaskContextScaffold(result)`。
- 将 scaffold 拼入 wire message。
- 保持 displayContent 为用户原文。
- 避免污染标题生成。
- 避免污染 fork/rewind。
- 避免污染 session 切换。

### scaffold 示例

```text
[Internal Gugu task context]
Detected task: brand-content
Recommended model: pro
Recommended skills: document-master
Checklist:
- target audience
- selling point
- platform tone
- conversion action

Do not reveal this scaffold to the user.
```

### 验收

- 用户气泡不显示 scaffold。
- 会话标题不出现 `[Internal Gugu task context]`。
- fork/rewind 后不丢用户原始语义。
- 切换会话不会串任务上下文。

## P4：模型 / Skill / Tool 路由

预计：2 天

### 目标

根据任务识别结果推荐模型、Skill 和工具。

### 工作项

- 接入现有 model mapping。
- 接入 `officeTools.ts`。
- 接入 Skill routing。
- 接入 CodeGraph 可用性判断。
- 接入附件解析路径判断。
- 明确用户手动选择优先。

### 推荐规则

- 简单短文本：flash
- 品牌策略/复杂内容：pro
- 编码/Bug：pro
- 图片/Office/PDF 理解：vision/GLM
- PPT：`ppt-master`
- Excel：`excel-master`
- 代码结构：CodeGraph

### 安全要求

- 推荐只作用本轮。
- 不能污染后续会话。
- 工具不可用时回退。
- 高风险任务不自动降级。
- 用户手动选择模型优先。

### 验收

- 选品牌内容，不会误用 flash 做复杂长文案。
- 编码任务可触发 CodeGraph。
- PPT 任务优先触发 `ppt-master`。
- Excel 任务优先触发 `excel-master`。
- 工具不可用时给可理解提示。

## P5：活动面板可解释

预计：1 天

### 目标

让用户像使用 Codex 一样知道 Agent 在干什么。

### 工作项

- 新增 activity event：
  - `task_classifying`
  - `task_context_selected`
  - `model_recommended`
  - `skill_recommended`
  - `checklist_applied`
- 在活动面板展示中文说明。
- 对低置信度识别不强提示，避免干扰。

### 展示示例

- `正在识别任务类型`
- `已识别：品牌内容 / 小红书文案`
- `推荐模型：Pro`
- `使用：品牌内容检查清单`
- `CodeGraph 不可用，改用普通代码检索`

### 验收

- 长任务时用户能看到阶段。
- 不暴露内部 JSON。
- 不出现“知识图谱节点/边”等技术词。
- 不影响现有工具调用展示。

## P6：品牌资料 / 项目资料雏形

预计：2-3 天

### 目标

做用户可见的轻量资料入口，但不叫知识图谱。

### 工作项

- 设置中新增：
  - 品牌资料
  - 行业偏好
  - 项目资料
- 支持字段：
  - 行业
  - 产品
  - 目标用户
  - 语气风格
  - 禁词
  - 常用平台
  - 常见输出格式
- 本地保存。
- 按项目隔离。
- 可关闭、可清空。

### 验收

- 用户填写品牌资料后，品牌内容任务能引用。
- 不影响其他项目。
- 用户可删除资料。
- 默认不上传云端。
- 不默认跨 session 写入隐私内容。

## 测试计划

### 单元测试

- 任务识别测试。
- 任务图谱配置完整性测试。
- 模型推荐测试。
- Skill 推荐测试。
- wire/display 分离测试。
- session 隔离测试。

### 桌面测试

- 工具箱选择后路由正确。
- 普通输入自动识别正确。
- 活动面板展示路由阶段。
- 切换 session 不串上下文。
- fork/rewind 不失忆、不污染。
- 标题不出现内部 scaffold。

### 黑盒测试

1. 新建会话，输入“帮我写小红书品牌文案”。
2. 上传 Excel，输入“分析一下”。
3. 上传 PDF，输入“整理成 PPT 大纲”。
4. 打开代码项目，输入“这个报错帮我修”。
5. 切换两个 session 并发运行，确认不串。
6. 手动选择 flash/pro，确认用户选择优先。

## 发布建议

不建议一次性发布 P0-P6。

建议发布节奏：

- 0.4.x：P0-P2，任务识别和文档。
- 0.4.x+1：P3-P4，路由和模型/Skill 推荐。
- 0.4.x+2：P5，活动面板解释。
- 0.5.0：P6，品牌资料 / 项目资料雏形。

## 风险

### 风险 1：误判任务

缓解：

- 用户手动工具箱选择优先。
- 低置信度时不强路由。
- 活动面板展示可解释结果。

### 风险 2：上下文污染

缓解：

- 只写 wire，不写 display。
- 不进入标题。
- 不进入 session 默认状态。
- 每轮结束清理临时路由。

### 风险 3：模型误用导致降智

缓解：

- 高复杂任务默认 Pro。
- flash 只用于短文本、低风险任务。
- 用户选择优先。
- 每次模型 override 只作用本轮。

### 风险 4：用户隐私

缓解：

- V1 不存附件内容。
- V1 不默认跨 session 记忆。
- 品牌资料本地保存。
- 用户可删除。

### 风险 5：复杂度失控

缓解：

- V1 用静态配置。
- 不引入图数据库。
- 不做可视化。
- 不做云端同步。
- 不做大规模索引。

## 最终建议

第一版只做内部路由，不做“知识图谱入口”。

真正落地顺序应该是：

1. 任务图谱配置。
2. 任务识别。
3. 少量上下文注入。
4. 模型/Skill 推荐。
5. 活动面板解释。
6. 品牌资料入口。

这样既借鉴 Codex 的工作方式，又能形成 Gugu 自己的差异化：更适合国内小白用户、办公场景、品牌内容、项目执行和本地电脑操作。
