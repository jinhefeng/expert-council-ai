import { Expert, LLMEngineConfig, ChatMessage, LLMParamsConfig, SystemPromptsConfig } from "./types";
import { moderatorModes } from "./experts";
import { extractAndCleanJson } from "./content-parser";

// 从本地环境变量自动生成系统默认引擎
export function getSystemEngine(): LLMEngineConfig | null {
  if (typeof process === "undefined") return null;

  if (process.env.DASHSCOPE_API_KEY) {
    return {
      id: "system-qwen",
      name: "系统通义千问 (DashScope)",
      provider: "qwen",
      baseUrl: process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKey: process.env.DASHSCOPE_API_KEY,
      model: process.env.DASHSCOPE_MODEL || "qwen-plus",
      isActive: true,
    };
  }

  if (process.env.OPENAI_API_KEY) {
    return {
      id: "system-openai",
      name: "系统 OpenAI (env)",
      provider: "openai",
      baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || "gpt-4o",
      isActive: true,
    };
  }

  return null;
}

// 执行通用 LLM 请求
export async function callLLM({
  config,
  messages,
  temperature = 0.5,
  maxTokens = 4000,
}: {
  config: LLMEngineConfig;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const baseUrl = config.baseUrl || "https://api.openai.com/v1";
  const apiKey = config.apiKey;
  const model = config.model;

  if (!apiKey) {
    throw new Error(`引擎 "${config.name}" 未配置 API Key`);
  }

  let response;
  let retryCount = 0;
  const maxRetries = 2;
  let lastError = null;

  while (retryCount <= maxRetries) {
    try {
      const payload: any = {
        model,
        messages: config.isReasoningModel ? messages.map(m => m.role === "system" ? { ...m, role: "user" } : m) : messages,
        max_tokens: maxTokens ?? 4000,
        ...(config.isReasoningModel ? {} : { temperature }),
      };

      if (process.env.NODE_ENV === 'development') {
        console.log(`\n========== [LLM Request (Sync): ${model}] ==========`);
        console.log(JSON.stringify(payload, null, 2));
        console.log(`====================================================\n`);
      }

      response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Connection": "close",
        },
        body: JSON.stringify(payload),
      });
      break; // Success
    } catch (e: any) {
      lastError = e;
      if (e.message && e.message.includes("fetch failed")) {
        console.warn(`[callLLM] fetch failed (retry ${retryCount}/${maxRetries}):`, e.message);
        retryCount++;
        if (retryCount <= maxRetries) {
          // Wait 2 seconds before retry
          await new Promise(res => setTimeout(res, 2000));
          continue;
        }
      }
      throw e;
    }
  }

  if (!response) {
    throw lastError || new Error("模型请求完全失败");
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`模型请求失败: ${detail}`);
  }

  const data = await response.json();
  
  if (process.env.NODE_ENV === 'development') {
    console.log(`\n========== [LLM Response (Sync): ${model}] ==========`);
    console.log(JSON.stringify(data, null, 2));
    console.log(`=====================================================\n`);
  }
  
  if (data.error) {
    throw new Error(`模型接口返回错误 (HTTP 200): ${JSON.stringify(data.error)}`);
  }
  
  const finishReason = data.choices?.[0]?.finish_reason;
  const content = data.choices?.[0]?.message?.content;
  
  if (finishReason === "length" && (!content || content.trim() === "")) {
    throw new Error(`生成被截断！模型达到了最大 Token 限制 (当前限制为 ${maxTokens}，可能是推理模型思考过程太长耗尽了 Token)。请调大 maxTokens。原生返回: ${JSON.stringify(data)}`);
  }

  if (content === undefined || content === null || content.trim() === "") {
    throw new Error(`模型未返回有效内容。大模型原生返回数据: ${JSON.stringify(data)}`);
  }
  return content.trim();
}

// 执行流式 LLM 请求
export async function callLLMStream({
  config,
  messages,
  temperature = 0.5,
  maxTokens = 4000,
}: {
  config: LLMEngineConfig;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  temperature?: number;
  maxTokens?: number;
}): Promise<Response> {
  const baseUrl = config.baseUrl || "https://api.openai.com/v1";
  const apiKey = config.apiKey;
  const model = config.model;

  if (!apiKey) {
    throw new Error(`引擎 "${config.name}" 未配置 API Key`);
  }

  const payload: any = {
    model,
    messages: config.isReasoningModel ? messages.map(m => m.role === "system" ? { ...m, role: "user" } : m) : messages,
    stream: true,
    max_tokens: maxTokens ?? 4000,
  };

  if (!config.isReasoningModel) {
    payload.temperature = temperature;
  }

  if (process.env.NODE_ENV === 'development') {
    console.log(`\n========== [LLM Request (Stream): ${model}] ==========`);
    console.log(JSON.stringify(payload, null, 2));
    console.log(`======================================================\n`);
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`模型流式请求失败: ${detail}`);
  }

  return response;
}

