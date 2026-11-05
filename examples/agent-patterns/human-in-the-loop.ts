// 人在回路（human-in-the-loop）审批示例：演示工具调用的「暂停 → 人工批准或拒绝 → 恢复运行」。
//
// 触发点是工具的 needsApproval（异步谓词）。它返回 true 时运行时不会执行该工具，而是结束本次 run，
// 把待审批项放进 result.interruptions；你在上面做出决定后用 run(agent, state) 恢复同一次运行。
//
// 示例刻意叠了两层审批，而固定提问同时命中这两条规则：
// - 普通函数工具 get_temperature：城市名包含 Oakland 时要审批。
// - 作为工具的 weatherAgent：入参文本包含 San Francisco 时要审批。审的是「要不要启动这个子 Agent」，
//   批准之前子 Agent 一步都不会跑，它内部那个不需要审批的 get_weather 也就不会被调用。
//
// 状态先写盘再读回，是为了演示审批可以跨进程/跨线程完成：RunState 能被 JSON 序列化，恢复时再重建。
// 生成的 result.json 已经在 examples/agent-patterns/.gitignore 里，不会污染仓库。
//
// 本示例直连 OpenAI（需要 OPENAI_API_KEY），也没有关闭追踪。无人值守跑法：设 AUTO_APPROVE_HITL=1。
// This local CLI trusts its saved state. Browser/mobile approval UIs should keep
// snapshots on the server; see human-in-the-loop-server.ts in agent-patterns.
import { z } from 'zod';
import readline from 'node:readline/promises';
import fs from 'node:fs/promises';
import { Agent, run, tool, RunState, RunResult } from '@openai/agents';

// 子 Agent 内部使用的工具，没有 needsApproval，因此永远不需要人工介入。
const getWeatherTool = tool({
  name: 'get_weather',
  description:
    'Get weather conditions for one city. The result does not include temperature.',
  parameters: z.object({
    city: z.string().describe('City whose weather conditions to retrieve.'),
  }),
  execute: async ({ city }) => {
    return `The weather in ${city} is sunny`;
  },
});

// A specialist sub-agent that we will expose as a tool.
const weatherAgent = new Agent({
  name: 'Weather agent',
  instructions:
    'Use the available tool to report weather conditions for every requested city. Report conditions only, without temperatures.',
  handoffDescription: 'Handles weather-related queries',
  tools: [getWeatherTool],
});

// 需要审批的函数工具：审批粒度是「单次调用」，同一工具换个城市可能就不需要审批。
const getTemperatureTool = tool({
  name: 'get_temperature',
  description:
    'Get the current temperature for one city. Call separately for each requested city.',
  parameters: z.object({
    city: z.string().describe('City whose current temperature to retrieve.'),
  }),
  // 第二个参数是校验过的工具入参，这里按城市名决定要不要问人。
  needsApproval: async (_ctx, { city }) => city.includes('Oakland'),
  execute: async ({ city }) => {
    return `The temperature in ${city} is 20° Celsius`;
  },
});

// Main agent that can call the weather agent as a tool.
const agent = new Agent({
  name: 'Basic test agent',
  instructions:
    'Use the available tools to answer weather questions. Retrieve every requested kind of information for every requested city before answering.',
  tools: [
    getTemperatureTool,
    weatherAgent.asTool({
      toolName: 'ask_weather_agent',
      toolDescription:
        'Get weather conditions for one or more locations. This tool does not return temperatures.',
      // Demonstrate approvals at the agent-as-tool level.
      // Require approval when the input mentions San Francisco.
      // 审批发生在嵌套运行之前：这里的 input 是默认的单个字符串字段（没配 parameters 时都是这样）。
      needsApproval: async (_ctx, { input }) => input.includes('San Francisco'),
    }),
  ],
});

// 环境变量开关：批量跑示例时用 1 表示全部自动批准，避免卡在 readline 上。
const AUTO_APPROVE_HITL = process.env.AUTO_APPROVE_HITL === '1';

async function confirm(question: string) {
  if (AUTO_APPROVE_HITL) {
    console.log(`[auto-approve] ${question}`);
    return true;
  }
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await rl.question(`${question} (y/n): `);
  const normalizedAnswer = answer.toLowerCase();
  rl.close();
  // 只有 y / yes 算批准，其余（包括直接回车）都是拒绝。
  return normalizedAnswer === 'y' || normalizedAnswer === 'yes';
}

async function main() {
  let result: RunResult<unknown, Agent<unknown, any>> = await run(
    agent,
    'What is the weather and temperature in San Francisco and Oakland?',
  );
  let hasInterruptions = result.interruptions?.length > 0;
  while (hasInterruptions) {
    // storing
    // 序列化整个运行状态：RunState.toJSON 会带上历史、待审批项和当前 Agent，默认不含追踪密钥。
    await fs.writeFile(
      'result.json',
      JSON.stringify(result.state, null, 2),
      'utf-8',
    );

    // from here on you could run things on a different thread/process

    // reading later on
    // 反序列化时要重新绑定起始 Agent，工具查找和审批匹配都依赖它，所以传的是 agent 而不是名字。
    const storedState = await fs.readFile('result.json', 'utf-8');
    const state = await RunState.fromString(agent, storedState);

    for (const interruption of result.interruptions) {
      const confirmed = await confirm(
        `Agent ${interruption.agent.name} would like to use the tool ${interruption.name} with "${interruption.arguments || 'no arguments'}". Do you approve?`,
      );

      if (confirmed) {
        state.approve(interruption);
      } else {
        // 拒绝不会抛错：运行时把一条拒绝说明作为工具输出回给模型，由它决定怎么继续回答。
        state.reject(interruption);
      }
    }

    // resume execution of the current state
    // 一次恢复会处理上面所有已决定的审批项；恢复后仍可能冒出新审批，所以外层是 while。
    result = await run(agent, state);
    hasInterruptions = result.interruptions?.length > 0;
  }

  console.log(result.finalOutput);
}

// 顶层调用：出错时打印并以退出码 1 结束。
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
