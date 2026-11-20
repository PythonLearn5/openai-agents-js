// 多 Agent 客服示例（航空场景）：分诊 Agent 把对话转交给 FAQ Agent 或选座 Agent，两者各带一个工具，外层用 CLI 循环对话。
//
// 转交（handoff）不需要自己写路由代码：运行时把 handoffs 里每个目标 Agent 暴露成 transfer_to_<agent_name> 工具，
// 由模型自行决定调用；handoffDescription 是模型做这个判断的唯一依据，要写清各 Agent 的职责边界。
//
// context 是跨工具、跨 Agent 共享的业务对象：每轮 run 用 { context } 传入，工具从 RunContext.context 读写它，
// 因此选座结果能在多轮之间留住。
//
// 多轮记忆在本示例里是手工回填的：把上一轮 result.history 当下一轮的输入，并用 result.lastAgent 决定谁来接话。
// 更省事的等价写法是给 run 传 session；这里显式管理，是为了让对话状态在代码里看得见。
//
// 直连 OpenAI，需要 OPENAI_API_KEY；追踪默认开启。
import { z } from 'zod';
import readline from 'node:readline/promises';
import { Agent, withTrace, tool, run, RunContext } from '@openai/agents';
import { RECOMMENDED_PROMPT_PREFIX } from '@openai/agents-core/extensions';

// ------------------------------------------------
// Context

// 会话状态，字段都先缺省，由工具在对话推进过程中填上。
interface AirlineAgentContext {
  passengerName?: string;
  confirmationNumber?: string;
  seatNumber?: string;
  flightNumber?: string;
}

// ------------------------------------------------
// Tools

// FAQ lookup tool
const faqLookupTool = tool({
  name: 'faq_lookup_tool',
  description: 'Lookup frequently asked questions.',
  // parameters 是模型侧的函数签名：Zod schema 决定它要填哪些字段，execute 拿到的是校验过的对象。
  parameters: z.object({
    question: z.string(),
  }),
  async execute(input: { question: string }) {
    const q = input.question.toLowerCase();
    // 去掉空格、连字符和下划线，好让 "Wi-Fi"、"free wifi" 这类写法都能命中同一个关键词。
    const compactQuestion = q.replace(/[\s\p{Pd}_]+/gu, '');
    if (q.includes('bag') || q.includes('baggage')) {
      return (
        'You are allowed to bring one bag on the plane. ' +
        'It must be under 50 pounds and 22 inches x 14 inches x 9 inches.'
      );
    } else if (compactQuestion.includes('wifi')) {
      return 'We have free wifi on the plane, join Airline-Wifi';
    } else if (q.includes('seats') || q.includes('plane')) {
      return (
        'There are 120 seats on the plane. ' +
        'There are 22 business class seats and 98 economy seats. ' +
        'Exit rows are rows 4 and 16. ' +
        'Rows 5-8 are Economy Plus, with extra legroom. '
      );
    }
    return "I'm sorry, I don't know the answer to that question.";
  },
});

// Mock update_seat tool
const updateSeat = tool({
  name: 'update_seat',
  description: 'Update a seat on a flight',
  parameters: z.object({
    confirmationNumber: z.string(),
    seatNumber: z.string(),
  }),
  async execute(
    input: { confirmationNumber: string; seatNumber: string },
    context?: RunContext<AirlineAgentContext>,
  ) {
    // execute 的第二个参数是本次运行的 RunContext，真正的业务对象在它的 .context 上；
    // 这里直接改字段，外层 main 循环持有的那个 context 就跟着更新了。
    if (context && context.context) {
      context.context.seatNumber = input.seatNumber;
      context.context.confirmationNumber = input.confirmationNumber;
    }
    // 返回值会作为工具输出回灌给模型，所以写成模型能直接复述给客户的句子。
    return `Seat updated to ${input.seatNumber} for confirmation ${input.confirmationNumber}`;
  },
});

// ------------------------------------------------
// Agents

// FAQ Agent
const faqAgent = new Agent({
  name: 'FAQ Agent',
  handoffDescription:
    'A helpful agent that can answer questions about the airline.',
  // RECOMMENDED_PROMPT_PREFIX 告知模型自己处于多 Agent 系统中、转交由后台完成，别在回复里提转交这件事。
  instructions: `${RECOMMENDED_PROMPT_PREFIX}
You are an FAQ agent. If you are speaking to a customer, you probably were transferred to from the triage agent.
Use the following routine to support the customer.

# Routine
1. Identify the last question asked by the customer.
2. Use the faq lookup tool to answer the question. Do not rely on your own knowledge.
3. If you cannot answer the question, transfer back to the triage agent
`,
  tools: [faqLookupTool],
});

