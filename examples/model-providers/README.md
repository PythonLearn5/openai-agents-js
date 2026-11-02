# Model Providers Examples

This directory contains small scripts showing how to integrate custom model providers. Run them with `pnpm` using the commands shown below.

- `custom-example-agent.ts` – Pass a model instance directly to an `Agent`.
  ```bash
  pnpm -F model-providers start:custom-example-agent
  ```
- `custom-example-global.ts` – Configure a global model provider. Requires environment variables `EXAMPLE_BASE_URL`, `EXAMPLE_API_KEY`, and `EXAMPLE_MODEL_NAME`.
  ```bash
  pnpm -F model-providers start:custom-example-global
  ```
- `custom-example-provider.ts` – Create a custom `ModelProvider` for a single run (same environment variables as above).
  ```bash
  pnpm -F model-providers start:custom-example-provider
  ```
- `ai-gateway.ts` – Reusable `AiGatewayProvider` that routes model calls through Vercel AI Gateway instead of calling OpenAI directly. It wraps `OpenAIProvider` with the gateway's OpenAI-compatible Chat Completions endpoint (`https://ai-gateway.vercel.sh/v1`), so model names must be gateway slugs such as `openai/gpt-5.4`. This file exports a class rather than running a scenario; see `examples/agent-patterns/agents-as-tools.ts` for a caller. Requires environment variables `AI_GATEWAY_API_KEY` and `AI_GATEWAY_MODEL`, or an explicit `apiKey` and `model` in the constructor options.
  ```ts
  import { Runner, setDefaultModelProvider } from '@openai/agents';
  import { AiGatewayProvider } from '../model-providers/ai-gateway.ts';

  const gatewayProvider = new AiGatewayProvider();
  setDefaultModelProvider(gatewayProvider); // or new Runner({ modelProvider: gatewayProvider })
  ```

## Runtime requirements

Use Node.js 22.18 or later within the 22.x line, Node.js 24.x, or Node.js 26 or later. The following commands execute TypeScript directly with Node.js: `start:custom-example-agent`.
