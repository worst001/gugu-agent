# 01_cover

这页先建立定位：Gugu Agent 不是另一个聊天界面，而是一个本地可运行、可接入多模型、能被桌面端和 IM 远程驱动的 Claude Code 工作台。

---

# 02_positioning

核心价值可以压缩成一句话：把 Claude Code 的能力从单一终端扩展成本地开发者控制台。它同时面向命令行、桌面端、远程消息和自动化场景。

---

# 03_user_value

这页讲用户为什么需要它：数据和执行在本地，模型接入不被单一供应商锁死，远程控制让 Agent 可以从手机或团队 IM 触达，多 Agent 能把复杂任务拆开并行推进。

---

# 04_architecture

架构上是三层：Tauri 主进程和 React UI 承载用户体验，Bun server sidecar 负责 HTTP/WebSocket 和会话管理，CLI 子进程是真正执行 AI 对话和工具调用的核心。

---

# 05_agent_skills

多 Agent 与 Skills 是系统可扩展性的中心。Agent 负责并行执行、团队协作和后台任务，Skills 用 Markdown 把经验和流程沉淀成可重复调用的能力。

---

# 06_desktop_im

桌面端把权限、Diff、提供商、定时任务、Skills 和 IM 适配器集中到可视化界面。IM 则让用户可以通过 Telegram 或飞书远程发起新会话、审批权限和接收结果。

---

# 07_computer_use_security

Computer Use 的关键是用 Python Bridge 接管系统操作层，形成截图、模型识别、鼠标键盘执行、再截图确认的闭环。安全上通过应用授权、权限确认、并发保护和剪贴板保护降低风险。

---

# 08_roadmap

最后落到路线：继续完善桌面端体验、插件与 Skills 生态、远程协作、release 流程和文档，让 Gugu Agent 从可运行走向可交付、可扩展、可被团队长期使用。
