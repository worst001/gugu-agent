# Gugu Context Router / Domain Task Graph Requirements

## 1. 背景

Gugu Agent 当前已经具备多类能力：

- 工具箱：编码、总结文档、分析表格、做 PPT、写邮件、处理文件。
- Skills：`ppt-master`、`excel-master`、`pdf-master`、`word-master`、`office-suite` 等。
- MCP：CodeGraph、claude-mem 等。
- 模型能力：`flash / pro / GLM / Gugu Managed`。
- 活动面板：展示思考、工具调用、长任务状态。

但这些能力目前仍然比较分散。用户提出一个需求时，Agent 有时无法稳定判断：

- 应该使用哪个模型。
- 应该调用哪个 Skill。
- 是否需要读取文件。
- 是否需要 CodeGraph。
- 是否需要 WebFetch。
- 应该输出成文案、表格、PPT、邮件还是代码。
- 是否需要按行业、岗位、平台规则检查结果。

因此需要一个内部任务上下文路由层，让 Gugu 更接近 Codex 的工作方式：先理解任务，再选择上下文、模型、工具和执行策略。

## 2. 产品定位

内部能力名称可以是：

- `Gugu Context Router`
- `Task Context Router`
- `Domain Task Graph`

用户侧不叫“知识图谱”。

用户感知应该是：

> Gugu 更懂我的任务，更会选模型，更少乱调工具，输出更像交付物。

## 3. 目标

### 3.1 核心目标

- 自动识别用户任务类型。
- 自动选择少量相关任务上下文。
- 自动推荐模型、Skill、MCP、工具。
- 自动应用任务检查清单。
- 在活动面板展示可解释的路由结果。
- 不污染用户消息、不污染标题、不污染其他会话。

### 3.2 体验目标

用户不需要理解知识图谱、节点、边、RAG、GraphRAG 等概念。

用户只看到类似：

- `正在识别任务类型`
- `已识别：品牌内容 / 小红书文案`
- `推荐模型：Pro`
- `使用：品牌内容检查清单`
- `正在调用：WebFetch`

### 3.3 成本目标

- V1 不引入图数据库。
- V1 不引入向量数据库。
- V1 不上传用户附件到新服务。
- V1 不增加服务端长期存储压力。
- V1 只注入极少量上下文，避免 token 膨胀。

## 4. 非目标

V1 不做：

- 左边栏“知识图谱”入口。
- 图谱可视化。
- 让用户编辑节点/关系。
- 默认跨会话记忆。
- 默认启用 claude-mem。
- 云端同步用户知识库。
- Neo4j、Kuzu、OpenSPG 等图数据库。
- 大规模文档索引。
- 将用户附件、聊天记录、项目文件全量写入图谱。
- 自动覆盖用户文件。
- 自动发邮件、自动提交外部表单。

## 5. 用户故事

### 5.1 品牌内容

用户输入：

> 帮我写一篇适合小红书的品牌内容。

系统应识别：

- 任务：品牌内容
- 平台：小红书
- 推荐模型：Pro
- 推荐上下文：品牌内容结构、小红书风格、转化检查清单
- 可选工具：WebFetch，仅当用户要求参考竞品或实时信息时使用

输出应更像可交付文案，而不是泛泛聊天。

### 5.2 编码任务

用户输入：

> 看下这个报错，帮我修复。

系统应识别：

- 任务：编码 / Bug 修复
- 推荐模型：Pro
- 推荐工具：CodeGraph、Read、Grep、Bash
- 检查清单：先定位、再改动、再测试、不要误改无关文件

### 5.3 表格分析

用户上传 Excel 并输入：

> 帮我分析这个表格。

系统应识别：

- 任务：分析表格
- 输入：Excel
- 推荐 Skill：`excel-master` / `spreadsheet-master`
- 检查清单：字段、行列规模、缺失、重复、异常、结论

### 5.4 做 PPT

用户输入：

> 帮我做一份产品介绍 PPT。

系统应识别：

- 任务：做 PPT
- 推荐 Skill：`ppt-master`
- 推荐模型：Pro
- 检查清单：结构、页数、视觉风格、文字不溢出、不要粗糙排版

### 5.5 处理文件

用户上传 PDF/Word/图片并输入：

> 整理一下这个文件。

系统应识别：

- 任务：处理文件
- 输入：附件
- 推荐解析路径：本地解析 / Gugu Managed / GLM / 后续 DeepSeek V4 视觉
- 若文件过大，应给中文可操作提示

## 6. 功能需求

### FR1：任务识别

系统应从用户消息、附件、当前项目目录、工具箱选择中识别任务。

识别维度：

- `taskType`：任务类型
- `domain`：行业
- `role`：岗位
- `platform`：平台
- `inputTypes`：输入材料
- `outputTypes`：目标交付物
- `riskLevel`：风险等级
- `confidence`：置信度

任务类型 V1：

- `coding`
- `bug-fix`
- `document-summary`
- `spreadsheet-analysis`
- `ppt-draft`
- `mail-draft`
- `file-assistant`
- `brand-content`
- `social-copywriting`
- `competitor-analysis`
- `report-writing`
- `web-research`
- `computer-use`
- `general-chat`

### FR2：任务图谱配置

V1 使用本地静态配置，不使用数据库。

建议结构：

