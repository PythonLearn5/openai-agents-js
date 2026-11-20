// memory.ts 的 HITL（人工介入）升级版：在 MemorySession 跨轮记忆的基础上，把 lookup_customer_profile
// 标记为每次调用都需人工审批，演示「工具审批中断 → 人工 approve/reject → 用 RunState 续跑」的循环。
// fetch_image_data 没设 needsApproval，所以免审。session 跨轮、跨中断续跑都共享，审批期间累积的历史也留着。
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  Agent,
  MemorySession,
  RunResult,
  RunToolApprovalItem,
  run,
  withTrace,
} from '@openai/agents';

import type { Interface as ReadlineInterface } from 'node:readline/promises';
import { createLookupCustomerProfileTool, fetchImageData } from './tools.ts';
import { runAutoTurn } from './auto-mode.ts';

// AUTO_APPROVE_HITL=1 让 promptYesNo 直接返回 true，用于自动化跑审批流；AUTO_MODE 跑一条预设消息后退出。
const AUTO_APPROVE_HITL = process.env.AUTO_APPROVE_HITL === '1';
const AUTO_MODE = process.env.EXAMPLES_INTERACTIVE_MODE === 'auto';
const AUTO_MESSAGE = 'Fetch profile for customer 101.';

const customerDirectory: Record<string, string> = {
  '101':
    // 客户 1（金等级）。备注：喜欢短信跟进和简洁的摘要。
    'Customer Kaz S. (tier gold) can be reached at +1-415-555-AAAA. Notes: Prefers SMS follow ups and values concise summaries.',
  '104':
    // 客户 4（白金等级）。备注：最近报告了同步问题。已电话。
    'Customer Yu S. (tier platinum) can be reached at +1-415-555-BBBB. Notes: Recently reported sync issues. Flagged for a proactive onboarding call.',
  '205':
    // 客户 5（标准等级）。备注：对自动化教程感兴趣。
    'Customer Ken S. (tier standard) can be reached at +1-415-555-CCCC. Notes: Interested in automation tutorials sent last week.',
};

const lookupCustomerProfile = createLookupCustomerProfileTool({
  directory: customerDirectory,
  transientErrorMessage:
    // 模拟的CRM系统故障。请重试工具调用。
    'Simulated CRM outage for the first lookup. Please retry the tool call.',
});
// 把这个工具标记为每次调用都需人工批准：运行时遇到它就中断 run，把调用项放进 result.interruptions，工具不执行。
lookupCustomerProfile.needsApproval = async () => true;

// 指令要求每轮先调两个工具再回答；注意「审批」不是模型触发的，而是 needsApproval 让运行时中断的。
// tools.ts 里第一次 lookup 必然抛 transient error，所以正常路径会经历：中断→审批→执行→报错→模型重试一次。
const instructions =
  // 你是一个支持代理，负责处理客户支持请求。
  'You assist support agents. For every user turn you must call lookup_customer_profile and fetch_image_data before responding so replies include stored notes and the sample image. If a tool reports a transient failure, request approval and retry the same call once before responding. Keep responses under three sentences.';

function formatToolArguments(interruption: RunToolApprovalItem): string {
  const args = interruption.arguments;
  if (!args) {
    return '';
  }
  if (typeof args === 'string') {
    return args;
  }
  try {
    return JSON.stringify(args);
  } catch {
    return String(args);
  }
}

async function promptYesNo(
  rl: ReadlineInterface,
  question: string,
): Promise<boolean> {
  if (AUTO_APPROVE_HITL) {
    console.log(`[auto-approve] ${question}`);
    return true;
  }
  const answer = await rl.question(`${question} (y/n): `);
  const normalized = answer.trim().toLowerCase();
  return normalized === 'y' || normalized === 'yes';
}

// HITL 循环核心：run 返回的 interruptions 是等待审批的工具调用项（RunToolApprovalItem）。
// 逐个问 y/n → approve（运行时随后执行工具）或 reject（工具不执行，模型拿到拒绝信号继续），
// 然后用 run(agent, result.state, { session }) 续跑——传 RunState 而不是文本，从中断点继续而非重新开始。
// while 循环是因为续跑后可能又产生新的需审批调用。
async function resolveInterruptions(
  rl: ReadlineInterface,
  agent: Agent<any, any>,
  initialResult: RunResult<any, any>,
  session: MemorySession,
): Promise<RunResult<any, any>> {
  let result = initialResult;
  while (result.interruptions?.length) {
    for (const interruption of result.interruptions) {
      const args = formatToolArguments(interruption);
      const approved = await promptYesNo(
        rl,
        `Agent ${interruption.agent.name} wants to call ${interruption.name} with ${args || 'no arguments'}`,
      );
      if (approved) {
        // approve 后中断的工具才会真正执行；可选 alwaysApprove 让本 run 内后续同名调用免审。
        result.state.approve(interruption);
        console.log('Approved tool call.');
      } else {
        // reject 后工具不执行，模型会收到拒绝信号并据此决定下一步（重试或换方案）。
        result.state.reject(interruption);
        console.log('Rejected tool call.');
      }
    }

    // 用 RunState 续跑：中断点之后的模型轮次继续，session 继续累积历史。
    result = await run(agent, result.state, { session });
  }

  return result;
}

async function main() {
  await withTrace('memory:memory-hitl:main', async () => {
    const agent = new Agent({
      name: 'Memory HITL assistant',
      instructions,
      modelSettings: { toolChoice: 'required' },
      tools: [lookupCustomerProfile, fetchImageData],
    });

    const session = new MemorySession();
    const sessionId = await session.getSessionId();
    const rl = readline.createInterface({ input, output });

    if (AUTO_MODE) {
      // Automated example run helper; safe to ignore in normal usage.
      await runAutoTurn(
        agent,
        session,
        resolveInterruptions,
        AUTO_MESSAGE,
        console.log,
      );
      rl.close();
      return;
    }

    console.log(`Session id: ${sessionId}`);
    console.log(
      // 提示用户输入消息与代理交互。
      'Enter a message to chat with the agent. Submit an empty line to exit.',
    );

    while (true) {
      const userMessage = await rl.question('You: ');
      if (!userMessage.trim()) {
        break;
      }

      // 先正常跑一轮：若工具需审批，run 会在执行前中断并把调用项放进 result.interruptions。
      let result = await run(agent, userMessage, { session });
      // 人工逐个审批后用 RunState 续跑，直到没有未决的中断项。
      result = await resolveInterruptions(rl, agent, result, session);

      const reply = result.finalOutput ?? '[No final output produced]';
      console.log(`Assistant: ${reply}`);
      console.log();
    }

    rl.close();
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
