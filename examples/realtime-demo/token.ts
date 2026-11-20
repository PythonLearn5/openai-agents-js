// Node 脚本：用服务端 OPENAI_API_KEY 生成 Realtime 短期 ephemeral token，打印给用户粘贴到浏览器。
// 这样浏览器端不持有长期密钥，只拿短期凭证连接 Realtime API。
import OpenAI from 'openai';

async function generateToken() {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  // 创建 Realtime 短期凭证：指定 realtime 类型和模型，返回的 session.value 就是 ephemeral token。
  const session = await openai.realtime.clientSecrets.create({
    session: {
      type: 'realtime',
      model: 'gpt-realtime-2.1',
    },
  });

  console.log(session.value);
}

generateToken().catch((err) => {
  console.error('Failed to create ephemeral token', err);
  process.exit(1);
});