// 将前端完整的 ChatMessage[] 聊天流转换格式化为大模型兼容的对话轮次
export function formatConversationHistoryForLLM(
  history: ChatMessage[],
): { role: "user" | "assistant"; content: string }[] {
  const result: { role: "user" | "assistant"; content: string }[] = [];

  for (const msg of history) {
    const cleanedContent = (msg.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    if (!cleanedContent) continue;

    if (msg.role === "user") {
      result.push({
        role: "user",
        content: cleanedContent,
      });
    } else if (msg.role === "expert") {
      // 携带发言专家名称，以便其他智能体明确引用关系
      result.push({
        role: "assistant",
        content: `【${msg.senderName} (${msg.senderTitle || "专家"})】：${cleanedContent}`,
      });
    } else if (msg.role === "moderator") {
      result.push({
        role: "assistant",
        content: `【主持人】：${cleanedContent}`,
      });
    }
  }

  return result;
}

// 拼接对抗强度相关的系统指示
function getIntensityPrompt(personal: number, global: number, prompts: SystemPromptsConfig): string {
  if (!prompts) return "";
  const intensity = Math.min(5, Math.max(1, Math.round((personal + global) / 2)));
  switch (intensity) {
    case 1: return (prompts.intensityLevel1 ?? "").replace("{intensity}", "1");
    case 2: return (prompts.intensityLevel2 ?? "").replace("{intensity}", "2");
    case 3: return (prompts.intensityLevel3 ?? "").replace("{intensity}", "3");
    case 4: return (prompts.intensityLevel4 ?? "").replace("{intensity}", "4");
    case 5: return (prompts.intensityLevel5 ?? "").replace("{intensity}", "5");
    default: return (prompts.intensityLevel3 ?? "").replace("{intensity}", "3");
  }
}

// 1. 生成单步专家发言
export async function getExpertTurn({
  question,
  projectContext = "",
  expert,
  previousTurns = [],
  globalDebateIntensity = 3,
  engineConfig,
  conversationHistory = [],
  llmParams,
  systemPrompts,
}: {
  question: string;
  projectContext?: string;
  expert: Expert;
  previousTurns: { expertName: string; content: string }[];
  globalDebateIntensity?: number;
  engineConfig?: LLMEngineConfig;
  conversationHistory?: ChatMessage[];
  llmParams: LLMParamsConfig;
  systemPrompts: SystemPromptsConfig;
}): Promise<{
  content: string;
  expertStance: {
    stance: string;
    concern: string;
    recommendation: string;
    tradeoff: string;
  };
}> {
  // 决定引擎：优先使用传入的，否则尝试加载系统默认引擎
  const activeEngine = engineConfig || getSystemEngine();

  if (!activeEngine) {
    throw new Error(
      "未配置 API Key 且前端未添加自定义大模型。请配置密钥后重试！"
    );
  }

  // 拼接大模型 System Prompt
  const intensityPrompt = getIntensityPrompt(expert.debateIntensity, globalDebateIntensity, systemPrompts);
  const focusStr = Array.isArray(expert.focus) ? expert.focus.join("、") : (expert.focus || "无特定焦点");

  const systemPrompt = (systemPrompts?.expertTurnFormat ?? "")
    .replace(/{expertName}/g, expert.name || "")
    .replace(/{lens}/g, expert.lens || "全局评估")
    .replace(/{temperament}/g, expert.temperament || "中立冷静")
    .replace(/{focus}/g, focusStr)
    .replace(/{systemPrompt}/g, expert.systemPrompt || "")
    .replace(/{intensityPrompt}/g, intensityPrompt);



  // 格式化以往所有轮次的会议聊天记录作为对话历史上下文
  const historyMessages = formatConversationHistoryForLLM(conversationHistory);

  const promptMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt },
    ...historyMessages,
  ];

  // 拼接当前这一轮的最新 User 问题以及本轮内先于此专家发言的其他专家的观点
  const currentTurnPreviousText = previousTurns.length
    ? "本轮专家讨论中，此前已发言记录：\n" +
      previousTurns.map((turn) => `【${turn.expertName}】：${(turn.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim()}`).join("\n\n")
    : "本轮中你是第一个发言的专家。";

  const currentUserTurnText = [
    `当前会议新议题：${question}`,
    projectContext ? `项目背景及附件信息：\n${projectContext}` : "",
    currentTurnPreviousText,
    `请针对当前议题表达你的专业视角发言：`
  ].filter(Boolean).join("\n\n");

  promptMessages.push({ role: "user", content: currentUserTurnText });

  const responseText = await callLLM({
    config: activeEngine,
    messages: promptMessages,
    temperature: llmParams.expertTemperature,
    maxTokens: llmParams.maxTokens,
  });
  return extractAndCleanJson(responseText, expert.name);
}

