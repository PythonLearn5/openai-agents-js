# 沙箱示例

这些示例展示了本分支中实现的 JavaScript 沙箱 API：`Manifest`、`SandboxAgent`、本地和 Docker 沙箱客户端、文件系统和 shell 能力、懒加载技能、宿主工具、转交、本地和远程快照、外部记忆存储，以及 SDK 会话。

Unix 本地示例在 macOS 和 Linux 上以宿主进程方式运行命令，不增加操作系统级的文件系统或网络隔离。这些示例适用于可信的本地开发或在外部隔离环境中使用。对于不可信的命令（包括受不可信输入影响的命令），请选择经过适当配置的 Docker 或托管后端，或提供外部隔离。SDK 的文件路径授权不限制任意 shell 命令。

大多数示例通过 `run` 调用模型，因此运行前请在 shell 环境中设置 `OPENAI_API_KEY`。

## 小型 API 示例

| 示例 | 运行命令 | 展示内容 |
| --- | --- | --- |
| `basic.ts` | `pnpm -F sandbox start:basic` | 从 manifest 创建沙箱会话并运行 `SandboxAgent`。 |
| `handoffs.ts` | `pnpm -F sandbox start:handoffs` | 在沙箱支撑的 Agent 中使用转交。 |
| `sandbox-agent-capabilities.ts` | `pnpm -F sandbox start:sandbox-agent-capabilities` | 为沙箱 Agent 配置文件系统、shell、图像、补丁、压缩和懒加载技能能力。 |
| `sandbox-agent-with-tools.ts` | `pnpm -F sandbox start:sandbox-agent-with-tools` | 将沙箱能力与宿主定义的函数工具结合使用。 |
| `sandbox-agents-as-tools.ts` | `pnpm -F sandbox start:sandbox-agents-as-tools` | 将沙箱 Agent 作为工具暴露给另一个 Agent。 |
| `resume.ts` | `pnpm -F sandbox start:resume` | 跨多轮复用本地沙箱快照。 |
| `memory.ts` | `pnpm -F sandbox start:memory` | 使用工作区记忆文件加本地快照恢复。 |
| `memory-generation.ts` | `pnpm -F sandbox start:memory-generation` | 在会话刷新时运行自动的 Phase 1/Phase 2 沙箱记忆生成。 |
| `memory-multi-agent-multiturn.ts` | `pnpm -F sandbox start:memory-multi-agent-multiturn` | 展示两个 Agent 共享一个沙箱工作区时的独立工作区记忆布局。 |
| `shared-session-workdirs.ts` | `pnpm -F sandbox start:shared-session-workdirs` | 在一个共享会话上以不同工作目录并发运行两个 Agent。 |
| `unix-local-pty.ts` | `pnpm -F sandbox start:unix-local-pty` | 在 Unix 本地沙箱中演练交互式 PTY。 |
| `unix-local-runner.ts` | `pnpm -F sandbox start:unix-local-runner` | 直接针对 Unix 本地沙箱后端运行。 |
| `docker-runner.ts` | `pnpm -F sandbox start:docker-runner` | 直接针对 Docker 沙箱后端运行。 |

## 注意事项

JavaScript SDK 现已暴露通用的远程快照和记忆存储接口。S3、GCS、R2 或 Azure 的云特定便捷存储有意留给扩展包或应用代码实现，以免核心包引入云服务商 SDK 依赖。

运行级作用域的工作目录仅改变相对路径的解析方式。独立的 Unix 本地会话会获得各自临时工作区，但工作目录和独立会话都不构成操作系统隔离边界。需要文件系统或计算隔离的工作负载必须使用能提供该隔离的后端和配置。

Python 示例还包含税务准备资产和教程/工作流脚手架。这些资产在本仓库中不存在，因此此处暂未镜像。

## 运行环境要求

使用 Node.js 22.18 或更高版本（限 22.x 系列）、Node.js 24.x，或 Node.js 26 及以上版本。以下命令通过 Node.js 直接执行 TypeScript：`start:basic`、`start:handoffs`、`start:coding-task`、`start:resume`、`start:memory`、`start:unix-local-pty`、`start:unix-local-runner`、`start:docker-runner`、`start:memory-generation`、`start:memory-multi-agent-multiturn`、`start:shared-session-workdirs`、`start:sandbox-agent-capabilities`、`start:sandbox-agent-with-tools`、`start:sandbox-agents-as-tools`。
