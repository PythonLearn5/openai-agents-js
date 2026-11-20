import {
  Agent,
  getLogger,
  MemorySession,
  run,
  withTrace,
} from '@openai/agents';
import { createLookupCustomerProfileTool, fetchImageData } from './tools.ts';

const directory: Record<string, string> = {
  // 客户 1（黄金等级）。备注：偏好简洁的回复。
  '1': 'Customer 1 (tier gold). Notes: Prefers concise replies.',
  // 客户 2（标准等级）。备注：对教程感兴趣。
  '2': 'Customer 2 (tier standard). Notes: Interested in tutorials.',
};

const instructions =
  // 你是一个有帮助的助手。对于每个用户回合，你必须调用lookup_customer_profile和fetch_image_data工具，然后才能回答。
  'You are a helpful assistant. For every user turn you must call lookup_customer_profile and fetch_image_data before responding.';

const lookupCustomerProfile = createLookupCustomerProfileTool({
  directory,
  transientErrorMessage:
    // 模拟的CRM系统故障。请重试工具调用。
    'Simulated transient CRM outage. Please retry the tool call.',
});

async function main() {
  await withTrace('memory:memorySession:main', async () => {
    const agent = new Agent({
      name: 'Assistant',
      instructions,
      modelSettings: { toolChoice: 'required' },
      tools: [lookupCustomerProfile, fetchImageData],
    });

    const session = new MemorySession({
      logger: getLogger('memory:memory'),
    });
    let result = await run(
      agent,
      // 问题：南美洲最大的国家是哪个？
      'What is the largest country in South America?',
      { session },
    );
    // 回答：巴西。
    console.log(result.finalOutput); // e.g., Brazil.
    // 问题：巴西的首都是哪个？
    // 问题：该国家的首都是什么？
    result = await run(agent, 'What is the capital of that country?', {
      session,
    });
    // 回答：巴西利亚。
    // 回答：巴西的首都是巴西。
    console.log(result.finalOutput); // e.g., Brasilia.
  });
}

async function mainStream() {
  await withTrace('memory:memorySession:mainStream', async () => {
    const agent = new Agent({
      name: 'Assistant',
      instructions,
      modelSettings: { toolChoice: 'required' },
      tools: [lookupCustomerProfile, fetchImageData],
    });

    const session = new MemorySession();
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
      ) {
        process.stdout.write(event.data.delta);
      }
    }
    console.log();

    result = await run(agent, 'What is the capital of that country?', {
      stream: true,
      session,
    });

    for await (const event of result.toTextStream()) {
      process.stdout.write(event);
    }
    console.log();
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
