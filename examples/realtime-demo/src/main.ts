// 浏览器端 Realtime 语音 Agent demo（Vite 构建）。
// 两个 RealtimeAgent（Greeter + Weather Agent）通过双向 handoff 协作；
// RealtimeSession 用 ephemeral token 连接 OpenAI Realtime API，浏览器做 WebRTC 音频采集/播放。
// @ts-expect-error TypeScript does not know about the CSS module
import './style.css';
import {
  connectButton,
  disconnectButton,
  log,
  muteButton,
  setButtonStates,
} from './utils';

import { z } from 'zod';
import { RealtimeAgent, RealtimeSession, tool } from '@openai/agents-realtime';

// 天气查询工具：本地模拟，不联网，直接返回固定文案。
const getWeather = tool({
  name: 'getWeather',
  description: 'Get the weather for a given city',
  parameters: z.object({
    city: z.string(),
  }),
  execute: async ({ city }) => {
    return `The weather in ${city} is sunny`;
  },
});

// 天气专家 Agent：带 getWeather 工具，handoffDescription 是主 Agent 决定是否转交的依据。
const weatherAgent = new RealtimeAgent({
  name: 'Weather Agent',
  instructions: 'You are a weather expert.',
  handoffDescription: 'You can handoff to the weather agent if you need to.',
  tools: [getWeather],
});

// 主 Agent（Greeter）：会话入口，可转交给 weatherAgent。
const agent = new RealtimeAgent({
  name: 'Greeter',
  instructions:
    'You are a greeter. Always greet the user with a "top of the morning"',
  handoffs: [weatherAgent],
});

// weatherAgent 创建时拿不到 agent 引用，这里事后补上反向转交，形成双向 handoff。
weatherAgent.handoffs.push(agent);

// 以 agent 为入口建立实时会话；connect 时才真正连接 Realtime API。
const session = new RealtimeSession(agent);

// transport_event 是底层 Realtime API 服务端直发的事件（转写、音频、工具调用等），log 到页面供观察。
session.on('transport_event', (event) => {
  // this logs the events coming directly from the Realtime API server
  log(event);
});

// 连接：粘贴 ephemeral token → session.connect 建立 WebRTC 音频通道。
connectButton.addEventListener('click', async () => {
  const apiKey = prompt(
    'Enter ephemeral API key. Run `pnpm -F realtime-demo generate-token` to get a token.',
  );
  if (!apiKey) {
    return;
  }
  await session.connect({
    apiKey,
  });
  setButtonStates('unmuted');
});

// 断开：关闭会话和底层连接。
disconnectButton.addEventListener('click', () => {
  session.close();
  setButtonStates('disconnected');
});

// 静音切换：只开关本地麦克风，不影响播放；会话保持连接。
muteButton.addEventListener('click', () => {
  const newMutedState = !session.muted;
  session.mute(newMutedState);
  setButtonStates(newMutedState ? 'muted' : 'unmuted');
});
