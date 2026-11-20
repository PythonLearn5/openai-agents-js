import { Agent, webSearchTool } from '@openai/agents';
import { z } from 'zod';

// ---- Planner Agent ----
// 规划器 Agent：你是一位乐于助人的研究助理。给定一个查询，设计一组网络搜索来最佳回答该查询。输出5至20个术语以供查询
const plannerPrompt = `You are a helpful research assistant.
Given a query, come up with a set of web searches to perform to best answer the query.
Output between 5 and 20 terms to query for.`;

export const webSearchItem = z.object({
  reason: z
    .string()
    .describe('Your reasoning for why this search is important to the query.'),
  query: z.string().describe('The search term to use for the web search.'),
});

export type WebSearchItem = z.infer<typeof webSearchItem>;

export const webSearchPlan = z.object({
  searches: z
    .array(webSearchItem)
    .describe('A list of web searches to perform to best answer the query.'),
});

export type WebSearchPlan = z.infer<typeof webSearchPlan>;

export const plannerAgent = new Agent({
  name: 'PlannerAgent',
  instructions: plannerPrompt,
  model: 'gpt-5.4',
  outputType: webSearchPlan,
});

// ---- Search Agent ----
/**
 * 你是一名研究助理。
给定一个搜索词，你将在网络上搜索该词并生成结果的简洁摘要。
摘要必须为2-3段，字数少于300字。需涵盖要点。
简洁为要，无需完整句式或完美语法。
这将被某人用于撰写报告，因此务必提炼核心内容，忽略冗余信息。
摘要本身之外，不得添加任何额外评论。
 */
const searchAgentInstructions = `You are a research assistant.
Given a search term, you search the web for that term and produce a concise summary of the results.
The summary must be 2-3 paragraphs and less than 300 words. Capture the main points.
Write succinctly, no need to have complete sentences or good grammar.
This will be consumed by someone synthesizing a report, so its vital you capture the essence and ignore any fluff.
Do not include any additional commentary other than the summary itself.`;

export const searchAgent = new Agent({
  name: 'Search agent',
  instructions: searchAgentInstructions,
  tools: [webSearchTool()],
  modelSettings: { toolChoice: 'required' },
});

// ---- Writer Agent ----
/**
 * 你是一位资深研究员，负责撰写一份连贯的研究查询报告。
您将获得原始查询内容以及研究助理完成的初步调研资料。
你应该先为报告拟出一个大纲，说明报告的结构和逻辑顺序。
然后，生成报告并将其作为最终输出返回。
最终输出应采用Markdown格式，内容需详实冗长，目标为5-10页篇幅，至少1000字。
 */
const writerPrompt = `You are a senior researcher tasked with writing a cohesive report for a research query.
You will be provided with the original query, and some initial research done by a research assistant.
You should first come up with an outline for the report that describes the structure and flow of the report.
Then, generate the report and return that as your final output.
The final output should be in markdown format, and it should be lengthy and detailed. Aim for 5-10 pages of content, at least 1000 words.`;

export const reportData = z.object({
  shortSummary: z
    .string()
    .describe('A short 2-3 sentence summary of the findings.'),
  markdownReport: z.string().describe('The final report'),
  followUpQuestions: z
    .array(z.string())
    .describe('Suggested topics to research further'),
});

export type ReportData = z.infer<typeof reportData>;

export const writerAgent = new Agent({
  name: 'WriterAgent',
  instructions: writerPrompt,
  model: 'o3-mini',
  outputType: reportData,
});
