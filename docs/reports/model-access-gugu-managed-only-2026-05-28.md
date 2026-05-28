# 模型接入收敛报告 - 2026-05-28

## 背景

当前产品只由 Gugu 自己提供托管服务，暂未和 Anthropic、OpenAI、ChatGPT、DeepSeek、GLM、Kimi、Qwen 等第三方厂商建立合作关系。为了避免用户误解为官方合作或内置推荐，本次将桌面端“模型接入”入口收敛为：

- Gugu 托管服务：唯一内置托管入口，使用 Gugu 套餐额度，无需用户自备上游 API Key。
- 自定义接口：用户自备账号、API Key、Base URL 和模型 ID，Gugu 只提供本地协议适配能力。

## 已完成

1. 服务端预设收敛

- 修改 `src/server/config/providerPresets.json`。
- 公开预设仅保留 `gugu-managed` 和 `custom`。
- 删除公开预设中的 `official`、`chatgpt`、`deepseek`、`zhipuglm`、`kimi`、`minimax`、`qwen-dashscope`、`doubao-ark`、`jiekouai`、`shengsuanyun`、`lmstudio`、`ollama` 等入口。

2. 桌面设置页收敛

- 修改 `desktop/src/pages/Settings.tsx`。
- “添加服务商”改为“添加自定义接口”。
- 添加弹窗里只展示 `Custom`，不再展示任何第三方厂商预设，也不展示 Gugu 作为可重复添加的预设。
- 自定义接口仍允许选择通用协议：
  - Anthropic Messages 兼容协议
  - OpenAI Chat Completions 兼容协议
  - OpenAI Responses 兼容协议
- 下拉里不再出现 `Gugu Managed` 或 `ChatGPT Codex` 这种非自备接口选项。

3. 文案调整

- 修改 `desktop/src/i18n/locales/zh.ts` 和 `desktop/src/i18n/locales/en.ts`。
- “服务商”改为“模型接入”。
- “API 格式”改为“接口协议”。
- `Gugu 托管服务（内置）` 改为 `Gugu 托管服务（国内内置）`。
- `Claude Official` 兜底标签改成中性表达，避免模型选择器在旧状态下露出官方厂商感。

4. 旧用户兼容

- 修改 `src/server/services/providerService.ts`。
- 虽然第三方厂商预设不再公开展示，但保留少量旧 presetId 的运行时 env 兼容。
- 目标是：已保存过旧 provider 的内测用户升级后仍可继续使用，不会因为预设删除丢失必要的 env 覆盖。

5. 测试更新

- 修改 `desktop/src/__tests__/generalSettings.test.tsx`。
- 修改 `src/server/__tests__/provider-presets.test.ts`。
- 新断言覆盖：
  - 公开预设只剩 `gugu-managed` 和 `custom`。
  - 添加自定义接口弹窗不展示 DeepSeek/Qwen/Gugu/ChatGPT。
  - 自定义接口协议下拉只展示用户自备协议选项。

## 验证结果

已通过：

- `cd desktop && rtk test bun run lint`
- `cd desktop && rtk test bun run test generalSettings.test.tsx`
- `cd desktop && rtk test bun run test src`
- `cd desktop && rtk test bun run build`
- `rtk test bun test src/server/__tests__/provider-presets.test.ts src/server/__tests__/providers.test.ts`
- `rtk test bun test src/server/__tests__/conversation-service.test.ts -t "preserves provider capability"`

说明：

- `cd desktop && bun run test` 不适合作为当前全量验证命令，因为它会扫到 `desktop/build-artifacts/...` 里的打包产物测试文件，导致 49 个 suite 因 `bun:test` 被 Vite 浏览器环境 externalize 而失败。
- 限定 `desktop/src` 的测试已通过，覆盖本次桌面代码修改范围。
- `desktop build` 通过，仅保留既有的 chunk size warning。

## 当前状态

- 代码已完成并通过针对性验证。
- 尚未提交 commit。
- 尚未发版。
- 工作区仍有本轮修改文件，另有之前已经存在的未跟踪目录 `.tmp/` 和 `outputs/`，本次没有处理它们。

## 建议下一步

1. 你回来后先看桌面设置页文案是否符合产品口径。
2. 如果确认，建议作为 `0.1.18` 或 `0.1.17` 后续 hotfix 发版。
3. 后续如果要彻底统一官网/文档口径，需要单独清理历史文档中关于第三方厂商预设、DeepSeek/GLM/Kimi/Qwen 等推荐式描述。本次没有动官网和历史文档正文，避免扩大改动范围。

