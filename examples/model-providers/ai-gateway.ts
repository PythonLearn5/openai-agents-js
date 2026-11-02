// Vercel AI Gateway 模型封装：把智能体的模型调用从 OpenAI 直连换成走 AI Gateway。
//
// AI Gateway 暴露了与 OpenAI Chat Completions 完全同规格的兼容端点，所以这里不需要新的
// 依赖，也不需要在别处改代码：只要把 OpenAIProvider 的 baseURL 指向网关，再把模型名换成
// 网关的 slug（形如 openai/gpt-5.4、anthropic/claude-sonnet-4-5）即可。
//
// 用法有两种，任选其一：
//   1. 全局替换：setDefaultModelProvider(new AiGatewayProvider())，之后所有 run() 都走网关。
//   2. 单次替换：new Runner({ modelProvider: new AiGatewayProvider() })。
import { OpenAIProvider } from '@openai/agents';
import type { Model, ModelProvider } from '@openai/agents';

// AI Gateway 的 OpenAI 兼容端点前缀。
const AI_GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh/v1';

export type AiGatewayProviderOptions = {
  // AI Gateway 的 API key。缺省时读取环境变量 AI_GATEWAY_API_KEY。
  apiKey?: string;
  // 智能体自己没有写 model 时使用的默认模型 slug。缺省时读取环境变量 AI_GATEWAY_MODEL。
  model?: string;
};

/**
 * 一个 ModelProvider：所有模型名都交给 AI Gateway 解析。
 */
export class AiGatewayProvider implements ModelProvider {
  // 解析后的默认模型 slug，示例可以把它传给 runConfig.model。
  readonly model: string;
  #provider: OpenAIProvider;

  constructor(options: AiGatewayProviderOptions = {}) {
    const apiKey = options.apiKey ?? process.env.AI_GATEWAY_API_KEY;
    if (!apiKey) {
      throw new Error(
        'Please set AI_GATEWAY_API_KEY, or pass apiKey to AiGatewayProvider.',
      );
    }

    const model = options.model ?? process.env.AI_GATEWAY_MODEL;
    if (!model) {
      throw new Error(
        'Please set AI_GATEWAY_MODEL to an AI Gateway model slug such as "openai/gpt-5.4", or pass model to AiGatewayProvider.',
      );
    }

    this.model = model;
    this.#provider = new OpenAIProvider({
      apiKey,
      baseURL: AI_GATEWAY_BASE_URL,
      // 固定使用 Chat Completions，避免受全局 setOpenAIAPI('responses') 默认值影响。
      useResponses: false,
    });
  }

  getModel(modelName?: string): Promise<Model> | Model {
    // 未指定模型名时，SDK 会回退到 OpenAI 专有的默认模型名，网关并不识别，
    // 因此这里补上网关的默认 slug。
    return this.#provider.getModel(modelName || this.model);
  }
}