// 1.5 专家发言流式接口
export async function getExpertTurnStream({
  question,
  projectContext = "",
  expert,
  previousTurns = [],
  globalDebateIntensity = 3,
  engineConfig,
  conversationHistory = [],
  llmParams,
  systemPrompts,
}: {
  question: string;
  projectContext?: string;
  expert: Expert;
  previousTurns: { expertName: string; content: string }[];
  globalDebateIntensity?: number;
  engineConfig?: LLMEngineConfig;
  conversationHistory?: ChatMessage[];
  llmParams: LLMParamsConfig;
  systemPrompts: SystemPromptsConfig;
}): Promise<Response> {
  const activeEngine = engineConfig || getSystemEngine();

  if (!activeEngine) {
    throw new Error(
      "未配置 API Key 且前端未添加自定义大模型。请配置密钥后重试！"
    );
  }

  const intensityPrompt = getIntensityPrompt(expert.debateIntensity, globalDebateIntensity, systemPrompts);
  const focusStr = Array.isArray(expert.focus) ? expert.focus.join("、") : (expert.focus || "无特定焦点");

  const systemPrompt = (systemPrompts?.expertTurnFormat ?? "")
    .replace(/{expertName}/g, expert.name || "")
    .replace(/{lens}/g, expert.lens || "全局评估")
    .replace(/{temperament}/g, expert.temperament || "中立冷静")
    .replace(/{focus}/g, focusStr)
    .replace(/{systemPrompt}/g, expert.systemPrompt || "")
    .replace(/{intensityPrompt}/g, intensityPrompt);

  const historyMessages = formatConversationHistoryForLLM(conversationHistory);

  const promptMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt },
    ...historyMessages,
  ];

  const currentTurnPreviousText = previousTurns.length
    ? "本轮专家讨论中，此前已发言记录：\n" +
      previousTurns.map((turn) => `【${turn.expertName}】：${(turn.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim()}`).join("\n\n")
    : "本轮中你是第一个发言的专家。";

  const currentUserTurnText = [
    `当前会议新议题：${question}`,
    projectContext ? `项目背景及附件信息：\n${projectContext}` : "",
    currentTurnPreviousText,
    `请针对当前议题表达你的专业视角发言：`
  ].filter(Boolean).join("\n\n");

  promptMessages.push({ role: "user", content: currentUserTurnText });

  return callLLMStream({
    config: activeEngine,
    messages: promptMessages,
    temperature: llmParams.expertTemperature,
    maxTokens: llmParams.maxTokens,
  });
}

// 2. 主持人决策综合
export async function getSynthesis({
  question,
  projectContext = "",
  expertRounds,
  moderatorId = "balanced",
  engineConfig,
  conversationHistory = [],
  llmParams,
  systemPrompts,
}: {
  question: string;
  projectContext?: string;
  expertRounds: { expertName: string; content: string }[];
  moderatorId?: string;
  engineConfig?: LLMEngineConfig;
  conversationHistory?: ChatMessage[];
  llmParams: LLMParamsConfig;
  systemPrompts: SystemPromptsConfig;
}): Promise<{
  summary: string;
  consensus: string[];
  disagreements: string[];
  decisions: string[];
  nextActions: string[];
}> {
  const activeEngine = engineConfig || getSystemEngine();
  const moderator = moderatorModes.find((m) => m.id === moderatorId) || moderatorModes[0];

  if (!activeEngine) {
    throw new Error(
      "未配置 API Key 且前端未添加自定义大模型。请配置密钥后重试！"
    );
  }

  const systemPrompt = (systemPrompts?.synthesisPrompt ?? "")
    .replace("{moderatorName}", moderator.name)
    .replace("{moderatorDesc}", moderator.description);

  // 格式化历史消息
  const historyMessages = formatConversationHistoryForLLM(conversationHistory);

  const promptMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt },
    ...historyMessages,
  ];

  const currentUserTurnText = [
    `当前会议议题：${question}`,
    projectContext ? `项目背景：\n${projectContext}` : "",
    "本轮参会专家发言记录：",
    ...expertRounds.map((round) => `【${round.expertName}】：${round.content}`),
    "请对以上圆桌会议内容进行主持人综合总结。"
  ].join("\n\n");

  promptMessages.push({ role: "user", content: currentUserTurnText });

  const responseText = await callLLM({
    config: activeEngine,
    messages: promptMessages,
    temperature: llmParams.synthesisTemperature,
    maxTokens: llmParams.maxTokens,
  });

  try {
    const jsonMatch = responseText.match(/({[\s\S]*?})/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed && typeof parsed === "object" && "summary" in parsed) {
        return parsed;
      }
    }
  } catch (e) {
    console.error("Failed to parse synthesis JSON", responseText, e);
  }

  return {
    summary: responseText,
    consensus: ["已记录在总结中"],
    disagreements: ["参见上述文本"],
    decisions: ["见总结详情"],
    nextActions: ["立即推进相关决策评估"],
  };
}

