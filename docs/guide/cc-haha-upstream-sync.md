# cc-haha Upstream Sync Workflow

本文档说明如何查看另一个二开项目 `D:\Claude Code\cc-haha` 的更新，并把其中有价值的功能小批量移植到当前项目。

## 目标

不要直接做大规模 merge。把它当成“上游功能甄选 + 小批量移植”流程：

- 先看差异和功能清单
- 再按价值和风险筛选
- 最后一个功能一个分支地移植和验证

这样能避免一次性引入大量冲突、回归和不确定行为。

## 1. 添加本地 upstream remote

在当前项目中添加 `cc-haha` 为本地 remote：

```powershell
cd "D:\Claude Code\claude-code-gugu"
git remote add cc-haha-upstream "D:/Claude Code/cc-haha"
git fetch cc-haha-upstream
```

如果 remote 已存在，只需要 fetch：

```powershell
git fetch cc-haha-upstream
```

查看远端分支：

```powershell
git branch -r
```

如果对方默认分支不是 `main`，后续命令中的 `cc-haha-upstream/main` 替换成实际分支名。

## 2. 查看对方多了什么

先看提交差异：

```powershell
git log --oneline --left-right --cherry-pick HEAD...cc-haha-upstream/main
```

再看文件层面的变化规模：

```powershell
git diff --stat HEAD..cc-haha-upstream/main
```

如果只想看某个区域：

```powershell
git diff HEAD..cc-haha-upstream/main -- desktop/
git diff HEAD..cc-haha-upstream/main -- src/server/
git diff HEAD..cc-haha-upstream/main -- src/tools/
```

## 3. 先做功能清单，不急着合代码

把对方更新按模块归类：

- GUI / Tauri 体验改进
- TUI / CLI 交互改进
- provider / 模型兼容
- MCP / Skills / CE 工作流
- 稳定性修复
- 测试、文档、构建脚本
- 架构大改，先暂缓

每个候选功能记录：

- 来源 commit 或文件路径
- 用户价值
- 影响范围
- 是否能独立移植
- 是否需要测试或迁移
- 风险等级：低 / 中 / 高

## 4. 选择移植方式

优先级：

1. **cherry-pick 单个清晰 commit**
2. **按路径 diff 后手工移植**
3. **只借鉴设计，不直接合代码**

如果历史接近、commit 单一明确：

```powershell
git switch -c feat/import-xxx-from-cc-haha
git cherry-pick <commit>
```

如果历史已经分叉很多，避免硬 cherry-pick，改用按路径查看：

```powershell
git diff HEAD..cc-haha-upstream/main -- path/to/file.ts
```

然后手工把必要逻辑移植到当前项目，保持本仓库的命名、结构、测试和风格。

## 5. 每个功能单独分支

不要一次合多个不相关功能。每个候选功能单独开分支：

```powershell
git switch -c feat/import-<feature-name>-from-cc-haha
```

推荐分支命名：

- `feat/import-provider-ui-from-cc-haha`
- `fix/import-session-rewind-fix-from-cc-haha`
- `docs/import-usage-guide-from-cc-haha`

## 6. 验证策略

按影响范围跑测试。

GUI / desktop 改动：

```powershell
cd "D:\Claude Code\claude-code-gugu\desktop"
bun run test
bun run lint
```

Root CLI / server 改动：

```powershell
cd "D:\Claude Code\claude-code-gugu"
bun test <相关测试文件>
```

Docs 改动：

```powershell
cd "D:\Claude Code\claude-code-gugu"
bun run docs:build
```

如果是用户可见 GUI 改动，优先用 Tauri 或浏览器开发环境实际点一遍。

## 7. 判断标准

建议合入：

- 用户价值明确
- 改动边界清楚
- 能独立验证
- 与当前项目方向一致
- 不破坏 Claude Code 兼容性

谨慎合入：

- 大范围重构
- 隐式改变 provider、权限、会话、MCP 或文件写入行为
- 缺少测试且影响面大
- 依赖对方项目中特有的未同步架构

暂缓合入：

- 无法解释用户价值
- 需要大规模重写当前模块
- 只是代码风格差异
- 和当前已做的 GUI / CE / Skills 设计冲突

## 推荐工作方式

先产出一份更新评估清单，再决定移植顺序：

```text
请比较当前项目和 D:\Claude Code\cc-haha：
1. 列出对方新增/修改的主要功能
2. 按 GUI、TUI、server、provider、MCP/Skills、docs 分类
3. 标注每项用户价值、风险、建议移植方式
4. 只给清单，不要先改代码
```

确认候选功能后，再逐个移植：

```text
请把 cc-haha 里的 <功能名> 小范围移植到当前项目。
要求：
- 先定位来源 commit / diff
- 优先保持当前项目结构和风格
- 不做无关重构
- 加或更新必要测试
- 跑相关验证命令
```

核心原则：能小范围移植就小范围移植；能 cherry-pick 就 cherry-pick；大规模架构差异只借鉴设计，不直接合。
