// 强制使用工具（forcing tool use）示例：演示 Agent 级配置 toolUseBehavior 的三种收尾方式。
//
// 同一个天气 Agent、同一个问题，用命令行参数切换行为后对比 finalOutput 从哪来：
// - default（run_llm_again）：工具结果回灌给模型，最终回答由模型再生成一轮，措辞不受你控制。
// - first_tool（stop_on_first_tool）：直接拿第一个工具的输出收尾，模型不再处理，省一次调用；
//   代价是非字符串的返回值会被原样序列化成 JSON 文本，展示效果差。
// - custom（自定义函数）：由你的代码在拿到工具结果列表后决定停不停、最终文本怎么写。
//
// 顺带演示 toolChoice: 'required' 的用处：后两种行为只有在模型真的调了工具时才有结果可用，
// 强制调用可以避免模型直接文本回答导致示例「看不出行为差异」。

import {
  Agent,
  tool,
  run,
  type ToolsToFinalOutputResult,
  type ToolToFinalOutputFunction,
  type ModelSettings,
  RunContext,
  type FunctionToolResult,
  type ToolUseBehavior,
} from '@openai/agents';
import { z } from 'zod';

// 假天气数据的形状；execute 返回对象而不是字符串，正好能看出不同行为怎么处理非文本结果。
type Weather = {
  city: string;
  temperature_range: string;
  conditions: string;
};

// 普通函数工具（不是 asTool 包装的子 Agent），参数由模型按 schema 填写。
const getWeather = tool({
  name: 'get_weather',
  description: 'Get the weather for a given city',
  parameters: z.object({
    city: z.string(),
  }),
  execute: async ({ city }): Promise<Weather> => {
    return {
      city,
      temperature_range: '14-20C',
      conditions: 'Sunny with wind',
    };
  },
});

// 自定义收尾逻辑：运行时把本轮所有工具结果交给这个函数，由它决定是否就此结束。
const customToolUseBehavior: ToolToFinalOutputFunction = async (
  _context: RunContext,
  results: FunctionToolResult[],
): Promise<ToolsToFinalOutputResult> => {
  // First function_output result
  // results 里除了 function_output 还可能出现审批请求项，所以要挑出真正带返回值的那一条。
  console.log(results);
  const outputResult = results.find((r) => r.type === 'function_output');
  if (!outputResult) {
    // isFinalOutput 为 false 表示「别停」，把工具输出交回模型继续跑。
    return { isFinalOutput: false, isInterrupted: undefined };
  }
  // output 的类型是宽松的，这里按本示例已知的 Weather 形状断言一下。
  const weather = outputResult.output as Weather;
  return {
    isFinalOutput: true,
    // isInterrupted 只在审批中断时才是 true，其余情况必须显式写 undefined（类型是三选一的联合）。
    isInterrupted: undefined,
    // finalOutput 必须是字符串，还会再按 Agent 的 outputType 解析；这里没设 outputType，即纯文本。
    finalOutput: `${weather.city} is ${weather.conditions}.`,
  };
};

async function main(
  toolUseBehaviorOption: 'default' | 'first_tool' | 'custom' = 'default',
) {
  let toolUseBehavior: ToolUseBehavior;
  let modelSettings: ModelSettings = {};

  if (toolUseBehaviorOption === 'default') {
    // 默认行为：不限制 toolChoice，模型可自行决定调不调工具，调完还要再生成一轮回答。
    toolUseBehavior = 'run_llm_again';
    modelSettings = {};
  } else if (toolUseBehaviorOption === 'first_tool') {
    // 第一个工具输出直接作为最终结果；强制调用工具，才保证一定有这样的输出可用。
    toolUseBehavior = 'stop_on_first_tool';
    modelSettings = { toolChoice: 'required' };
  } else {
    // 自定义函数收尾；同样强制调用工具，否则模型直接文本作答时根本走不到这个回调。
    toolUseBehavior = customToolUseBehavior;
    modelSettings = { toolChoice: 'required' };
  }

  // toolUseBehavior 是 Agent 级配置，跟 modelSettings 一样在定义时就固定下来。
  const agent = new Agent({
    name: 'Weather agent',
    instructions: 'You are a helpful agent.',
    tools: [getWeather],
    toolUseBehavior,
    modelSettings,
  });

  const result = await run(agent, "What's the weather in Tokyo?");
  console.log(result.finalOutput);
}

// CLI argument parsing
// 只识别 -t / --tool-use-behavior，取值非法就打印提示并退出，方便手动对比三种行为。
const args = process.argv.slice(2);
let toolUseBehavior: 'default' | 'first_tool' | 'custom' = 'default';
const flagIndex = args.findIndex(
  (arg) => arg === '-t' || arg === '--tool-use-behavior',
);

if (flagIndex !== -1) {
  const value = args[flagIndex + 1];
  if (!value) {
    console.error(
      'Missing value for --tool-use-behavior. Use one of: default, first_tool, custom.',
    );
    process.exit(1);
  }
  if (value === 'default' || value === 'first_tool' || value === 'custom') {
    toolUseBehavior = value;
  } else {
    console.error('Invalid tool use behavior:', value);
    console.error(
      'Valid options: default (send tool outputs back to the model), first_tool (use the first tool result as the final output), custom (run a custom tool use behavior).',
    );
    process.exit(1);
  }
}

// 顶层调用：出错时打印并以退出码 1 结束。
main(toolUseBehavior).catch((error) => {
  console.error(error);
  process.exit(1);
});
