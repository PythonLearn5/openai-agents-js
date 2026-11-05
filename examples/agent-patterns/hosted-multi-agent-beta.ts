// Hosted Multi-agent（Beta）示例：子 Agent 由 OpenAI 服务端创建和编排，而不是本地 SDK 的 Agent 对象。
//
// 与 agents-as-tools 系列的区别：那边是本地嵌套运行（SDK 起一个新 run 跑子 Agent）；
// 这里只注册一个根 Agent，instructions 让模型「自己派生子 Agent」，编排、并发、回合都在 OpenAI 服务端完成。
// 开启方式是 OpenAIHostedMultiAgentModel：它继承 OpenAIResponsesModel，给请求加上 multi_agent.enabled
// 并带 OpenAI-Beta: responses_multi_agent=v1 头。
//
// 本地函数工具照样能被服务端子 Agent 调用：宿主响应会挂起等 SDK 执行工具，SDK 再通过
// response.inject 把输出注回同一条 WebSocket 响应。所以这个模型必须复用同一个实例，
// 并且用完后要 close() 释放长连接。
//
// getHostedAgentMetadata 只用于「归因」：告诉我们某个工具调用/消息出自哪个 Agent（根是 /root），
// 不参与工具路由。协作类条目（multi_agent_call 等）不会进入 SDK 的 run items，
// 想看编排过程只能用 stream 模式读原始 Responses 事件，这就是 logHostedItem 存在的原因。
//
// 运行前提：需要 OPENAI_API_KEY，且项目已开通 hosted Multi-agent beta；这里直接 new OpenAI()，
// 不走 setDefaultModelProvider，因此无法改用 Vercel AI Gateway。
// 运行：node hosted-multi-agent-beta.ts --mode stream
import OpenAI from 'openai';
import {
  Agent,
  isOpenAIResponsesRawModelStreamEvent,
  run,
  tool,
} from '@openai/agents';
import {
  OpenAIHostedMultiAgentModel,
  getHostedAgentMetadata,
} from '@openai/agents-openai/experimental/hosted-multi-agent';
import { z } from 'zod';

// 固定数据：让子 Agent 的结论可对照，不依赖模型现场编造。
const records = {
  alpha: { estimatedWeeks: 6, risk: 'medium' },
  beta: { estimatedWeeks: 8, risk: 'low' },
} as const;

// 本地函数工具。根 Agent 只声明它一次，服务端派生的每个子 Agent 都能请求调用它。
const getProposal = tool({
  name: 'get_proposal',
  description: 'Return deterministic details for a proposal.',
  parameters: z.object({ proposal: z.enum(['alpha', 'beta']) }),
  execute: async ({ proposal }, _context, details) => {
    // details 带本次调用的运行时信息（含 callId）；metadata 指出是哪个 Agent 发起的调用。
    const metadata = getHostedAgentMetadata(details);
    console.log(
      `local tool caller=${metadata?.agentName ?? 'unknown'} call_id=${details?.toolCall?.callId ?? 'unknown'} proposal=${proposal}`,
    );
    return records[proposal];
  },
});

// 服务端多 Agent 协作产生的条目类型，普通 Responses 流里不会看到。
const hostedItemTypes = new Set([
  'multi_agent_call',
  'multi_agent_call_output',
  'agent_message',
]);

/**
 * 打印流里的协作事件；非流式运行不会走到这里。
 */
function logHostedItem(item: unknown): void {
  if (!item || typeof item !== 'object') {
    return;
  }

  const type = (item as { type?: unknown }).type;
  const metadata = getHostedAgentMetadata(item);
  // message 条目既可能是子 Agent 的中间消息，也可能是根 Agent 的最终回答，靠 agentName 区分。
  const isSubagentMessage =
    type === 'message' && metadata?.agentName !== '/root';
  if (
    typeof type === 'string' &&
    (hostedItemTypes.has(type) || isSubagentMessage)
  ) {
    console.log(
      `hosted item type=${type} agent=${metadata?.agentName ?? 'unknown'}`,
    );
  }
}

// --mode stream / --mode nonstream，兼容旧写法 --stream；默认非流式。
function getMode(): 'stream' | 'nonstream' {
  const modeIndex = process.argv.indexOf('--mode');
  const mode = modeIndex === -1 ? undefined : process.argv[modeIndex + 1];
  if (mode === 'stream' || mode === 'nonstream') {
    return mode;
  }
  if (mode !== undefined) {
    throw new Error('Use --mode stream or --mode nonstream.');
  }
  return process.argv.includes('--stream') ? 'stream' : 'nonstream';
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      'Set OPENAI_API_KEY and ensure the project has hosted Multi-agent beta access.',
    );
  }

  // 模型实例贯穿整条链路复用：同一次宿主响应挂在一条 WebSocket 上，换实例就无法注回工具输出。
  // 该 model 不支持 SDK handoffs、reasoning.summary 和 max_tool_calls，也不允许并发请求。
  const model = new OpenAIHostedMultiAgentModel(new OpenAI(), 'gpt-5.6-sol');
  try {
    // 只有根 Agent；子 Agent 由服务端按 instructions 里的要求临时派生。
    const agent = new Agent({
      name: 'Hosted proposal coordinator',
      model,
      tools: [getProposal],
      instructions:
        'Create two subagents. Ask one to inspect proposal alpha and the other to inspect proposal beta. Each subagent must call get_proposal for its assigned proposal. Wait for both, then compare their duration and risk in one concise root final answer.',
    });
    const prompt = 'Compare proposal alpha with proposal beta.';

    if (getMode() === 'stream') {
      // 协作条目和子 Agent 消息会被模型层过滤掉，SDK 的 run items 只剩根 Agent 的最终回答，
      // 编排过程只能从原始 Responses 事件里看。
      const streamed = await run(agent, prompt, { stream: true });
      for await (const event of streamed) {
        if (
          isOpenAIResponsesRawModelStreamEvent(event) &&
          event.data.event.type === 'response.output_item.done'
        ) {
          logHostedItem(event.data.event.item);
        }
      }
      console.log(`\nFinal response:\n${streamed.finalOutput}`);
      return;
    }

    // 非流式：内部同样会多次往返（挂起→执行本地工具→注入→继续），只是不暴露过程事件。
    const result = await run(agent, prompt);
    console.log(`Final response:\n${result.finalOutput}`);
  } finally {
    // 必须关闭：这个模型自己持有常驻连接，不释放会一直挂着（即使正常跑完也一样）。
    await model.close();
  }
}

// 顶层调用：这个示例最常见的失败原因是项目没有 beta 权限，或所选模型不支持多 Agent。
main().catch((error) => {
  console.error(
    'Hosted Multi-agent example failed. Verify beta access and the selected model.',
  );
  console.error(error);
  process.exit(1);
});
