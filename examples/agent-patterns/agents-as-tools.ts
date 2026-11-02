import {
  Agent,
  run,
  setDefaultModelProvider,
  setTracingDisabled,
  withTrace,
} from '@openai/agents';
import { createInterface } from 'node:readline/promises';
import { AiGatewayProvider } from '../model-providers/ai-gateway.ts';

// 模型封装：让本示例的所有智能体调用 Vercel AI Gateway，而不是直连 OpenAI。
// 需要 AI_GATEWAY_API_KEY 和 AI_GATEWAY_MODEL（网关 slug，例如 openai/gpt-5.4）。
const gatewayProvider = new AiGatewayProvider();
setDefaultModelProvider(gatewayProvider);
// 链路追踪默认仍然上报到 OpenAI 平台（需要 OPENAI_API_KEY）。既然模型调用已经改走网关，
// 这里直接关掉追踪，避免只配了网关密钥时不断打印导出失败的噪声。
setTracingDisabled(true);

// 交互式命令行输入，方便手动运行这个示例。
const rl = createInterface({ input: process.stdin, output: process.stdout });

// 三个「专家」子 Agent：各自只负责翻译成一种语言。
// 它们不被直接调用，而是通过 asTool() 包装成工具交给编排者使用。
const spanishAgent = new Agent({
  name: 'spanish_agent',
  instructions: "You translate the user's message to Spanish",
});

const frenchAgent = new Agent({
  name: 'french_agent',
  instructions: "You translate the user's message to French",
});

const italianAgent = new Agent({
  name: 'italian_agent',
  instructions: "You translate the user's message to Italian",
});

// 编排者 Agent：自己不做翻译，只负责决定按什么顺序调用下面的翻译工具。
const orchestratorAgent = new Agent({
  name: 'orchestrator_agent',
  instructions: [
    'You are a translation agent. You use the tools given to you to translate.',
    'If asked for multiple translations, you call the relevant tools in order.',
    'You never translate on your own, you always use the provided tools.',
  ].join(' '),
  tools: [
    // asTool() 把一个 Agent 变成函数工具，名字和描述由模型自己选择是否调用。
    spanishAgent.asTool({
      toolName: 'translate_to_spanish',
      toolDescription: "Translate the user's message to Spanish",
      // You can customize both runner init options and additional options for its execution
      // runConfig：子 Agent 独立运行时使用的模型与参数；runOptions：本次调用的运行限制。
      runConfig: {
        // 模型名必须是网关认识的 slug，这里复用封装解析出来的默认值。
        model: gatewayProvider.model,
        modelSettings: {
          reasoning: { effort: 'low' },
          text: { verbosity: 'low' },
        },
      },
      runOptions: {
        maxTurns: 3,
      },
    }),
    frenchAgent.asTool({
      toolName: 'translate_to_french',
      toolDescription: "Translate the user's message to French",
    }),
    italianAgent.asTool({
      toolName: 'translate_to_italian',
      toolDescription: "Translate the user's message to Italian",
    }),
  ],
});

// 汇总者 Agent：拿到各语言译文后做检查、修正，并拼成最终回答。
// 它处于流程末端，不再调用任何工具。
const synthesizerAgent = new Agent({
  name: 'synthesizer_agent',
  instructions: [
    'You receive translations produced by translation tools.',
    'Inspect them, correct them if needed, and concatenate them into the final response.',
    'Do not refuse the request or attempt to call tools.',
  ].join(' '),
});

// 工具输出可能是纯文本，也可能是对象，这里统一转成可打印的字符串。
function formatToolOutput(output: unknown): string {
  return typeof output === 'string'
    ? output
    : (JSON.stringify(output) ?? String(output));
}

async function main() {
  const msg = await rl.question(
    'Hi! What would you like translated, and to which languages? ',
  );

  if (!msg) {
    throw new Error('No message provided');
  }
  // 示例自带的断言：输入这句固定文本时，要求西、法两个翻译工具都被调用到。
  const autoRunRequiredTools =
    msg === 'Hello to Spanish and French'
      ? ['translate_to_spanish', 'translate_to_french']
      : [];

  // withTrace 把整条链路的 span 归到同一个 trace 下，方便观测嵌套运行。
  await withTrace('Orchestrator evaluator', async () => {
    // 第一步：运行编排者，由模型自行决定调用哪些翻译工具（每个工具内部会完整跑一个子 Agent）。
    const orchestratorResult = await run(orchestratorAgent, msg);

    // 第二步：从本次运行新增的条目里挑出翻译工具的输出，也就是各语言译文。
    const calledTranslationTools = new Set<string>();
    const translations = orchestratorResult.newItems.flatMap((item) => {
      // 只保留「翻译工具」的函数调用结果，其余条目直接忽略。
      if (
        item.type !== 'tool_call_output_item' ||
        item.rawItem.type !== 'function_call_result' ||
        !item.rawItem.name.startsWith('translate_to_')
      ) {
        return [];
      }
      calledTranslationTools.add(item.rawItem.name);
      return [`${item.rawItem.name}: ${formatToolOutput(item.output)}`];
    });
    // 下面的校验只用于示例自检，确保编排者确实调用了工具。
    if (translations.length === 0) {
      throw new Error('Expected the orchestrator to call a translation tool.');
    }
    const missingTranslations = autoRunRequiredTools.filter(
      (toolName) => !calledTranslationTools.has(toolName),
    );
    if (missingTranslations.length > 0) {
      throw new Error(
        `Expected the orchestrator to call all requested translation tools. Missing: ${missingTranslations.join(', ')}.`,
      );
    }
    for (const translation of translations) {
      console.log(`  - Translation step: ${translation}`);
    }

    // 第三步：把原文和各译文交给汇总者，产出最终回复。
    // 译文是以纯文本形式传入的，汇总者与编排者之间没有共享上下文。
    const synthesizerResult = await run(
      synthesizerAgent,
      [`Original request: ${msg}`, 'Translations:', ...translations].join('\n'),
    );

    console.log(`\n\nFinal response:\n${synthesizerResult.finalOutput}`);
  });

  rl.close();
}

// 顶层调用：出错时先释放标准输入，再以退出码 1 结束。
// 这里刻意不用 process.exit()：在 readline 的 stdin、或网关的 keep-alive 连接还在关闭时强制退出，
// Windows 上会触发 libuv 断言崩溃（Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)），
// 并把真实退出码覆盖成崩溃码。只设置 exitCode，让事件循环自然排空后再退出。
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
