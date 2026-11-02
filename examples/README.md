### 提交报错问题

  ```bash
  git add examples/README.md
  git -c core.hooksPath=/dev/null commit -m "学习 agents-as-tools"
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
