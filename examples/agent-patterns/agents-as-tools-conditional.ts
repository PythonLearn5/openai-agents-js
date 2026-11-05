// 条件启用工具（conditional tool enabling）示例。
// 编排者的工具数组是写死的，但每个工具可以带 isEnabled 判断：运行时按上下文决定模型实际
// 「看到」哪几个工具，返回 false 的工具会被整个过滤掉，模型根本无从调用它。
import { Agent, RunContext, run, withTrace } from '@openai/agents';
import { createInterface } from 'node:readline/promises';

// 运行前打印的说明文字，只服务于交互式演示。
const introduction =
  `Agents-as-Tools with Conditional Enabling\n\n` +
  'This demonstrates how language response tools are dynamically enabled based on user preferences.\n';

// 用户可选的语言偏好，决定本次运行启用几个工具。
type LanguagePreference = 'spanish_only' | 'french_spanish' | 'european';

// 传给 run() 的上下文类型，isEnabled 回调读取的就是这里的字段。
type AppContext = {
  languagePreference: LanguagePreference;
};

// 法语工具的启用条件：偏好为「法+西」或「欧洲语言」时才暴露给模型。
function frenchSpanishEnabled({
  runContext,
}: {
  runContext: RunContext<AppContext>;
}) {
  return (
    runContext.context.languagePreference === 'french_spanish' ||
    runContext.context.languagePreference === 'european'
  );
}

// 意大利语工具的启用条件：只有偏好为「欧洲语言」时才暴露。
function europeanEnabled({
  runContext,
}: {
  runContext: RunContext<AppContext>;
}) {
  return runContext.context.languagePreference === 'european';
}

// 三个「专家」子 Agent，各自只负责用一种语言回答。
// 泛型参数 Agent<AppContext> 声明它们能拿到强类型的运行上下文，这里它们本身并不读取上下文。
const spanishAgent = new Agent<AppContext>({
  name: 'spanish_agent',
  instructions:
    "You respond in Spanish. Always reply to the user's question in Spanish.",
});

const frenchAgent = new Agent<AppContext>({
  name: 'french_agent',
  instructions:
    "You respond in French. Always reply to the user's question in French.",
});

const italianAgent = new Agent<AppContext>({
  name: 'italian_agent',
  instructions:
    "You respond in Italian. Always reply to the user's question in Italian.",
});

// 编排者：三个工具始终列在数组里，是否启用交给 isEnabled 在运行时判断。
// isEnabled 既可以是布尔常量，也可以是（可异步的）回调，回调会拿到本次运行的 runContext。
const orchestrator = new Agent<AppContext>({
  name: 'orchestrator',
  instructions: [
    'You are a multilingual assistant. You use the tools given to you to respond to users.',
    'You must call all available tools to provide responses in different languages.',
    'You never respond in languages yourself, you always use the provided tools.',
  ].join(' '),
  tools: [
    spanishAgent.asTool({
      toolName: 'respond_spanish',
      toolDescription: "Respond to the user's question in Spanish.",
      // 恒定启用。
      isEnabled: true,
    }),
    frenchAgent.asTool({
      toolName: 'respond_french',
      toolDescription: "Respond to the user's question in French.",
      // 按上下文动态启用。
      isEnabled: frenchSpanishEnabled,
    }),
    italianAgent.asTool({
      toolName: 'respond_italian',
      toolDescription: "Respond to the user's question in Italian.",
      // 最严格的启用条件，只有第三种偏好才会暴露。
      isEnabled: europeanEnabled,
    }),
  ],
});

// 工具输出可能是纯文本，也可能是对象，这里统一转成可打印的字符串。
function formatToolOutput(output: unknown): string {
  return typeof output === 'string'
    ? output
    : (JSON.stringify(output) ?? String(output));
}

async function main() {
  // 自动模式：批量跑示例的脚本会设置 EXAMPLES_INTERACTIVE_MODE=auto，
  // 此时不再等待人工输入，每个提问直接用兜底答案，方便无人值守跑通。
  const autoMode = process.env.EXAMPLES_INTERACTIVE_MODE === 'auto';
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  // 提问的统一封装：自动模式返回默认值，交互模式读取输入并去掉首尾空白。
  const ask = async (prompt: string, fallback: string) => {
    if (autoMode) return fallback;
    return (await rl.question(prompt)).trim();
  };

  try {
    console.log(introduction);
    console.log('Choose language preference:');
    console.log('1. Spanish only (1 tool)');
    console.log('2. French and Spanish (2 tools)');
    console.log('3. European languages (3 tools)');

    // 把菜单选项翻译成偏好；非法输入回退到 spanish_only，即只启用 1 个工具。
    const choice = await ask('\nSelect option (1-3): ', '2');
    const preferenceMap: Record<string, LanguagePreference> = {
      '1': 'spanish_only',
      '2': 'french_spanish',
      '3': 'european',
    };
    const languagePreference = preferenceMap[choice] ?? 'spanish_only';

    // 上下文只创建一次，run() 期间编排者以及它调用的子 Agent 共用同一份。
    const runContext = new RunContext<AppContext>({ languagePreference });
    // getAllTools 会把 isEnabled 先算一遍，得到本次运行真正会暴露给模型的工具。
    // 这里只是提前打印出来方便观察，并不影响随后的实际运行。
    const availableTools = await orchestrator.getAllTools(runContext);
    const toolNames = availableTools.map((tool) => tool.name).join(', ');

    console.log(`\nLanguage preference: ${languagePreference}`);
    console.log(
      toolNames
        ? `Available tools: ${toolNames} (the model sees ${availableTools.length} tools).`
        : 'Available tools: none.',
    );

    const userRequest = await ask(
      '\nAsk a question and see responses in the available languages:\n',
      'How do you say good morning?',
    );

    if (!userRequest.trim()) {
      console.log('No question provided, exiting.');
      return;
    }

    console.log('\nProcessing request...');
    // withTrace 把这一轮产生的所有 span 归到同一个 trace 下。
    // 注意追踪默认仍上报 OpenAI 平台，只配网关密钥时会打印导出失败的噪声。
    await withTrace('Conditional tool access', async () => {
      // context 必须随 run() 传入，isEnabled 回调才读得到用户的语言偏好。
      const result = await run(orchestrator, userRequest, {
        context: runContext,
      });
      // 从本次运行新增的条目里挑出各语言响应工具的输出。
      const responses: string[] = [];
      const calledResponseTools = new Set<string>();
      for (const item of result.newItems) {
        // 只保留「响应工具」的函数调用结果，其余条目直接忽略。
        if (
          item.type !== 'tool_call_output_item' ||
          item.rawItem.type !== 'function_call_result' ||
          !item.rawItem.name.startsWith('respond_')
        ) {
          continue;
        }
        calledResponseTools.add(item.rawItem.name);
        responses.push(
          `${item.rawItem.name}: ${formatToolOutput(item.output)}`,
        );
      }
      // 示例自带的断言：本次启用的工具都必须被模型调用到，漏一个就报错。
      const missingTools = availableTools
        .map((tool) => tool.name)
        .filter((name) => !calledResponseTools.has(name));
      if (missingTools.length > 0) {
        throw new Error(
          `Expected the orchestrator to call all available response tools. Missing: ${missingTools.join(', ')}.`,
        );
      }
      console.log(`\nResponse:\n${responses.join('\n')}`);
    });
  } finally {
    // 正常结束或抛错都要释放标准输入，否则进程会挂在 stdin 上不退出。
    await rl.close();
  }
}

// 顶层调用：出错时先打印，再以退出码 1 结束。
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
