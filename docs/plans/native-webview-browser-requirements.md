# 原生 WebView 浏览器需求定义

## 背景

之前右侧工作台里的浏览器尝试偏向网页预览和 iframe 容器，用户体验不稳定：链接跳转、页面高度、URL 输入、登录、下载、新窗口等都容易失真。后续如果继续做浏览器，必须转向 Tauri 原生 WebView，而不是把网页塞进 React iframe。

这版目标是做一个舒适、可靠、可撤退的内置浏览器能力。它不是 Computer Use 的替代，也不是完整 Chrome；它主要服务于「查看网页、打开 agent 生成的链接、在工作台内对照资料」。登录、下载和复杂站点先作为外部浏览器兜底场景处理，不能把 MVP 伪装成完整浏览器。

## 用户目标

- 用户能在右侧工作台打开普通网页，而不是每次都跳到外部浏览器打断当前任务。
- 用户能输入 URL 或搜索词，支持回车访问。
- 用户能后退、前进、刷新、停止加载、复制链接、外部打开。
- 用户遇到不支持的下载、新窗口、权限请求、复杂登录或站点兼容异常时，有明确中文提示和外部打开兜底。
- 用户关闭工作台或切换会话后，浏览器不会遮挡聊天主界面、不会残留空白覆盖层。

## 非目标

- V1 不做 iframe 浏览器。
- V1 不让 agent 自动控制浏览器，不和 Computer Use 权限混在一起。
- V1 不读取、导出或暴露 Cookie。
- V1 不做多标签浏览器，只保留当前会话的一页浏览上下文。
- V1 不做完整下载管理器，下载先提示并引导外部浏览器打开。
- V1 不承诺 GitHub、银行、网盘、验证码、企业 SSO 等复杂站点都能在内置 WebView 稳定登录或跳转。

## 产品形态

浏览器作为右侧工作台的可选视图进入，但只有在原生 WebView 技术验证通过后才开放入口。

稳定视图保持：

- 审查
- 文件
- 活动

浏览器视图开放条件：

- Tauri 原生 child WebView 能稳定嵌入主窗口。
- 工作台展开、收起、拖拽宽度、窗口缩放时，WebView 边界能同步。
- WebView 关闭后不会遮挡主界面。
- Windows 和 macOS smoke 都通过。

## 交互要求

### 工具栏

- URL 输入框居中，宽度适中，输入文本左对齐。
- 支持输入完整 URL：`https://example.com`。
- 支持输入裸域名：`example.com`，自动补 `https://`。
- 支持输入搜索词，默认跳转到搜索引擎。
- 左侧按钮：后退、前进、刷新或停止加载。
- 右侧按钮：复制链接、外部浏览器打开。

### 页面区域

- 页面区域必须撑满工作台剩余高度，不能只显示上方一小块。
- 工作台拖拽宽度时页面不能变形。
- 关闭工作台后 WebView 必须隐藏或销毁。
- 切换到非浏览器视图时 WebView 必须隐藏，不能覆盖审查、文件、活动。

### 状态与提示

- 加载中显示轻量进度或 spinner。
- 页面加载失败时显示原因和「外部打开」按钮。
- 新窗口、下载、特殊协议等暂不支持时，不静默失败。
- 如果 WebView 创建失败，隐藏浏览器入口并提示使用外部浏览器。

## 技术方案

### 核心原则

React 只负责浏览器外壳和状态，网页渲染交给 Tauri 原生 WebView。

### 本地技术判断

当前桌面端使用 Tauri 2。已在本地依赖源码中确认：

- `Window::add_child(WebviewBuilder, position, size)` 可创建 child WebView。
- `Webview::set_position / set_size / set_bounds` 可更新位置和尺寸。
- `Webview::navigate` 可进行导航。
- `WebviewBuilder::on_navigation / on_new_window / on_download / on_page_load / on_document_title_changed` 可接管关键事件。

重要限制：

- Tauri child WebView API 当前需要启用 `tauri` 的 `unstable` feature。
- 这意味着它适合先做内测 spike，不能在 Windows/mac smoke 通过前直接作为正式功能发布。
- 如果后续 Tauri minor 版本改变 unstable API，需要在升级 Tauri 前重新跑 P1-P5 验收。

这说明方案可尝试，但必须通过 P1 spike 验证平台行为。

### Rust/Tauri 命令草案

- `browser_create(session_id, url, bounds)`
- `browser_navigate(session_id, url)`
- `browser_set_bounds(session_id, bounds)`
- `browser_show(session_id)`
- `browser_hide(session_id)`
- `browser_close(session_id)`
- `browser_go_back(session_id)`
- `browser_go_forward(session_id)`
- `browser_reload(session_id)`
- 外部打开复用前端 `openExternalFromAppAction`，不新增 Tauri browser 专用命令。

### 前端状态草案

- `browserUrl`
- `browserTitle`
- `browserLoading`
- `browserError`
- `browserCanGoBack`
- `browserCanGoForward`
- `browserNativeReady`
- `browserVisible`

这些状态只属于工作台和当前会话，不写入聊天消息，不污染上下文。

## 安全与隐私

- 不读取 Cookie。
- 不把页面 DOM 自动发送给模型。
- 不自动注入脚本。
- 不自动提交表单。
- 下载和新窗口默认需要用户确认或外部打开。
- 对 `file://`、`javascript:`、未知协议做拦截或外部处理。

## 验收标准

- 百度、官网等普通网页可打开、跳转、刷新。
- GitHub、网盘、登录页、下载页必须至少有外部打开兜底；只有 Windows/mac smoke 都通过后，才把它们列入内置浏览器承诺范围。
- URL 输入框可输入 URL、裸域名、搜索词。
- 工作台展开、收起、拖拽宽度、窗口缩放后 WebView 不残留、不遮挡、不变形。
- 切换会话和切换工作台视图后 WebView 状态正确。
- 新窗口和下载至少能给出明确提示或外部打开。
- Windows 与 macOS 都通过 smoke 后，才允许作为正式入口展示。
