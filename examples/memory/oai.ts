// memory.ts 的对照版：同样两轮问答 + 两个工具，但会话换成 OpenAIConversationsSession——
// 对话历史存在 OpenAI Conversations API 服务端，本地只持有 conversationId，不再每轮把全量历史塞进请求。
// 首次 run 时自动创建 conversation，之后每轮用同一个 conversationId 续接。需要 OPENAI_API_KEY。
import {
  Agent,
  OpenAIConversationsSession,
  run,
  withTrace,
} from '@openai/agents';
import { createLookupCustomerProfileTool, fetchImageData } from './tools.ts';

const directory: Record<string, string> = {
  '1': 'Customer 1 (tier gold). Notes: Prefers concise replies.',
  '2': 'Customer 2 (tier standard). Notes: Interested in tutorials.',
};

const instructions =
  'You are a helpful assistant. For every user turn you must call lookup_customer_profile and fetch_image_data before responding.';

const lookupCustomerProfile = createLookupCustomerProfileTool({
  directory,
  transientErrorMessage:
    'Simulated transient CRM outage. Please retry the tool call.',
});

async function main() {
  await withTrace('memory:oai:main', async () => {
    const agent = new Agent({
      name: 'Assistant',
      instructions,
      modelSettings: { toolChoice: 'required' },
      tools: [lookupCustomerProfile, fetchImageData],
    });

    // 历史存服务端：第二轮只需传新问题，session 内部用 conversationId 让模型看到上一轮的上下文。
    const session = new OpenAIConversationsSession();
    let result = await run(
      agent,
      'What is the largest country in South America?',
      { session },
    );
    console.log(result.finalOutput); // e.g., Brazil

    // 「that country」指代上一轮的巴西——靠服务端 conversation 历史解析，不是本地拼接。
    result = await run(agent, 'What is the capital of that country?', {
      session,
    });
    console.log(result.finalOutput); // e.g., Brasilia
  });
}

async function mainStream() {
  await withTrace('memory:oai:mainStream', async () => {
    const agent = new Agent({
      name: 'Assistant',
      instructions,
      modelSettings: { toolChoice: 'required' },
      tools: [lookupCustomerProfile, fetchImageData],
    });

    // 流式版机制相同：session 只携带 conversationId；下方两种事件遍历只是取文本的写法不同。
    const session = new OpenAIConversationsSession();
    let result = await run(
      agent,
      'What is the largest country in South America?',
      {
        stream: true,
        session,
      },
    );

    for await (const event of result) {
      if (
        event.type === 'raw_model_stream_event' &&
        event.data.type === 'output_text_delta'
      )
        process.stdout.write(event.data.delta);
    }
    console.log();

    result = await run(agent, 'What is the capital of that country?', {
      stream: true,
      session,
    });

    // toTextStream() automatically returns a readable stream of strings intended to be displayed
    // to the user
    for await (const event of result.toTextStream()) {
      process.stdout.write(event);
    }
    console.log();

    // Additional tool invocations happen earlier in the turn.
  });
}

async function promptAndRun() {
  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const isStream = await rl.question('Run in stream mode? (y/n): ');
  rl.close();
  if (isStream.trim().toLowerCase() === 'y') {
    await mainStream();
  } else {
    await main();
  }
}

promptAndRun().catch((error) => {
  console.error(error);
  process.exit(1);
});
