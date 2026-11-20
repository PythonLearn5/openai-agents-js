# Research Bot（研究机器人）

本示例展示如何编排多个 Agent 来生成一份详细的研究报告。

## 文件

- **main.ts** – CLI 入口，询问查询内容并通过 `ResearchManager` 运行工作流。
- **manager.ts** – 协调规划、网页搜索和报告撰写三个阶段。
- **agents.ts** – 包含三个 Agent：负责生成搜索关键词的规划 Agent、负责总结搜索结果的搜索 Agent，以及负责撰写最终报告的写作 Agent。

## 用法

在仓库根目录运行：

```bash
pnpm examples:research-bot
```

## 运行环境要求

使用 Node.js 22.18 或更高版本（限 22.x 系列）、Node.js 24.x，或 Node.js 26 及以上版本。以下命令通过 Node.js 直接执行 TypeScript：`start`。