// 3. 智能相关度指派算法
export async function getNextSpeaker({
  question,
  previousTurns = [],
  candidateExperts,
  engineConfig,
  conversationHistory = [],
  llmParams,
  systemPrompts,
}: {
  question: string;
  previousTurns: { expertName: string; content: string }[];
  candidateExperts: Expert[];
  engineConfig?: LLMEngineConfig;
  conversationHistory?: ChatMessage[];
  llmParams: LLMParamsConfig;
  systemPrompts: SystemPromptsConfig;
}): Promise<string> {
  if (candidateExperts.length === 0) {
    return "";
  }

  const activeEngine = engineConfig || getSystemEngine();

  if (!activeEngine) {
    if (candidateExperts.length > 1) {
      throw new Error(
        "未配置 API Key 且前端未添加自定义大模型。请配置密钥后重试！"
      );
    }
    return candidateExperts[0].id;
  }
  if (candidateExperts.length === 1) {
    return candidateExperts[0].id;
  }

  const candidateList = candidateExperts.map((exp) => `- ID: ${exp.id}, 专家名称: ${exp.name}, 判断视角: ${exp.lens}`).join("\n");

  const systemPrompt = (systemPrompts?.nextSpeakerPrompt ?? "").replace("{candidateList}", candidateList);

  const historyMessages = formatConversationHistoryForLLM(conversationHistory);

  const promptMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt },
    ...historyMessages,
  ];

  const currentUserTurnText = [
    `当前新议题：${question}`,
    "本轮讨论已有发言历史：",
    ...previousTurns.map((turn) => `【${turn.expertName}】：${turn.content}`),
    "根据以上记录，请返回下一个最契合的候选专家 ID："
  ].join("\n\n");

  promptMessages.push({ role: "user", content: currentUserTurnText });

  const chosenId = await callLLM({
    config: activeEngine,
    messages: promptMessages,
    temperature: llmParams.nextSpeakerTemperature,
    maxTokens: llmParams.maxTokens,
  });

  const cleanedId = chosenId.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  let matched = candidateExperts.find((c) => c.id === cleanedId);
  if (!matched) {
    matched = candidateExperts.find((c) => cleanedId.includes(c.id));
  }
  return matched ? matched.id : candidateExperts[0].id;
}

// 4. 提炼全场最终结论
export async function getFinalConclusion({
  projectContext,
  conversationHistory = [],
  engineConfig,
  llmParams,
  systemPrompts,
}: {
  projectContext?: string;
  conversationHistory: ChatMessage[];
  engineConfig?: LLMEngineConfig;
  llmParams: LLMParamsConfig;
  systemPrompts: SystemPromptsConfig;
}): Promise<string> {
  const activeEngine = engineConfig || getSystemEngine();
  
  if (!activeEngine) {
    throw new Error(
      "未配置 API Key 且前端未添加自定义大模型。请配置密钥后重试！"
    );
  }

  const systemPrompt = systemPrompts.finalConclusionPrompt;

  const historyMessages = formatConversationHistoryForLLM(conversationHistory);

  const promptMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt },
    ...historyMessages,
    { role: "user", content: projectContext ? `会议背景信息：\n${projectContext}\n\n请根据上述会议全程记录，提炼一份极具执行指导意义的最终结论（仅输出 Markdown）。` : "请根据上述会议全程记录，提炼一份极具执行指导意义的最终结论（仅输出 Markdown）。" }
  ];

  const responseText = await callLLM({
    config: activeEngine,
    messages: promptMessages,
    temperature: llmParams.conclusionTemperature,
    maxTokens: llmParams.maxTokens,
  });

  return responseText.trim();
}
