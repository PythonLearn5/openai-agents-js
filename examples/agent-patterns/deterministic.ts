// 确定性流程（deterministic flow）示例。
//
// 与 agents-as-tools 系列相反，这里不让模型决定下一步做什么：三个 Agent 被硬编码串成
// 「生成大纲 → 质检 → 写正文」的流水线，每一步都是普通的 run() 调用，分支由代码用 if 判断，
// 模型只在各自那一步里出力。流程因此可预测、可测试，也不会因为模型自作主张而跳步。
//
// 关键设计是 outlineCheckerAgent 的 outputType：用 zod 声明 good_quality / is_scifi 两个布尔字段后，
// finalOutput 就是解析好的对象，闸门才能用普通 if 分支；换成自由文本就没法可靠地判断。

import { Agent, run, withTrace } from '@openai/agents';
import { z } from 'zod';
import readline from 'node:readline/promises';

// 交互式命令行输入，方便手动运行这个示例。
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Define the agents
// 三个 Agent 各司其职，彼此不共享上下文：上一步的输出以纯文本形式作为下一步的输入传入。
const storyOutlineAgent = new Agent({
  name: 'story_outline_agent',
  instructions:
    "Generate a very short story outline based on the user's input.",
});

// 质检 Agent：唯一带结构化输出的一个，它的返回值决定流程是否继续。
const outlineCheckerAgent = new Agent({
  name: 'outline_checker_agent',
  instructions:
    'Read the given story outline, and judge the quality. Also, determine if it is a scifi story.',
  // outputType 要求模型产出符合该 schema 的 JSON，运行时解析成对象；
  // 因此 finalOutput 是 { good_quality, is_scifi } 而不是字符串。
  outputType: z.object({
    good_quality: z.boolean(),
    is_scifi: z.boolean(),
  }),
});

const storyAgent = new Agent({
  name: 'story_agent',
  instructions: 'Write a short story based on the given outline.',
});

async function main() {
  const inputPrompt = await rl.question('What kind of story do you want? ');

  // 空输入没有意义，直接失败退出，免得把空串送进模型白跑一轮。
  if (!inputPrompt) {
    throw new Error('No input prompt provided');
  }

  // withTrace 把下面三步产生的所有 span 归到同一个 trace 下，方便观察整条流水线。
  await withTrace('Deterministic story flow', async () => {
    // 1. Generate an outline
    // 每次 run() 都是一次完整且独立的运行；finalOutput 可能为 undefined，所以先判空再用。
    const outlineResult = await run(storyOutlineAgent, inputPrompt);

    if (!outlineResult.finalOutput) {
      throw new Error('No outline result');
    }

    // 只打印进度，不打印大纲正文，避免刷屏；调试时想看内容就在这里断点看 finalOutput。
    console.log('Outline generated');

    // 2. Check the outline
    // 大纲作为「用户消息」交给质检 Agent，它只评价文本本身，看不到最初的提问。
    const outlineCheckerResult = await run(
      outlineCheckerAgent,
      outlineResult.finalOutput,
    );

    const checkerOutput = outlineCheckerResult.finalOutput;
    if (!checkerOutput) {
      throw new Error('No checker output');
    }

    // 3. Add a gate to stop if the outline is not good quality or not a scifi story
    // 闸门由代码控制：任一条件不满足就停止，绝不进入第 4 步。
    // 这里的 return 只结束 withTrace 的回调，main 仍会继续走到下面的 rl.close()。
    if (!checkerOutput.good_quality) {
      console.log('Outline is not good quality, so we stop here.');
      return;
    }

    if (!checkerOutput.is_scifi) {
      console.log('Outline is not a scifi story, so we stop here.');
      return;
    }

    console.log(
      'Outline is good quality and a scifi story, so we continue to write the story.',
    );

    // 4. Write the story
    // 注意传给写手的是大纲，不是用户原始输入；用户偏好只通过大纲间接传递。
    const storyResult = await run(storyAgent, outlineResult.finalOutput);
    console.log(`Story: ${storyResult.finalOutput}`);
  });

  rl.close();
}

// 顶层调用：出错时打印并以退出码 1 结束。
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
