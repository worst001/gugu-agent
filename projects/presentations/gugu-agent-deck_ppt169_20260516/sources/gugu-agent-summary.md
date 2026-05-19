# Gugu Agent PPT source summary

Gugu Agent 是谷星曜工作室维护的 Claude Code 本地可运行版本。它保留类似官方 Claude Code 的 Ink TUI 体验，同时补全桌面端、Computer Use、第三方模型接入、IM 远程驱动、多 Agent、Skills 和记忆系统。

## 关键卖点

- 本地可运行：会话、工具执行、桌面控制、IM 适配器和文档都围绕本地工作流设计。
- 模型自由：支持任意 Anthropic 兼容 API，以及 OpenAI、DeepSeek、Ollama 等第三方模型接入。
- 完整 TUI：支持交互模式和 `--print` 无头模式，可用于脚本、CI 和自动化任务。
- 桌面端：Tauri 2 + React，提供多标签、多会话、权限审批、提供商管理、定时任务、IM 适配器配置。
- 多 Agent：支持子代理、Fork、Teammate、后台任务、Teams 协作和 worktree 隔离。
- Skills：用 Markdown 定义可复用工作流，支持 bundled、user、project、plugin、MCP 等来源。
- Computer Use：用 Python Bridge 替代私有原生模块，实现 macOS / Windows 上的截图、鼠标、键盘、窗口控制。
- Channel / IM：通过 Telegram、飞书等即时通讯平台远程控制 Agent，并支持权限中继。

## 架构摘要

- CLI / TUI 层：处理 AI 对话、工具调用、权限、任务状态和终端交互。
- Server Sidecar：Bun HTTP + WebSocket 服务，管理会话并代理协议。
- Desktop App：Tauri 主进程承载 React WebView，编排 server / adapters sidecar。
- Adapter Sidecar：连接 Telegram / 飞书等 IM 平台。
- Runtime Bridge：Python helper 实现跨平台 Computer Use 操作。

## 适合听众

- 想私有化运行 Claude Code 工作流的个人和团队。
- 需要第三方模型、多端远程控制、桌面可视化和本地自动化的开发者。
- 关注可扩展 Agent 工作流、插件/Skills、团队式并行执行的技术评审者。
