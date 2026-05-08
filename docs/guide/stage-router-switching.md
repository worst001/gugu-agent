# Stage Router 常用切换命令

这页只记录最常用的 TUI 命令，避免忘记怎么在 Cursor、GPT 和原版行为之间切换。

## 先确认你跑的是源码版

开发分支里的新命令需要用当前源码启动：

```powershell
bun .\src\entrypoints\cli.tsx
```

如果你运行的是全局旧版 `claude-gugu.exe`，可能看不到新加的 `/stage-router`。

## 查看当前状态

```text
/stage-router status
```

重点看这几项：

- `Stage router`: 是否开启阶段路由
- `Planner`: plan 阶段使用 `cursor` 还是 `chatgpt`
- `Reviewer`: review 阶段使用 `cursor` 还是 `chatgpt`
- `Executor model`: 执行阶段固定使用的模型
- `ChatGPT`: 是否已通过 `/connect` 登录

也可以看当前模型状态：

```text
/model status
```

## 切到 Cursor 规划/审查，DeepSeek 执行

适合想让 Cursor 负责 plan 和 review，但代码执行仍交给 DeepSeek V4。

```text
/stage-router enable planner=cursor reviewer=cursor executor=deepseek-v4
```

如果要指定 Cursor 里的模型，把 `cursorModel` 加到命令里：

```text
/stage-router enable planner=cursor reviewer=cursor executor=deepseek-v4 cursorModel=gpt-5.5-extra-high
```

如果要指定 reasoning 档位，推荐写成基础模型加 `cursorReasoning`：

```text
/stage-router enable planner=cursor reviewer=cursor executor=deepseek-v4 cursorModel=gpt-5.5 cursorReasoning=extra-high
```

内部会把它转换成 Cursor CLI 的模型 slug：

```text
agent -p --trust --model gpt-5.5-extra-high ...
```

目前不会传 `--reasoning` / `--effort` 这类未确认参数。不同账号/版本可用的模型 ID 可能不同，如果不确定精确名字，先在终端查：

```powershell
agent models
# 或
agent --list-models
```

常用流程：

```text
/plan 你的任务描述
/stage-router review 这次改动的目标说明
```

说明：

- `/plan <任务>` 会调用 Cursor CLI 做只读规划
- `/stage-router review` 会把当前 `git diff` 交给 Cursor 审查
- 执行阶段会自动把模型设回 `deepseek-v4`
- 调用 Cursor CLI 时会自动带 `--trust`，避免第一次运行卡在 Workspace Trust 确认
- 默认使用 `agent` 命令；安装 Cursor Agent CLI 后通常不用再写 `cursor=...`
- 如果 Cursor CLI 不叫 `agent`，才需要加 `cursor=你的命令名`
- 如果要固定 Cursor 模型，可以加 `cursorModel=模型名`
- 如果要固定 Cursor reasoning，可以加 `cursorReasoning=low|medium|high|extra-high|auto`

示例：

```text
/stage-router enable planner=cursor reviewer=cursor executor=deepseek-v4 cursorModel=gpt-5.5 cursorReasoning=extra-high
```

## 切到 GPT 规划/审查，DeepSeek 执行

适合使用你通过网页授权登录的 ChatGPT 账号负责 plan 和 review。

第一次使用前先登录：

```text
/connect
```

然后开启 GPT 路由：

```text
/stage-router enable planner=chatgpt reviewer=chatgpt executor=deepseek-v4
```

常用流程：

```text
/plan 你的任务描述
/stage-router review 这次改动的目标说明
```

说明：

- `/plan <任务>` 会显示 `ChatGPT plan completed.`
- `/stage-router review` 会用 ChatGPT 审查当前 `git diff`
- ChatGPT 没登录或 token 失效时，会提示先运行 `/connect`
- 执行阶段仍会自动回到 `deepseek-v4`

## 关闭 Stage Router，回到原版行为

如果你想回到普通 Claude Code 风格，不做 plan/review/execute 自动分流：

```text
/stage-router disable
```

关闭后：

- `/plan` 只进入普通 plan mode
- plan 和执行都使用当前会话/当前 provider 的模型
- 不会自动切到 GPT 或 Cursor
- 不会清除 ChatGPT 登录信息
- 不会删除 provider 配置

如果要手动切模型，继续使用原来的命令：

```text
/model 模型名
```

## 最常用速查

```text
# 看当前状态
/stage-router status

# Cursor 负责 plan/review，DeepSeek 负责执行
/stage-router enable planner=cursor reviewer=cursor executor=deepseek-v4 cursorModel=gpt-5.5 cursorReasoning=extra-high

# GPT 负责 plan/review，DeepSeek 负责执行
/connect
/stage-router enable planner=chatgpt reviewer=chatgpt executor=deepseek-v4

# 回到原版行为
/stage-router disable
```
