# Gugu Agent

<p align="center">
  <img src="docs/images/app-icon.svg" alt="Gugu Agent" width="180">
</p>

<div align="center">

[![Gitee Stars](https://gitee.com/xiyouwangluo/claude-code-gugu/badge/star.svg)](https://gitee.com/xiyouwangluo/claude-code-gugu/stargazers)
[![Gitee Forks](https://gitee.com/xiyouwangluo/claude-code-gugu/badge/fork.svg)](https://gitee.com/xiyouwangluo/claude-code-gugu/members)
[![Releases](https://img.shields.io/badge/Releases-Gitee-C71D23?logo=gitee)](https://gitee.com/xiyouwangluo/claude-code-gugu/releases)
[![Website](https://img.shields.io/badge/Website-Gugu%20Agent-D97757)](http://139.196.214.54:8787/)

</div>

Gugu Agent 是一款即插即用的 AI 桌面 Agent。安装后可以直接使用内置的 Gugu Managed 托管线路，无需先折腾模型服务商、API Key 和文件解析能力；如果你有自己的模型供应商，也可以切换到自由配置模式，接入自定义服务商、模型、MCP、Agents、技能和插件。

它适合日常写代码、改 Bug、读文件、做方案、跑长任务，也适合希望把 Claude Code 能力产品化、可视化、低门槛交付给更多用户的团队。

<p align="center">
  <a href="#桌面端预览">桌面端预览</a> ·
  <a href="#为什么选择-gugu-agent">为什么选择</a> ·
  <a href="#核心能力">核心能力</a> ·
  <a href="#架构概览">架构概览</a> ·
  <a href="#下载与安装">下载与安装</a> ·
  <a href="#试用与订阅">试用与订阅</a> ·
  <a href="#开发运行">开发运行</a>
</p>

---

## 桌面端预览

<p align="center">
  <a href="https://gitee.com/xiyouwangluo/claude-code-gugu/releases"><img src="https://img.shields.io/badge/下载桌面端-Windows-D97757?style=for-the-badge" alt="下载桌面端"></a>
  &nbsp;
  <a href="docs/desktop/04-installation.md"><img src="https://img.shields.io/badge/安装指南-Guide-gray?style=for-the-badge" alt="安装指南"></a>
</p>

<table>
  <tr>
    <td align="center" width="33%"><img src="docs/images/desktop_ui/01_full_ui.png" alt="新建会话"><br><b>新建会话</b></td>
    <td align="center" width="33%"><img src="docs/images/desktop_ui/02_edit_code.png" alt="Agent 工作台与 Diff"><br><b>Agent 工作台与 Diff</b></td>
    <td align="center" width="33%"><img src="docs/images/desktop_ui/03_ask_question_and_permission.png" alt="订阅与用量"><br><b>订阅与用量</b></td>
  </tr>
</table>

---

## 为什么选择 Gugu Agent

- **即插即用**：默认使用 Gugu Managed，模型线路、文件解析、额度和订阅流程都已经配置好，普通用户安装后就能开始用。
- **不用先懂模型服务商**：不要求用户先理解 Base URL、模型 ID、API Key、OCR 或多模态解析这些配置细节。
- **保留高级自由度**：有自有模型资源的用户，仍然可以配置第三方服务商、自定义模型、MCP、Agents、技能和插件。
- **面向真实开发场景**：从普通问答、计划梳理，到代码修改、Diff 审阅、权限确认、文件解析和长任务，都在同一个桌面界面里完成。
- **适合交付给非技术用户**：把复杂 Agent 能力包成更清楚的按钮、状态、订阅和工作台，降低第一次上手成本。

---

## 核心能力

- **Gugu Managed 托管线路**：内置托管模型能力，当前接入 DeepSeek V4，并结合 GLM 做文件、图片、OCR 和长文解析。
- **默认 / 计划 / CE 三种运行模式**：默认模式适合日常对话和执行；计划模式适合先梳理问题；CE 模式适合轻量迭代、标准交付和更完整的工程流程。
- **文件解析**：支持图片、OCR、长文总结和文件理解，可以把资料直接交给 Agent 分析。
- **权限控制**：命令、文件写入和高风险操作前展示权限确认，用户可以清楚知道 Agent 将要做什么。
- **Agent 工作台**：集中查看活动、Diff、预览、工具调用和文件修改，减少黑盒感。
- **Agents / Skills / Plugins**：统一管理内置、项目和插件带来的 Agent 与技能包。
- **服务商自由配置**：保留第三方模型供应商和本地配置入口，适合团队或高级用户接入自己的模型资源。
- **订阅与用量**：桌面端展示套餐状态、到期时间和剩余百分比，用完后可进入购买/续费和激活流程。

---

## 架构概览

<table>
  <tr>
    <td align="center" width="25%"><img src="docs/images/01-overall-architecture.png" alt="整体架构"><br><b>整体架构</b></td>
    <td align="center" width="25%"><img src="docs/images/02-request-lifecycle.png" alt="请求生命周期"><br><b>请求生命周期</b></td>
    <td align="center" width="25%"><img src="docs/images/03-tool-system.png" alt="工具系统"><br><b>工具系统</b></td>
    <td align="center" width="25%"><img src="docs/images/04-multi-agent.png" alt="多 Agent 架构"><br><b>多 Agent 架构</b></td>
  </tr>
  <tr>
    <td align="center" width="25%"><img src="docs/images/05-terminal-ui.png" alt="终端 UI"><br><b>终端 UI</b></td>
    <td align="center" width="25%"><img src="docs/images/06-permission-security.png" alt="权限与安全"><br><b>权限与安全</b></td>
    <td align="center" width="25%"><img src="docs/images/07-services-layer.png" alt="服务层"><br><b>服务层</b></td>
    <td align="center" width="25%"><img src="docs/images/08-state-data-flow.png" alt="状态与数据流"><br><b>状态与数据流</b></td>
  </tr>
</table>

---

## 下载与安装

前往 [Gitee Releases](https://gitee.com/xiyouwangluo/claude-code-gugu/releases) 下载最新 Windows 版本。

如果浏览器或安全软件提示风险，请确认下载来源为本仓库 Release，并核对发布页提供的版本号和校验信息。当前 Windows 包仍处于早期分发阶段，未建立足够下载信誉时，部分安全软件可能出现误报。

### Windows

1. 下载 `Gugu-Agent-*-Windows-x64.zip`。
2. 解压到固定目录。
3. 运行 Gugu Agent。
4. 首次启动后选择 Gugu Managed，即可进入试用。

---

## 试用与订阅

- 新设备可获得 7 天试用。
- 试用到期或用量不足后，在桌面端进入 `设置 -> 订阅`。
- 点击购买/续费，选择套餐并提交订单。
- 人工确认收款后，你会收到激活码。
- 回到 `设置 -> 订阅` 输入激活码即可升级。

当前版本采用人工发码。备案、HTTPS 域名和公司商户账号准备好后，会逐步接入微信和支付宝自动支付。

---

## 开发运行

### 安装依赖

```bash
bun install
cd desktop
bun install
```

### 启动本地服务

```bash
SERVER_PORT=3456 bun run src/server/index.ts
```

### 启动桌面前端

```bash
cd desktop
bun run dev
```

### 启动 Gateway

```bash
cd gateway
bun run dev
```

### 常用检查

```bash
cd desktop && bun run test
cd desktop && bun run lint
cd gateway && bun run test
```

---

## 项目结构

```text
src/          CLI、本地服务、代理和核心工具实现
desktop/      Tauri 2 + React 桌面端
gateway/      Gugu Managed 网关、订阅、订单和后台 dashboard
docs/         使用文档和设计说明
```

---

## 更多文档

- [桌面端安装指南](docs/desktop/04-installation.md)
- [第三方模型配置](docs/guide/third-party-models.md)
- [Agents 使用说明](docs/agent/01-usage-guide.md)
- [Skills 使用说明](docs/skills/01-usage-guide.md)
- [IM 接入](docs/im/index.md)
