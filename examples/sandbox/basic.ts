// 基础沙箱示例：从 Manifest 声明工作区初始文件，创建沙箱会话，用 SandboxAgent + shell 能力让模型
// 通过 exec_command 检查工作区并回答问题。支持 --docker 切换 Docker 后端，默认用 Unix-local。
import {
  OpenAIProvider,
  run,
  setDefaultModelProvider,
  setOpenAIAPI,
  type RunItem,
} from '@openai/agents';
import { Manifest, SandboxAgent, shell } from '@openai/agents/sandbox';
import {
  DockerSandboxClient,
  UnixLocalSandboxClient,
} from '@openai/agents/sandbox/local';
import {
  DEFAULT_DOCKER_IMAGE,
  ensureDockerAvailable,
  getStringArg,
  hasFlag,
  runExampleMain,
} from './support.ts';

// Vercel AI Gateway 配置：复用 .env 里已有的变量（与 openai npm 包共用同一组）。
const GATEWAY_BASE_URL =
  process.env.OPENAI_BASE_URL ?? 'https://ai-gateway.vercel.sh/v1';
// Gateway 用 "provider/model" 格式指定模型。
const DEFAULT_GATEWAY_MODEL = process.env.AI_GATEWAY_MODEL ?? 'openai/gpt-4o';
// 默认问题：让模型用两句话总结这个沙箱项目。
const DEFAULT_QUESTION = 'Summarize this sandbox project in 2 sentences.';
// Docker 模式默认镜像；可通过环境变量 SANDBOX_EXAMPLE_DOCKER_IMAGE 覆盖。
const DEFAULT_BASIC_DOCKER_IMAGE =
  process.env.SANDBOX_EXAMPLE_DOCKER_IMAGE ?? 'python:3.14-slim';

// 构造工作区初始文件清单：README、一个 Python 文件和一份笔记，内容写死，仅用于演示。
function buildManifest(backendLabel: string) {
  return new Manifest({
    entries: {
      'README.md': {
        type: 'file',
        content: `# Demo Project

This sandbox contains a tiny demo project for the ${backendLabel} sandbox runner.
The goal is to show how the SDK can prepare a sandbox workspace.
`,
      },
      'src/app.py': {
        type: 'file',
        content: `def greet(name: str) -> str:
    return f"Hello, {name}!"
`,
      },
      'docs/notes.md': {
        type: 'file',
        content: `# Notes

- The example is intentionally minimal.
- The model should inspect files through the shell tool.
`,
      },
    },
  });
}

// 从运行结果提取工具调用名称，用于后续断言模型确实调用了 exec_command。
function getToolNames(items: RunItem[]): string[] {
  return items.flatMap((item) => {
    if (item.type !== 'tool_call_item') {
      return [];
    }

    const rawItem = item.rawItem as { name?: unknown };
    return typeof rawItem.name === 'string' ? [rawItem.name] : [];
  });
}

async function main() {
  // 通过 Vercel AI Gateway 调模型：注入带 baseURL 的 OpenAIProvider，切到 Chat Completions 模式。
  // Gateway 不支持 Responses API（/v1/responses），所以用 chat_completions 走标准 /v1/chat/completions。
  const gatewayKey = process.env.AI_GATEWAY_API_KEY;
  if (!gatewayKey) {
    throw new Error(
      'AI_GATEWAY_API_KEY must be set before running this example.',
    );
  }
  setDefaultModelProvider(
    new OpenAIProvider({ baseURL: GATEWAY_BASE_URL, apiKey: gatewayKey }),
  );
  setOpenAIAPI('chat_completions');

  // 解析命令行参数：--docker 切后端，--model/--question/--image 可覆盖默认值。
  const useDocker = hasFlag('--docker');
  const model = getStringArg('--model', DEFAULT_GATEWAY_MODEL);
  const question = getStringArg('--question', DEFAULT_QUESTION);
  const image = getStringArg(
    '--image',
    useDocker ? DEFAULT_BASIC_DOCKER_IMAGE : DEFAULT_DOCKER_IMAGE,
  );
  const backendLabel = useDocker ? 'Docker' : 'Unix-local';
  const manifest = buildManifest(backendLabel);
  // Docker 后端需先检查 Docker 可用；Unix-local 直接创建客户端。
  const client = useDocker
    ? (() => {
        ensureDockerAvailable();
        return new DockerSandboxClient({ image });
      })()
    : new UnixLocalSandboxClient();
  // 按 manifest 把文件写入沙箱工作区，返回沙箱会话。
  const session = await client.create(manifest);

  // SandboxAgent：defaultManifest 让 Agent 知道工作区初始结构；capabilities: [shell()] 提供 exec_command 工具。
  const agent = new SandboxAgent({
    name: `${backendLabel} Sandbox Assistant`,
    model,
    instructions:
      'Answer questions about the sandbox workspace. Inspect the project once before answering, keep the response concise, do not guess file names like package.json or pyproject.toml, and remember that this demo intentionally contains a tiny workspace.',
    defaultManifest: manifest,
    capabilities: [shell()],
  });

  try {
    // 把沙箱会话注入运行：Agent 的 shell 工具在这个沙箱里执行命令，而非宿主机。
    const result = await run(agent, question, { sandbox: { session } });
    // 断言模型确实调用了 exec_command（即用 shell 检查了工作区文件）。
    const toolNames = getToolNames(result.newItems);
    if (!toolNames.includes('exec_command')) {
      throw new Error(`Expected exec_command, saw: ${toolNames.join(', ')}`);
    }
    console.log(`[backend] ${backendLabel}`);
    console.log(`[tools used] ${toolNames.join(', ')}`);
    console.log(result.finalOutput);
  } finally {
    // 关闭沙箱会话；close 可选且容错，确保不管结果如何都清理。
    await session.close?.().catch(() => {});
  }
}

await runExampleMain(main);
