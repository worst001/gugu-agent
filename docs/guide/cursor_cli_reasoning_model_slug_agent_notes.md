# Cursor CLI 参数确认与 Reasoning 映射改造说明

## 目标

当前 `/stage-router` 已支持：

```bash
/stage-router enable planner=cursor reviewer=cursor executor=deepseek-v4 cursorModel=gpt-5.5
```

但还不支持把 Cursor 的 Reasoning / Effort 档位传给 Cursor CLI。

本次改造目标是：

1. 确认 Cursor CLI 是否暴露独立的 reasoning 参数。
2. 如果没有独立参数，则通过 `--model` 的模型 slug 表达 reasoning 档位。
3. 支持新增配置：

```bash
cursorReasoning=extra-high
```

并最终拼出 Cursor CLI 可执行命令。

---

## 当前判断

目前公开资料和社区反馈里，能确认 Cursor CLI 暴露了 `--model`，但没有确认存在这些独立参数：

```bash
--reasoning
--reasoning-effort
--effort
```

更大概率是：Cursor CLI 通过不同的 model slug 表达 reasoning 档位。

也就是说，不要优先实现：

```bash
agent -p --model gpt-5.5 --reasoning extra-high "..."
```

而是优先实现：

```bash
agent -p --model gpt-5.5-extra-high "..."
```

---

## 需要在终端确认的命令

先确认 CLI 命令名：

```bash
which agent || which cursor-agent
```

查看版本：

```bash
agent --version || cursor-agent --version
```

查看主命令参数：

```bash
agent --help
# 或
cursor-agent --help
```

查看 print 模式参数：

```bash
agent -p --help
# 或
cursor-agent -p --help
```

查看可用模型列表：

```bash
agent models
# 或
cursor-agent models
```

重点确认 `agent models` 或 `cursor-agent models` 里是否存在类似：

```text
gpt-5.5-extra-high
gpt-5.5-high
gpt-5.5-medium
gpt-5.5-low
gpt-5.5
```

如果存在，说明 reasoning 应通过 `--model` 的 slug 后缀传入。

---

## 推荐配置形式

对外仍然允许用户写：

```bash
/stage-router enable \
  planner=cursor \
  reviewer=cursor \
  executor=deepseek-v4 \
  cursorModel=gpt-5.5 \
  cursorReasoning=extra-high
```

内部解析后生成：

```bash
agent -p --model gpt-5.5-extra-high "..."
```

而不是：

```bash
agent -p --model gpt-5.5 --reasoning extra-high "..."
```

---

## 配置字段设计

新增字段：

```ts
type StageRouterConfig = {
  planner?: string;
  reviewer?: string;
  executor?: string;
  cursorModel?: string;
  cursorReasoning?: CursorReasoning;
};

type CursorReasoning =
  | "low"
  | "medium"
  | "high"
  | "extra-high"
  | "xhigh"
  | "auto";
```

说明：

- `cursorModel`：基础模型名，例如 `gpt-5.5`。
- `cursorReasoning`：reasoning 档位，例如 `extra-high`。
- `auto` 表示不强行拼 reasoning 后缀，交给 Cursor 默认策略。

---

## 模型 slug 解析函数

优先实现一个统一函数：

```ts
function resolveCursorModelSlug(model: string, reasoning?: string): string {
  if (!model) return model;
  if (!reasoning) return model;

  const normalized = reasoning.trim().toLowerCase();

  if (normalized === "auto") {
    return model;
  }

  const reasoningMap: Record<string, string> = {
    "low": "low",
    "medium": "medium",
    "med": "medium",
    "high": "high",
    "extra-high": "extra-high",
    "extra_high": "extra-high",
    "extrahigh": "extra-high",
    "xhigh": "extra-high",
    "x-high": "extra-high",
  };

  const suffix = reasoningMap[normalized];

  if (!suffix) {
    return model;
  }

  // 避免重复拼接：gpt-5.5-extra-high + extra-high
  if (model.endsWith(`-${suffix}`)) {
    return model;
  }

  // 如果用户已经直接传入某个 reasoning slug，尊重用户输入
  const knownSuffixes = ["-low", "-medium", "-high", "-extra-high"];
  if (knownSuffixes.some((s) => model.endsWith(s))) {
    return model;
  }

  return `${model}-${suffix}`;
}
```

---

## 命令拼接逻辑

原来可能是：

```ts
const model = config.cursorModel ?? "auto";

const args = [
  "-p",
  "--model",
  model,
  prompt,
];
```

改成：

```ts
const baseModel = config.cursorModel ?? "auto";
const modelSlug = resolveCursorModelSlug(baseModel, config.cursorReasoning);

const args = [
  "-p",
  "--model",
  modelSlug,
  prompt,
];
```

---

## 模型可用性校验

建议增加一个可选校验步骤：

```bash
agent models
```

或：

```bash
cursor-agent models
```

