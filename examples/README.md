### 提交报错问题

```bash
git add examples/README.md
git -c core.hooksPath=/dev/null commit -m "学习 agents-as-tools"
git commit -a -m "学习 agents-as-tools"
```

### 子目录运行示例

```bash
cd examples/agent-patterns
$env:AI_GATEWAY_API_KEY="vck_xxx"
$env:AI_GATEWAY_MODEL="openai/gpt-5.4"
pnpm start:agents-as-tools
```

### 根目录运行示例

```bash
pnpm examples:agents-as-tools
Translate "Hello, how are you?" into French.
```

### 调试运行示例

走 Vercel AI Gateway 的示例（`agents-as-tools.ts`、`agents-as-tools-conditional.ts`、`agents-as-tools-structured.ts`）需要在终端里提供网关变量：

```bash
cd examples/agent-patterns
$env:AI_GATEWAY_API_KEY="vck_xxx"
$env:AI_GATEWAY_MODEL="openai/gpt-5.4"
node --inspect-brk agents-as-tools.ts
```

嫌逐个设置麻烦，可以让 Node 直接读根目录 `.env`（`--env-file` 的路径按当前工作目录解析；文件里已有的变量不会覆盖你在终端设置的同名变量）：

```bash
cd examples/agent-patterns
node --env-file=..\..\.env --inspect-brk agents-as-tools-structured.ts
```

`--inspect-brk` 会停在第一行并开启调试服务，在 Trae / VS Code 里附加进程后打断点即可；用 `--inspect` 则不会阻塞，适合只观察日志。Node 24 可以直接执行 `.ts`，断点行号与源码一致。

### IDE 断点调试（Trae / VS Code）

`.vscode/launch.json` 只允许手动编辑，把下面两段追加到 `configurations` 数组里（Node 22.18+/24 能直接执行 `.ts`，无需 tsx 或预编译，断点行号与源码一一对应）：

```jsonc
{
  "type": "node",
  "request": "launch",
  "name": "Debug example: agents-as-tools",
  "cwd": "${workspaceFolder}/examples/agent-patterns",
  "program": "${workspaceFolder}/examples/agent-patterns/agents-as-tools.ts",
  // 示例用 readline 从 stdin 提问，必须用集成终端；内部调试控制台会让 rl.question 永久挂起。
  "console": "integratedTerminal",
  // 调试进程不继承 IDE 终端里 $env: 设置的变量，网关密钥改从 gitignored 的根 .env 读取。
  "envFile": "${workspaceFolder}/.env",
  // 保留 dist source map 的步进能力；想屏蔽 SDK 内部时再加 "packages/**/dist/**"。
  "skipFiles": ["<node_internals>/**"]
},
{
  "type": "node",
  "request": "launch",
  "name": "Debug example: agents-as-tools-structured",
  "cwd": "${workspaceFolder}/examples/agent-patterns",
  "program": "${workspaceFolder}/examples/agent-patterns/agents-as-tools-structured.ts",
  // 这个示例没有交互输入，改成 internalConsole 也能跑；保持 integratedTerminal 便于加提问。
  "console": "integratedTerminal",
  "envFile": "${workspaceFolder}/.env",
  "skipFiles": ["<node_internals>/**"]
}
```

调试进程只读取 `envFile` 指向的根 `.env`，里面必须有 `AI_GATEWAY_API_KEY` 和 `AI_GATEWAY_MODEL`。缺失时示例在顶层构造 provider 时就抛错，断点来不及命中（要停在第一行可临时加 `"stopOnEntry": true`）。

值得下断点的位置：

- `run(orchestratorAgent, msg)`：子 Agent 作为工具在同一进程、同一次运行里执行，断点直接命中，不需要二次 attach。
- `newItems.flatMap` 回调：逐个观察 `tool_call_output_item`，建议用条件断点 `item.rawItem.name === 'translate_to_french'`。
- 两处 `throw new Error(...)`：示例自检失败时，断住后检查 `calledTranslationTools` 和 `translations`。

想步进 SDK 内部：`asTool()` 在 `packages/agents-core/src/agent.ts`，嵌套运行在 `packages/agents-core/src/run.ts` 和 `src/runner/`。示例导入的是 `dist`（带 `.js.map`），去掉 `skipFiles` 里的 dist 通配即可 Step In 落到 `src`；改过 `packages/**` 源码后要先 `pnpm build`（或开 `pnpm dev` 监听），否则断点打在旧产物上。

`MODULE_TYPELESS_PACKAGE_JSON` 警告无害，只是 `examples/agent-patterns/package.json` 没有 `"type": "module"`。
