# Gugu Agent 业务人员使用手册

适用对象：销售、运营、产品、市场、客服、项目管理等非研发同事。

更新时间：2026-05-16

## 1. 先看这一页

Gugu Agent 是一个桌面 AI 助手，可以帮你写方案、整理会议纪要、分析文档、生成表格、改写话术、拆解任务。

业务同事通常只需要完成三件事：

1. 安装 Gugu Agent。
2. 配置一个主聊天模型，推荐 DeepSeek V4。
3. 如果要上传图片、PDF、Word、Excel 等附件，再配置 GLM 文件与图片解析。

推荐配置如下：

| 用途 | 推荐服务 | 在软件里配置的位置 |
| --- | --- | --- |
| 日常对话、写方案、做总结 | DeepSeek V4 | 设置 -> 服务商 -> DeepSeek |
| 图片、PDF、Office 文件解析 | GLM | 设置 -> GLM 文件与图片解析 |
| 备用聊天模型 | Zhipu GLM | 设置 -> 服务商 -> Zhipu GLM |

如果你只做纯文本聊天，先配 DeepSeek 就够了。如果你经常上传附件，一定要再配 GLM 文件与图片解析。

## 2. 安装 Gugu Agent

打开公司提供的 Gitee 发布页：

https://gitee.com/xiyouwangluo/claude-code-gugu/releases/latest

按系统下载：

- Windows：下载 `.msi` 文件，双击安装。
- macOS Apple Silicon：下载 `.dmg` 文件，拖到“应用程序”。

Windows 安装前如果已经打开旧版本，请先在右下角托盘退出 Gugu Agent。

macOS 首次打开如果提示“已损坏”或“无法验证开发者”，请联系 IT 或在终端执行：

```bash
xattr -cr /Applications/Gugu\ Agent.app
```

## 3. 申请 DeepSeek V4 API

DeepSeek 用来做主聊天模型，适合写方案、总结资料、生成话术、拆解任务。

### 3.1 注册和充值

1. 打开 DeepSeek 开放平台：
   https://platform.deepseek.com
2. 注册或登录账号。
3. 进入控制台后，确认账号有可用余额。API 调用会按用量扣费。
4. 建议公司统一使用部门账号，避免员工离职后 Key 无法管理。

### 3.2 创建 API Key

1. 打开 API Keys 页面：
   https://platform.deepseek.com/api_keys
2. 点击创建 API Key。
3. 名称建议写清楚用途，例如：
   `gugu-sales-zhangsan`
4. 创建后立刻复制 API Key。

注意：API Key 通常只完整显示一次。不要发到微信群、不要截图外传、不要放到公开文档。

### 3.3 在 Gugu Agent 中配置 DeepSeek

1. 打开 Gugu Agent。
2. 点击左侧或顶部的“设置”。
3. 进入“服务商”。
4. 点击“添加服务商”。
5. 选择 `DeepSeek`。
6. 在 `API Key` 输入框粘贴 DeepSeek API Key。
7. 其他内容保持默认：

| 字段 | 建议值 |
| --- | --- |
| 接口地址 | `https://api.deepseek.com/anthropic` |
| 主模型 | `deepseek-v4-pro` |
| Haiku 模型 | `deepseek-v4-flash` |
| Sonnet 模型 | `deepseek-v4-pro` |
| Opus 模型 | `deepseek-v4-pro` |

8. 点击“测试连接”。
9. 测试成功后点击“保存”。
10. 回到服务商列表，把 DeepSeek 设为默认服务商。

### 3.4 DeepSeek 模型怎么选

一般不用手动改，保持默认即可：

- `deepseek-v4-flash`：速度快，适合简单问答、改写、提纲。
- `deepseek-v4-pro`：能力更强，适合复杂方案、长文档总结、重要材料。

旧模型名 `deepseek-chat` 和 `deepseek-reasoner` 后续会弃用，不建议新配置使用。

## 4. 申请 GLM API

GLM 主要用于两类场景：

1. 作为备用聊天模型。
2. 解析附件，例如图片、PDF、Word、Excel、PPT。

业务同事最常用的是第二种：打开 GLM 文件与图片解析后，上传附件会更稳。

### 4.1 注册智谱开放平台

1. 打开智谱开放平台：
   https://open.bigmodel.cn
2. 注册或登录账号。
3. 如果平台提示创建项目，按默认流程创建一个项目即可。
4. 确认账号有可用额度或已开通对应模型权限。

### 4.2 创建 GLM API Key

1. 打开 API Key 管理页：
   https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys
2. 选择项目。
3. 点击创建 API Key。
4. 名称建议写清楚用途，例如：
   `gugu-attachment-sales`
5. 创建后立刻复制 API Key，并妥善保存。

如果页面入口变化，可以在控制台里找“API Key”“密钥管理”“项目管理”这几个入口。

## 5. 在 Gugu Agent 中配置 GLM 附件解析

这一步是为了让业务同事能上传图片、PDF、Word、Excel、PPT 等文件。

