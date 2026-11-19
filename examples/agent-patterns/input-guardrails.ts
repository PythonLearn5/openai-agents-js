// 输入护栏（input guardrail）示例：在客服 Agent 真正作答之前，先用另一个 Agent 判断用户输入是否越界。
//
// 护栏的契约只有一条：execute 返回 GuardrailFunctionOutput，即 { tripwireTriggered, outputInfo }。
// tripwireTriggered 为 true 时运行时会中止本次 run 并抛 InputGuardrailTripwireTriggered，
// 主 Agent 的结果不会返回；为 false 时正常放行。outputInfo 不参与判断，只把判定依据带进异常和追踪。
//
// 本例用 LLM 做判定：guardrailAgent 靠 outputType（Zod schema）返回结构化布尔，比解析自由文本可靠。
// 检查逻辑换成规则、正则或外部审核接口都可以，护栏接口不变。
//
// 输入护栏默认与主 Agent 并发执行（runInParallel 默认为 true），省延迟但拦不住已经花掉的 token；
// 设 runInParallel: false 可让护栏先跑完再启动主 Agent，用延迟换更硬的拦截边界。
import {
  Agent,
  InputGuardrailTripwireTriggered,
  run,
  withTrace,
} from '@openai/agents';
import { z } from 'zod';

async function main() {
  await withTrace('Input Guardrail Example', async () => {
    // 只做判定的子 Agent：没有工具，outputType 强制它返回 { isMathHomework: boolean }。
    const guardrailAgent = new Agent({
      name: 'Guardrail agent',
      instructions:
        'Check if the user is asking you to do their math homework.',
      outputType: z.object({ isMathHomework: z.boolean() }),
    });

    const agent = new Agent({
      name: 'Customer support agent',
      instructions:
        'You are a customer support agent. You help customers with their questions.',
      // 挂在业务 Agent 上的输入护栏；每项是 { name, execute }，name 用于追踪和日志展示。
      inputGuardrails: [
        {
          name: 'Math Homework Guardrail',
          // execute 收到被检查的 agent、本次 run 的原始 input 和运行 context。
          execute: async ({ input, context }) => {
            // 复用同一个 context 跑护栏 Agent，让护栏与主流程共享上下文并归入同一条追踪。
            const result = await run(guardrailAgent, input, { context });
            return {
              // finalOutput 按 outputType 解析后的结构化结果；模型没产出时按不放行处理。
              tripwireTriggered: result.finalOutput?.isMathHomework ?? false,
              outputInfo: result.finalOutput,
            };
          },
        },
      ],
    });

    // shouldTrip 是期望：命中护栏的输入应当抛异常，而不是拿到一段回答。
    const cases = [
      {
        // 加利福尼亚州的首府是什么？
        input: 'What is the capital of California?',
        shouldTrip: false,
      },
      {
        input: 'Can you help me solve for x: 2x + 5 = 11?',
        shouldTrip: true,
      },
    ];
    for (const { input, shouldTrip } of cases) {
      try {
        const result = await run(agent, input);
        if (shouldTrip) {
          throw new Error(`Expected the guardrail to trip for: ${input}`);
        }
        // 未命中护栏：主 Agent 正常作答。
        console.log(result.finalOutput);
      } catch (e: unknown) {
        // 护栏拦截是通过异常表达的；其它错误（缺 API Key、模型报错等）不是本示例要断言的行为。
        if (!(e instanceof InputGuardrailTripwireTriggered)) {
          throw e;
        }
        if (!shouldTrip) {
          throw new Error(`Guardrail unexpectedly tripped for: ${input}. ${e}`);
        }
        // e.result 里带 guardrail.name 和 outputInfo，生产代码可据此换成提示文案或转人工。
        console.log(
          `Sorry, I can't help you with your math homework. (error: ${e})`,
        );
      }
    }
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
