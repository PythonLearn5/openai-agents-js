// 本示例演示 asTool() 的「结构化工具参数」用法。
//
// 对比另外两个示例：默认的 asTool() 只暴露一个 input 字符串，编排者把任务整段文字转述给子 Agent；
// 这里给工具加了 zod schema，模型必须按 text / source / target 三个字段填写，SDK 校验通过后再据此
// 拼出子 Agent 的输入（默认拼接格式，也可以用 inputBuilder 自定义、用 includeInputSchema 附上完整 schema）。
//
// main() 里连着跑两次同一个问题，方便对照：
// 1) 直接运行 translator —— 子 Agent 自己解析「Hola / Spanish / French」这些线索；
// 2) 运行 orchestrator —— 参数已由模型结构化拆好，子 Agent 拿到的输入更明确、也更不容易跑偏。
import {
  Agent,
  run,
  setDefaultModelProvider,
  setTracingDisabled,
} from '@openai/agents';
import { z } from 'zod';
import { AiGatewayProvider } from '../model-providers/ai-gateway.ts';

// 模型封装：让本示例的所有智能体（包括被包装成工具的 translator）调用 Vercel AI Gateway，
// 而不是直连 OpenAI。需要 AI_GATEWAY_API_KEY 和 AI_GATEWAY_MODEL（网关 slug，例如 openai/gpt-5.4）。
setDefaultModelProvider(new AiGatewayProvider());
// 链路追踪默认仍然上报到 OpenAI 平台（需要 OPENAI_API_KEY）。既然模型调用已经改走网关，
// 这里直接关掉追踪，避免只配了网关密钥时不断打印导出失败的噪声。
setTracingDisabled(true);

// 子 Agent：只负责翻译，它会被包装成 translate_text 工具交给编排者。
// 走网关时模型名必须是网关认识的 slug；这里没有写 runConfig，所以它沿用上面设置的默认 provider。
const translator = new Agent({
  name: 'translator',
  instructions:
    'Translate the input text into the target language. If the target is not clear, you can ask the user for clarification.',
});

// 编排者 Agent：自己不翻译，只按结构化工具参数调用 translator。
const orchestrator = new Agent({
  name: 'orchestrator',
  instructions:
    'You are a task dispatcher. Always call the tool with sufficient input for the task. Do not handle any tasks by yourself.',
  tools: [
    translator.asTool({
      toolName: 'translate_text',
      toolDescription:
        'Translate text between languages. When you call this tool, you must provide the text to translate, the source language, and the target language.',

      // Structured input parameters, filled by the model.
      // 结构化工具参数：由模型按 JSON Schema 填写，工具内部拿到的是已校验过的 params 对象，
      // 不再是一整段自由文本。
      parameters: z.object({
        text: z.string().describe('Text to translate.'),
        source: z.string().describe('Source language code or name.'),
        target: z.string().describe('Target language code or name.'),
      }),

      // By default, the input schema will be included in a simpler format.
      // Set includeInputSchema to true to include the full JSON Schema.
      // includeInputSchema: true,
      // includeInputSchema：是否把完整 JSON Schema 一并放进子 Agent 收到的提示里。
      // 默认 false，只给一份简化说明，通常足够子 Agent 理解任务。

      // Build a custom prompt from structured input data.
      // inputBuilder: async ({ params }) => {
      //   return `Translate the text "${params.text}" from ${params.source} to ${params.target}.`;
      // },
      // inputBuilder：用结构化参数自己拼给子 Agent 的输入文本，想控制提示内容时打开它。
    }),
  ],
  // toolChoice: 'required' 强制模型这一轮必须调用工具，否则它可能自己把答案编出来，
  // 示例就无法体现「子 Agent 被当作工具调用」这条链路。
  modelSettings: { toolChoice: 'required' },
});

async function main() {
  const query = 'Translate "Hola" from Spanish to French.';

  // 对照组：直接运行 translator 本身，看它作为普通 Agent 的输出。
  const response1 = await run(translator, query);
  console.log('Translator agent direct run:', response1.finalOutput);

  // 实验组：运行编排者，由它把同一句请求作为结构化工具参数转交给 translator。
  const response2 = await run(orchestrator, query);
  console.log('Translator agent as tool:', response2.finalOutput);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