```ts
type TaskContextNode = {
  id: string
  label: string
  aliases: string[]
  domains: string[]
  roles: string[]
  platforms: string[]
  inputTypes: string[]
  outputTypes: string[]
  recommendedModel: 'flash' | 'pro' | 'vision'
  fallbackModel?: 'flash' | 'pro' | 'vision'
  skills: string[]
  tools: string[]
  mcp: string[]
  guardrails: string[]
  checklist: string[]
  examples?: string[]
}
```

### FR3：上下文注入

系统只能注入当前任务相关的少量上下文。

要求：

- 每轮最多注入 3-8 条规则。
- 只写入 wire/internal scaffold。
- 不写入 displayContent。
- 不污染用户气泡。
- 不污染会话标题。
- 不污染后续普通对话。
- 切换会话后不得串上下文。

### FR4：模型推荐

系统根据任务推荐模型。

初始规则：

- 简单问答、短文本润色：`flash`
- 长文案、品牌策略、复杂推理：`pro`
- 图片、PDF、Office 多模态理解：`vision`
- 代码结构、Bug 修复、架构分析：`pro`
- 用户手动选择模型时，用户选择优先。

要求：

- 推荐模型只作用于本轮。
- 不能污染后续会话。
- 自动降级必须可解释。
- 高风险任务不得自动用低能力模型。

### FR5：Skill / Tool 路由

系统根据任务推荐 Skill 和工具。

示例：

- PPT：`ppt-master`
- Excel：`excel-master`、`spreadsheet-master`
- PDF：`pdf-master`
- Word：`word-master`
- 文件整理：`local-office-files`、`file-master`
- 编码：CodeGraph、Read、Grep、Bash
- 网页调研：WebFetch
- 操作电脑：Computer Use

要求：

- 用户明确指定某个输出格式时，指定格式优先。
- 工具箱选择优先于自动判断。
- 自动判断不能强制调用不可用工具。
- MCP/Skill 不可用时，应回退普通流程。

### FR6：活动面板解释

活动面板需要展示路由过程。

示例：

- `正在识别任务类型`
- `已识别：品牌内容 / 小红书文案`
- `推荐模型：Pro`
- `使用检查清单：品牌内容`
- `正在调用：ppt-master`
- `CodeGraph 不可用，改用普通代码检索`

### FR7：检查清单自检

输出前应用任务检查清单。

品牌内容检查：

- 是否有目标人群。
- 是否有核心卖点。
- 是否符合平台语气。
- 是否有转化动作。
- 是否避免空泛表达。

PPT 检查：

- 是否有清晰结构。
- 是否避免文字溢出。
- 是否避免粗糙布局。
- 是否有页标题和重点。
- 是否符合用户要求的风格。

代码检查：

- 是否定位根因。
- 是否最小改动。
- 是否说明验证方式。
- 是否避免误改无关文件。

## 7. UI/UX 要求

### 7.1 不新增知识图谱主入口

V1 不在左边栏增加“知识图谱”。

### 7.2 工具箱保留

工具箱继续作为用户显式意图入口。

现有：

- 普通对话
- 编码
- 总结文档
- 分析表格
- 做 PPT
- 写邮件
- 处理文件

后续可加：

- 品牌内容
- 网页调研

### 7.3 后续可见入口

后续可以做，但不叫知识图谱：

- 品牌资料
- 项目资料
- 行业偏好
- 输出偏好

## 8. 数据与隐私要求

- 默认不跨会话记忆。
- 默认不保存用户附件内容。
- 默认不上传用户资料到新服务。
- 品牌资料必须本地优先。
- 用户可查看、修改、删除资料。
- 用户可关闭上下文路由增强。
- claude-mem 不作为 V1 默认依赖。

## 9. 验收标准

### 9.1 功能验收

- 用户选择工具箱后，路由正确。
- 用户不选择工具箱时，系统能识别常见任务。
- 品牌内容任务推荐 Pro。
- 简单短文本任务可推荐 flash。
- 编码任务可优先使用 CodeGraph。
- PPT 任务优先使用 `ppt-master`。
- Excel 任务优先使用 `excel-master`。
- 工具不可用时能回退。
- 路由结果不污染用户消息。
- 路由结果不污染标题。
- 切换会话不串上下文。

### 9.2 体验验收

- 活动面板能看到“识别任务/推荐模型/选择工具”。
- 用户不需要理解知识图谱概念。
- 用户可手动覆盖模型和工具箱选择。
- 错误提示为中文且可操作。

### 9.3 质量验收

- 品牌文案明显比普通问答更结构化。
- PPT 输出不再粗糙。
- 表格分析先说明字段和异常。
- 编码任务先理解项目再动手。
- 模型误用 flash 的情况下降。

## 10. 参考依据

- Microsoft GraphRAG：知识图谱适合连接多处信息和整体理解语料。  
  <https://microsoft.github.io/graphrag/>
- LlamaIndex Property Graph：工程上可以用 schema、retriever、路径深度组合图检索。  
  <https://developers.llamaindex.ai/python/framework/module_guides/indexing/lpg_index_guide/>
- LightRAG：轻量图结构 + 向量结合，强调效率和增量。  
  <https://arxiv.org/abs/2410.05779>
- KAG：专业领域不能只靠向量相似度，需要规则、逻辑和图结构。  
  <https://arxiv.org/abs/2409.13731>
- Zep/Graphiti：长期记忆要谨慎，时间关系和跨会话污染是核心风险。  
  <https://arxiv.org/abs/2501.13956>