1. 打开 Gugu Agent。
2. 进入“设置”。
3. 点击“GLM 文件与图片解析”。
4. 打开右上角开关。
5. 在 `GLM API Key` 输入框粘贴 GLM API Key。
6. 其他内容保持默认：

| 字段 | 建议值 |
| --- | --- |
| 接口地址 | `https://open.bigmodel.cn/api/paas/v4` |
| 视觉模型 | `glm-5v-turbo` |
| OCR 模型 | `glm-ocr` |
| 摘要模型 | `glm-5.1` |

7. 点击“测试”。
8. 测试成功后点击“保存”。

配置成功后，你可以直接把文件拖进对话框。Gugu Agent 会先用 GLM 把附件解析成文本，再交给当前聊天模型处理。

## 6. 可选：把 GLM 配成备用聊天模型

如果公司希望 GLM 也能作为聊天模型使用，可以这样配置：

1. 进入“设置” -> “服务商”。
2. 点击“添加服务商”。
3. 选择 `Zhipu GLM`。
4. 粘贴 GLM API Key。
5. 保持默认接口地址和模型配置。
6. 点击“测试连接”。
7. 测试成功后保存。

如果管理员指定了模型名，可以按管理员要求填写。常见 GLM 模型会随平台更新，软件默认值优先。

## 7. 第一次使用建议

先试下面几个简单任务：

### 写材料

```text
帮我写一份客户拜访纪要，要求包含：客户背景、需求、风险、下一步行动。
语气正式，适合发给部门负责人。
```

### 改写话术

```text
把下面这段销售话术改得更自然、更适合微信沟通，不要太营销。
内容如下：
……
```

### 总结附件

上传 PDF 或 Word 后输入：

```text
请阅读附件，帮我总结成三部分：
1. 核心结论
2. 对业务有影响的风险点
3. 我下一步应该跟进的问题
```

### 生成表格

```text
请把下面内容整理成 Markdown 表格，列为：客户名称、需求、预算、跟进人、下一步动作。
……
```

## 8. 使用规范

### 可以做

- 写方案、周报、会议纪要、客户跟进记录。
- 总结公开资料、公司内部允许处理的文档。
- 生成提纲、表格、话术、邮件草稿。
- 帮你检查文字是否清楚、是否有遗漏。

### 不建议做

- 直接上传未脱敏的身份证、银行卡、合同敏感条款。
- 把 API Key 发给别人。
- 把 AI 生成内容不检查就直接对客户发送。
- 用个人账号给整个团队长期共用。

重要材料请人工复核。AI 可以帮你加速，但最终口径仍以业务负责人和公司制度为准。

## 9. 常见问题

### 测试连接失败

按顺序检查：

1. API Key 是否复制完整。
2. 账号是否有余额或额度。
3. 是否选对服务商。
4. DeepSeek 接口地址是否为 `https://api.deepseek.com/anthropic`。
5. GLM 附件解析接口地址是否为 `https://open.bigmodel.cn/api/paas/v4`。
6. 公司网络是否拦截了外部 API。

### 能聊天，但上传文件失败

通常是 GLM 文件与图片解析没配置好。进入“设置” -> “GLM 文件与图片解析”，确认：

- 开关已打开。
- GLM API Key 已填写。
- 点击“测试”能成功。
- 账号有 GLM 额度。

### 上传图片后提示模型不支持图片

DeepSeek 主聊天模型不直接处理图片。请打开 GLM 文件与图片解析，让 GLM 先把图片解析成文本。

### 保存了服务商，但还是没生效

回到“设置” -> “服务商”，确认对应服务商右侧显示“默认”。如果没有，点击“设为默认”。

### API Key 泄露了怎么办

立刻进入对应平台删除旧 Key，并重新创建一个新的 Key。然后在 Gugu Agent 中更新配置。

## 10. 管理员发放建议

给业务团队发放前，管理员建议先准备：

1. Gugu Agent 下载链接。
2. DeepSeek API Key 申请说明或部门统一 Key。
3. GLM API Key 申请说明或部门统一 Key。
4. 费用归属说明，例如按部门账号扣费。
5. 数据安全说明，明确哪些材料不能上传。

如果希望业务同事少填内容，可以由管理员先在一台电脑配置好服务商，再用“设置” -> “配置备份”导出配置。分享配置时默认不要包含 API Key，除非是安全的一对一发放。

## 11. 官方参考链接

- DeepSeek API 首次调用文档：https://api-docs.deepseek.com/zh-cn/
- DeepSeek 模型与价格：https://api-docs.deepseek.com/quick_start/pricing
- DeepSeek API Key 管理：https://platform.deepseek.com/api_keys
- 智谱 GLM 快速开始：https://docs.bigmodel.cn/cn/guide/start/quick-start
- 智谱 GLM API Key 管理：https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys
- 智谱 GLM 对话补全接口：https://docs.bigmodel.cn/api-reference