然后检查生成的模型 slug 是否在模型列表里。

伪代码：

```ts
async function validateCursorModelSlug(modelSlug: string): Promise<boolean> {
  const cli = await detectCursorCliCommand();
  const result = await runCommand(cli, ["models"]);

  if (!result.ok) {
    return true; // 无法确认时不要阻断执行
  }

  return result.stdout.includes(modelSlug);
}
```

如果 `gpt-5.5-extra-high` 不存在，回退到 `gpt-5.5`：

```ts
async function resolveAvailableCursorModel(
  baseModel: string,
  reasoning?: string,
): Promise<string> {
  const candidate = resolveCursorModelSlug(baseModel, reasoning);

  if (candidate === baseModel) {
    return candidate;
  }

  const available = await validateCursorModelSlug(candidate);

  if (available) {
    return candidate;
  }

  console.warn(
    `[stage-router] Cursor model slug not found: ${candidate}, fallback to ${baseModel}`,
  );

  return baseModel;
}
```

---

## Cursor CLI 命令名兼容

有些环境可能是：

```bash
agent
```

有些环境可能是：

```bash
cursor-agent
```

建议做自动探测：

```ts
async function detectCursorCliCommand(): Promise<"agent" | "cursor-agent"> {
  if (await commandExists("agent")) {
    return "agent";
  }

  if (await commandExists("cursor-agent")) {
    return "cursor-agent";
  }

  throw new Error(
    "Cursor CLI not found. Please install Cursor CLI command from Cursor command palette.",
  );
}
```

---

## 不建议现在做的事情

暂时不要硬编码以下参数：

```bash
--reasoning
--reasoning-effort
--effort
```

原因：

1. 当前公开资料没有稳定确认这些参数存在。
2. Cursor CLI 更可能通过 model slug 表达 reasoning 档位。
3. 硬编码未知参数会导致 CLI 直接报错。

---

## 推荐最终行为

### 输入 1

```bash
/stage-router enable planner=cursor reviewer=cursor executor=deepseek-v4 cursorModel=gpt-5.5
```

生成：

```bash
agent -p --model gpt-5.5 "..."
```

---

### 输入 2

```bash
/stage-router enable planner=cursor reviewer=cursor executor=deepseek-v4 cursorModel=gpt-5.5 cursorReasoning=extra-high
```

优先生成：

```bash
agent -p --model gpt-5.5-extra-high "..."
```

如果 `agent models` 里没有 `gpt-5.5-extra-high`，则回退：

```bash
agent -p --model gpt-5.5 "..."
```

并输出警告：

```text
[stage-router] Cursor model slug not found: gpt-5.5-extra-high, fallback to gpt-5.5
```

---

### 输入 3

```bash
/stage-router enable planner=cursor reviewer=cursor executor=deepseek-v4 cursorModel=gpt-5.5-extra-high
```

生成：

```bash
agent -p --model gpt-5.5-extra-high "..."
```

不再重复拼接 `extra-high`。

---

## 验收标准

1. 支持 `cursorReasoning=extra-high`。
2. 不使用未经确认的 `--reasoning` / `--effort` 参数。
3. `cursorModel=gpt-5.5 cursorReasoning=extra-high` 能解析成 `gpt-5.5-extra-high`。
4. `cursorModel=gpt-5.5-extra-high cursorReasoning=extra-high` 不会变成 `gpt-5.5-extra-high-extra-high`。
5. 如果 Cursor CLI 未安装，给出明确错误提示。
6. 如果目标模型 slug 不存在，回退到基础模型，并输出 warning。
7. 保持原有 `cursorModel=gpt-5.5` 的行为兼容。

---

## 给 Agent 的执行顺序

1. 找到 `/stage-router enable` 参数解析位置。
2. 增加 `cursorReasoning` 字段解析。
3. 增加 `resolveCursorModelSlug()`。
4. 找到 Cursor CLI 命令拼接位置。
5. 将 `cursorModel` 替换为解析后的 `modelSlug`。
6. 增加 CLI 命令名探测：优先 `agent`，其次 `cursor-agent`。
7. 可选增加 `agent models` 校验和 fallback。
8. 增加单元测试或最小测试脚本。
9. 手动运行以下用例验证：

```bash
/stage-router enable planner=cursor reviewer=cursor executor=deepseek-v4 cursorModel=gpt-5.5

/stage-router enable planner=cursor reviewer=cursor executor=deepseek-v4 cursorModel=gpt-5.5 cursorReasoning=extra-high

/stage-router enable planner=cursor reviewer=cursor executor=deepseek-v4 cursorModel=gpt-5.5-extra-high
```

---

## 最关键结论

当前先不要实现：

```bash
--reasoning extra-high
```

优先实现：

```bash
--model gpt-5.5-extra-high
```

也就是：

```text
cursorReasoning=extra-high
=> 内部映射到 model slug 后缀
=> gpt-5.5-extra-high
```

