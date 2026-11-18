import { Agent, run, tool, withTrace } from '@openai/agents';
import { z } from 'zod';

async function main() {
  await withTrace('Agents as tools streaming example', async () => {
    const billingStatusCheckerTool = tool({
      name: 'Billing status checker',
      description:
        'You are a billing agent that answers questions about billing.',
      parameters: z.object({
        customerId: z.string().nullable().optional(),
        question: z.string(),
      }),
      // 纯函数工具：不调用模型，只执行本地逻辑。
      execute: async ({ customerId, question }) => {
        console.log(`Customer ID: ${customerId} Question: ${question}`);
        if (question.toLowerCase().includes('bill')) {
          return `This customer (ID: ${customerId})'s bill is $100`;
        }
        return `I'm sorry, I can only answer questions about billing.`;
      },
    });
    // 调用链是：`mainAgent` 模型决策 → 调用`billingAgentTool` → SDK 运行`subAgent`
    // →`subAgent` 调用模型 →`subAgent` 调用`billingStatusCheckerTool` （纯函数，无模型）
    const subAgent = new Agent({
      name: 'Billing Agent',
      instructions:
        'You are a billing agent that answers questions about billing.',
      modelSettings: { toolChoice: 'required' },
      tools: [billingStatusCheckerTool],
    });

    // 当 mainAgent 调用 billing_agent 工具时，SDK 会运行 subAgent，
    // 这是第二次模型调用（toolChoice: 'required' 强制它必须调用 billingStatusCheckerTool）。
    const billingAgentTool = subAgent.asTool({
      toolName: 'billing_agent',
      toolDescription:
        'You are a billing agent that answers questions about billing.',
      // When you pass onStream handler, the agent is executed in streaming mode.
      onStream: (event) => {
        console.log(
          `### onStream method streaming event from ${event.agent.name} in streaming mode:\n\n` +
            JSON.stringify(event) +
            '\n',
        );
      },
    });
    // Alternative way to listen to streaming events:
    // Event types: raw_model_stream_event, run_item_stream_event, agent_updated_stream_event
    /*
    billingAgentTool.on('raw_model_stream_event', (event) => {
      console.log(
        `### on method streaming event from ${event.agent.name} in streaming mode:\n\n` +
        JSON.stringify(event) +
        '\n',
      );
    });
    */

    const mainAgent = new Agent({
      name: 'Customer Support Agent',
      instructions:
        'You are the customer support agent that calls the billing agent to answer a user question.',
      tools: [billingAgentTool],
    });
    // 第一次模型调用：run() 触发 mainAgent 推理，模型决定调用 billing_agent 工具，
    // 工具返回结果后模型再生成最终回复。
    const result = await run(
      mainAgent,
      'Hello, my customer ID is ABC123. How much is my bill for this month?',
    );

    console.log(`\n### Final response:\n\n${result.finalOutput}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/**
 * 从 run() 开始的完整执行过程（共 4 次模型调用）：
 *
 * run(mainAgent, "Hello, my customer ID is ABC123. How much is my bill for this month?")
 * │
 * ├─ [第 1 次模型调用]mainAgent：模型收到用户问题，决定调用 billing_agent 工具。
 * │
 * ├─ billing_agent 工具触发：SDK 运行 subAgent（被 asTool 包装的那个 Agent）。
 * │   │
 * │   ├─ [第 2 次模型调用]subAgent 第 1 轮：toolChoice: 'required' 强制模型必须调用工具，
 * │   │       模型从输入中提取 { customerId: "ABC123", question: "...bill..." } 参数。
 * │   │
 * │   ├─ 纯函数执行：billingStatusCheckerTool.execute() 不调用模型，
 * │   │       按本地逻辑返回 "This customer (ID: ABC123)'s bill is $100"。
 * │   │
 * │   └─ [第 3 次模型调用]subAgent 第 2 轮：模型拿到函数结果，生成自然语言作为
 * │           subAgent 最终输出，即 billing_agent 工具返回给 mainAgent 的结果。
 * │
 * └─ [第 4 次模型调用]mainAgent 第 2 轮：模型拿到工具结果，生成最终回复给用户。
 */