// Seat Booking Agent
// 泛型参数把上面的 context 类型绑到本 Agent，工具拿到的 RunContext.context 才是强类型的。
const seatBookingAgent = new Agent<AirlineAgentContext>({
  name: 'Seat Booking Agent',
  handoffDescription: 'A helpful agent that can update a seat on a flight.',
  instructions: `${RECOMMENDED_PROMPT_PREFIX}
You are a seat booking agent. If you are speaking to a customer, you probably were transferred to from the triage agent.
Use the following routine to support the customer.

# Routine
1. Ask for their confirmation number.
2. Ask the customer what their desired seat number is.
3. Use the update seat tool to update the seat on the flight.
If the customer asks a question that is not related to the routine, transfer back to the triage agent.`,
  tools: [updateSeat],
});

// Triage Agent
// 用 Agent.create 而不是 new Agent：它会把 handoffs 里各目标 Agent 的输出类型自动推断成联合类型。
const triageAgent = Agent.create({
  name: 'Triage Agent',
  handoffDescription:
    "A triage agent that can delegate a customer's request to the appropriate agent.",
  instructions: `${RECOMMENDED_PROMPT_PREFIX}
  You are a helpful triaging agent. You can use your tools to delegate questions to other appropriate agents.`,
  // 只给分诊 Agent 配 handoffs：它的职责就是分流，不带业务工具。
  handoffs: [faqAgent, seatBookingAgent],
});

// Make sure agents can handoff to each other
// 子 Agent 的指令里都写了「答不了就转回分诊」，但 faqAgent/seatBookingAgent 先于 triageAgent 创建，
// 拿不到它的引用，所以只能在 triageAgent 建好后回填 handoffs，形成双向转交。
faqAgent.handoffs = [triageAgent];
seatBookingAgent.handoffs = [triageAgent];

// ------------------------------------------------
// Main function

// CLI runner loop
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function promptUser(query: string): Promise<string | null> {
  try {
    return await rl.question(query);
  } catch (error: any) {
    // stdin 已关闭时 question() 抛这个错，返回 null 表示「拿不到更多输入了」，让循环收尾。
    if (error?.code === 'ERR_USE_AFTER_CLOSE') {
      return null;
    }
    throw error;
  }
}

function isExitCommand(input: string): boolean {
  const normalized = input.trim().toLowerCase();
  return normalized === 'exit' || normalized === 'quit';
}

async function main() {
  try {
    let currentAgent = triageAgent;
    const context: AirlineAgentContext = {};
    let inputItems: any[] = [];
    while (true) {
      const userInput = await promptUser('Enter your message: ');
      if (userInput === null || isExitCommand(userInput)) {
        return;
      }

      // 每轮对话单独开一条 trace，便于在追踪面板里按轮次区分。
      await withTrace('Customer service', async () => {
        inputItems.push({ content: userInput, role: 'user' });
        // 整段历史 + 新的一句作为输入交给 currentAgent；{ context } 把共享状态传进本次运行。
        const result = await run(currentAgent, inputItems, { context });

        // result.output 是本轮新生成的输出项；打印 context 能看出工具的写入落到了共享对象上。
        console.log(
          '-----------------------------------------------------------',
        );
        console.log(`result.output: ${JSON.stringify(result.output, null, 2)}`);
        console.log(`context: ${JSON.stringify(context, null, 2)}`);
        console.log(
          '-----------------------------------------------------------',
        );

        // newItems 与 output 的区别是它带 Agent 归属，适合打过程日志；按 RunItem 的 type 分支处理。
        for (const newItem of result.newItems) {
          // Type guards for RunItem discriminated union
          if (newItem.type === 'message_output_item') {
            const agentName = (newItem as any).agent?.name || 'Agent';
            console.log(`${agentName}: ${newItem.content}`);
          } else if (newItem.type === 'handoff_output_item') {
            // 转交完成项：sourceAgent/targetAgent 用来说明对话实际控制权发生了转移。
            const handoffItem = newItem as any;
            console.log(
              `Handed off from ${handoffItem.sourceAgent.name} to ${handoffItem.targetAgent.name}`,
            );
          } else if (newItem.type === 'tool_call_item') {
            const agentName = (newItem as any).agent?.name || 'Agent';
            console.log(`${agentName}: Calling a tool`);
          } else if (newItem.type === 'tool_call_output_item') {
            const agentName = (newItem as any).agent?.name || 'Agent';
            console.log(
              `${agentName}: Tool call output: ${(newItem as any).output}`,
            );
          } else {
            // 其余运行项（如 handoff_call_item、reasoning_item）本示例只记一笔，不做展示。
            const agentName = (newItem as any).agent?.name || 'Agent';
            console.log(`${agentName}: Skipping item: ${newItem.type}`);
          }
        }
        // Defensive: check if history and lastAgent exist
        // history 已把本轮输入和生成项拍平成可直接续跑的入参；lastAgent 是本轮最后接话的 Agent，
        // 存下来就能实现「谁收尾谁来接下一句」，用户不必每轮重新走一遍分诊。
        if ((result as any).history) {
          inputItems = (result as any).history;
        }
        if ((result as any).lastAgent) {
          currentAgent = (result as any).lastAgent;
        }
      });
    }
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
