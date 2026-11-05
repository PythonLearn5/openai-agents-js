// Vercel AI SDK 接入示例：演示用 aisdk() 适配器把「AI SDK 的模型对象」交给 Agents SDK 使用。
//
// Agent 只认 Model 接口，aisdk() 负责在中间做翻译：模型调用改由 AI SDK 发起，
// Agents 的 modelSettings 被翻译成 AI SDK 的调用参数，function tool 被转成 AI SDK 的工具定义。
// 好处是同一套 Agent 代码可以换任意 AI SDK provider（@ai-sdk/anthropic、@ai-sdk/google、
// OpenRouter 等），examples/ai-sdk/index.ts 就是把同样的逻辑跑在不同 provider 上。
// 代价是能力面变小：调用不再走 Responses API，适配器遇到 Programmatic Tool Calling、
// deferred function tool、function outputSchema 这些 Responses 专有特性会直接抛 UserError。
//
// 运行：pnpm -F ai-sdk start:gpt-5（@ai-sdk/openai 自己读 OPENAI_API_KEY；追踪未关闭）
import { Agent, run, tool } from '@openai/agents';
import { aisdk } from '@openai/agents-extensions/ai-sdk';
import { z } from 'zod';
import { openai } from '@ai-sdk/openai';

export async function main() {
  const getWeatherTool = tool({
    name: 'get_weather',
    description: 'Get the weather for a given city',
    parameters: z.object({ city: z.string() }),
    execute: async ({ city }) => `The weather in ${city} is sunny`,
  });
  const agent = new Agent({
    name: 'Helpful Assistant',
    instructions:
      'You are a helpful assistant. When you need to get the weather, you must use tools.',
    tools: [getWeatherTool],
    // openai('gpt-5.4') 是 AI SDK 的模型对象，aisdk() 把它包成 Agents 可用的 Model。
    model: aisdk(openai('gpt-5.4')),
    modelSettings: {
      // providerData 会被适配器原样展开进 AI SDK 的调用参数，所以这里用的是 AI SDK 的形状：
      // 按 provider key（openai）分组，字段名也是 AI SDK 的 reasoningEffort / textVerbosity，
      // 而不是 Agents 自己的 reasoning.effort / text.verbosity。
      // 设为 none / low 只是想让示例跑得快、输出短，不涉及工具链路。
      providerData: {
        providerOptions: {
          openai: {
            reasoningEffort: 'none',
            textVerbosity: 'low',
          },
        },
      },
    },
  });

  // 走普通工具调用回合：模型请求 get_weather，适配器把结果回灌后再生成最终回答。
  const result = await run(
    agent,
    'Hello what is the weather in San Francisco?',
  );
  console.log(result.finalOutput);
}

// 顶层调用：出错时打印并以退出码 1 结束。
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
