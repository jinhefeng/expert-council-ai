import { Expert, LLMEngineConfig, ChatMessage, LLMParamsConfig, SystemPromptsConfig } from "./types";
import { moderatorModes } from "./experts";
import { extractAndCleanJson, cleanAndParseJson, extractAndCleanModeratorJson } from "./content-parser";
import { PromptLogService } from "./prompt-log-service";



// 执行通用 LLM 请求
export async function callLLM({
  config,
  messages,
  temperature = 0.5,
  maxTokens = 4000,
  target = "通用模型API",
}: {
  config: LLMEngineConfig;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  temperature?: number;
  maxTokens?: number;
  target?: string;
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

      if (retryCount === 0) {
        try {
          const systemPrompt = messages.find(m => m.role === "system")?.content || "";
          const userPrompt = [...messages].reverse().find(m => m.role === "user")?.content || "";
          PromptLogService.addLog({
            type: "api_sync",
            target,
            modelOrToken: config.model,
            systemPrompt,
            userPrompt,
            rawRequestPayload: payload
          });
        } catch (e) {
          console.error("[PromptLog] 记录日志失败:", e);
        }
      }

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
  const messageObj = data.choices?.[0]?.message;
  let content = messageObj?.content || "";
  const reasoningContent = messageObj?.reasoning_content || messageObj?.reasoning || messageObj?.thought;
  if (reasoningContent) {
    content = `<think>\n${reasoningContent}\n</think>\n${content}`;
  }
  
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
  target = "通用模型API",
}: {
  config: LLMEngineConfig;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  temperature?: number;
  maxTokens?: number;
  target?: string;
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

  try {
    const systemPrompt = messages.find(m => m.role === "system")?.content || "";
    const userPrompt = [...messages].reverse().find(m => m.role === "user")?.content || "";
    PromptLogService.addLog({
      type: "api_stream",
      target,
      modelOrToken: config.model,
      systemPrompt,
      userPrompt,
      rawRequestPayload: payload
    });
  } catch (e) {
    console.error("[PromptLog] 记录日志失败:", e);
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

// 格式化本轮此前专家发言（通用辅助函数）
function formatPreviousTurns(
  previousTurns: { expertName: string; expertTitle?: string; content: string }[],
  headerPrompt: string,
  emptyPrompt: string,
  blockquoteFormat = true,
): string {
  if (!previousTurns.length) return emptyPrompt;
  const formatted = previousTurns.map((turn) => {
    const cleaned = (turn.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    const formattedContent = blockquoteFormat
      ? cleaned.split("\n").map(line => `> ${line}`).join("\n")
      : cleaned;
    const title = turn.expertTitle ? ` (${turn.expertTitle})` : "";
    return `【${turn.expertName}${title}】发言：\n${formattedContent}`;
  }).join("\n\n");
  return `${headerPrompt}\n${formatted}`;
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
  userProfile,
  meetingName,
  meetingDesc,
}: {
  question: string;
  projectContext?: string;
  expert: Expert;
  previousTurns: { expertName: string; expertTitle?: string; content: string }[];
  globalDebateIntensity?: number;
  engineConfig?: LLMEngineConfig;
  conversationHistory?: ChatMessage[];
  llmParams: LLMParamsConfig;
  systemPrompts: SystemPromptsConfig;
  userProfile?: { name: string; title: string };
  meetingName?: string;
  meetingDesc?: string;
}): Promise<{
  content: string;
  expertStance: {
    stance: string;
    concern: string;
    recommendation: string;
    tradeoff: string;
  };
}> {
  const activeEngine = engineConfig;

  if (!activeEngine) {
    throw new Error(
      "未配置大模型引擎参数。请先在后台管理中添加并激活至少一个大模型引擎！"
    );
  }

  const intensityPrompt = getIntensityPrompt(expert.debateIntensity, globalDebateIntensity, systemPrompts);
  const focusStr = Array.isArray(expert.focus) ? expert.focus.join("、") : (expert.focus || "无特定焦点");
  
  const userTitle = userProfile?.title || "首席决策官";
  const userName = userProfile?.name || "主持人";

  const systemPrompt = (systemPrompts?.expertTurnFormat ?? "")
    .replace(/{expertName}/g, expert.name || "")
    .replace(/{expertTitle}/g, expert.title || "")
    .replace(/{lens}/g, expert.lens || "全局评估")
    .replace(/{temperament}/g, expert.temperament || "中立冷静")
    .replace(/{focus}/g, focusStr)
    .replace(/{systemPrompt}/g, expert.systemPrompt || "")
    .replace(/{intensityPrompt}/g, intensityPrompt)
    .replace(/{userTitle}/g, userTitle)
    .replace(/{userName}/g, userName)
    .replace(/{meetingName}/g, meetingName || "未知会议")
    .replace(/{meetingDesc}/g, meetingDesc || "暂无背景描述");

  const historyMessages = formatConversationHistoryForLLM(conversationHistory);

  const promptMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt },
    ...historyMessages,
  ];

  const currentTurnPreviousText = formatPreviousTurns(
    previousTurns,
    systemPrompts.prevTurnsHeaderPrompt ?? "本轮专家讨论中，此前已发言记录：",
    systemPrompts.prevTurnsEmptyPrompt ?? "本轮中你是第一个发言的专家。",
    systemPrompts.blockquoteFormatForTurns !== false,
  );

  const contextText = projectContext ? `项目背景及附件信息：\n${projectContext}` : "";

  let currentUserTurnText = (systemPrompts.expertUserPromptFormat ?? "【来自人类决策者（{userTitle} {userName}）的现场干预与最新指令】：\n{question}\n\n{context}\n\n{previousTurns}\n\n请针对人类决策者的指令表达你的专业视角发言：")
    .replace(/{userTitle}/g, userTitle)
    .replace(/{userName}/g, userName)
    .replace(/{question}/g, question)
    .replace(/{context}/g, contextText)
    .replace(/{previousTurns}/g, currentTurnPreviousText);

  if (!previousTurns || previousTurns.length === 0) {
    currentUserTurnText += "\n\n【特别指示】当前你是本轮讨论中第一个发言的专家，请只代表自己发表意见。严禁在发言开头或内容中扮演、续写或虚构其他角色（如主持人等），亦不要输出任何其他角色的前缀（如“【主持人】：”）。直接开始你个人的专业陈述即可。";
  }

  promptMessages.push({ role: "user", content: currentUserTurnText });

  const responseText = await callLLM({
    config: activeEngine,
    messages: promptMessages,
    temperature: llmParams.expertTemperature,
    maxTokens: llmParams.maxTokens,
    target: expert.name,
  });
  return extractAndCleanJson(responseText, expert.name, expert.title);
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
  userProfile,
  meetingName,
  meetingDesc,
}: {
  question: string;
  projectContext?: string;
  expert: Expert;
  previousTurns: { expertName: string; expertTitle?: string; content: string }[];
  globalDebateIntensity?: number;
  engineConfig?: LLMEngineConfig;
  conversationHistory?: ChatMessage[];
  llmParams: LLMParamsConfig;
  systemPrompts: SystemPromptsConfig;
  userProfile?: { name: string; title: string };
  meetingName?: string;
  meetingDesc?: string;
}): Promise<Response> {
  const activeEngine = engineConfig;

  if (!activeEngine) {
    throw new Error(
      "未配置大模型引擎参数。请先在后台管理中添加并激活至少一个大模型引擎！"
    );
  }

  const intensityPrompt = getIntensityPrompt(expert.debateIntensity, globalDebateIntensity, systemPrompts);
  const focusStr = Array.isArray(expert.focus) ? expert.focus.join("、") : (expert.focus || "无特定焦点");

  const userTitle = userProfile?.title || "首席决策官";
  const userName = userProfile?.name || "主持人";

  const systemPrompt = (systemPrompts?.expertTurnFormat ?? "")
    .replace(/{expertName}/g, expert.name || "")
    .replace(/{expertTitle}/g, expert.title || "")
    .replace(/{lens}/g, expert.lens || "全局评估")
    .replace(/{temperament}/g, expert.temperament || "中立冷静")
    .replace(/{focus}/g, focusStr)
    .replace(/{systemPrompt}/g, expert.systemPrompt || "")
    .replace(/{intensityPrompt}/g, intensityPrompt)
    .replace(/{userTitle}/g, userTitle)
    .replace(/{userName}/g, userName)
    .replace(/{meetingName}/g, meetingName || "未知会议")
    .replace(/{meetingDesc}/g, meetingDesc || "暂无背景描述");

  const historyMessages = formatConversationHistoryForLLM(conversationHistory);

  const promptMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt },
    ...historyMessages,
  ];

  const currentTurnPreviousText = formatPreviousTurns(
    previousTurns,
    systemPrompts.prevTurnsHeaderPrompt ?? "本轮专家讨论中，此前已发言记录：",
    systemPrompts.prevTurnsEmptyPrompt ?? "本轮中你是第一个发言的专家。",
    systemPrompts.blockquoteFormatForTurns !== false,
  );

  const contextText = projectContext ? `项目背景及附件信息：\n${projectContext}` : "";

  let currentUserTurnText = (systemPrompts.expertUserPromptFormat ?? "【来自人类决策者（{userTitle} {userName}）的现场干预与最新指令】：\n{question}\n\n{context}\n\n{previousTurns}\n\n请针对人类决策者的指令表达你的专业视角发言：")
    .replace(/{userTitle}/g, userTitle)
    .replace(/{userName}/g, userName)
    .replace(/{question}/g, question)
    .replace(/{context}/g, contextText)
    .replace(/{previousTurns}/g, currentTurnPreviousText);

  if (!previousTurns || previousTurns.length === 0) {
    currentUserTurnText += "\n\n【特别指示】当前你是本轮讨论中第一个发言的专家，请只代表自己发表意见。严禁在发言开头或内容中扮演、续写或虚构其他角色（如主持人等），亦不要输出任何其他角色的前缀（如“【主持人】：”）。直接开始你个人的专业陈述即可。";
  }

  promptMessages.push({ role: "user", content: currentUserTurnText });

  return callLLMStream({
    config: activeEngine,
    messages: promptMessages,
    temperature: llmParams.expertTemperature,
    maxTokens: llmParams.maxTokens,
    target: expert.name,
  });
}

// 1.8 主持人总结流式接口
export async function getSynthesisStream({
  question,
  projectContext = "",
  expertRounds,
  moderatorId = "balanced",
  engineConfig,
  conversationHistory = [],
  llmParams,
  systemPrompts,
  userProfile,
}: {
  question: string;
  projectContext?: string;
  expertRounds: { expertName: string; content: string }[];
  moderatorId?: string;
  engineConfig?: LLMEngineConfig;
  conversationHistory?: ChatMessage[];
  llmParams: LLMParamsConfig;
  systemPrompts: SystemPromptsConfig;
  userProfile?: { name: string; title: string };
}): Promise<Response> {
  const activeEngine = engineConfig;
  const moderator = moderatorModes.find((m) => m.id === moderatorId) || moderatorModes[0];

  if (!activeEngine) {
    throw new Error(
      "未配置大模型引擎参数。请先在后台管理中添加并激活至少一个大模型引擎！"
    );
  }

  const moderatorName = systemPrompts.moderatorName || moderator.name;
  const moderatorTitle = systemPrompts.moderatorTitle || "决策协调官";

  const systemPrompt = (systemPrompts?.synthesisPrompt ?? "")
    .replace("{moderatorName}", moderatorName)
    .replace("{moderatorDesc}", moderator.description)
    .replace(/{moderatorTitle}/g, moderatorTitle);

  const historyMessages = formatConversationHistoryForLLM(conversationHistory);

  const promptMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt },
    ...historyMessages,
  ];

  const cleanThink = systemPrompts.cleanThinkForSynthesis !== false;
  const blockquoteFormat = systemPrompts.blockquoteFormatForTurns !== false;

  const expertTurnsText = expertRounds.map((round) => {
    let content = round.content ?? "";
    if (cleanThink) {
      content = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      const thinkIdx = content.indexOf("<think>");
      if (thinkIdx !== -1) {
        content = content.substring(0, thinkIdx).trim();
      }
    }
    let formattedContent = content.trim();
    if (blockquoteFormat) {
      formattedContent = formattedContent.split("\n").map(line => `> ${line}`).join("\n");
    }
    return `【${round.expertName}】发言：\n${formattedContent}`;
  }).join("\n\n");
  const contextText = projectContext ? `项目背景：\n${projectContext}` : "";
  const userTitle = userProfile?.title || "首席决策官";
  const userName = userProfile?.name || "主持人";

  const currentUserTurnText = (systemPrompts.synthesisUserPromptFormat ?? "当前会议议题：{question}\n\n{context}\n\n本轮参会专家发言记录：\n{expertTurns}\n\n请对以上圆桌会议内容进行主持人综合总结。")
    .replace(/{question}/g, question)
    .replace(/{context}/g, contextText)
    .replace(/{expertTurns}/g, expertTurnsText)
    .replace(/{userTitle}/g, userTitle)
    .replace(/{userName}/g, userName);

  promptMessages.push({ role: "user", content: currentUserTurnText });

  return callLLMStream({
    config: activeEngine,
    messages: promptMessages,
    temperature: llmParams.synthesisTemperature,
    maxTokens: llmParams.maxTokens,
    target: `主持人总结流: ${moderatorName}`,
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
  userProfile,
}: {
  question: string;
  projectContext?: string;
  expertRounds: { expertName: string; content: string }[];
  moderatorId?: string;
  engineConfig?: LLMEngineConfig;
  conversationHistory?: ChatMessage[];
  llmParams: LLMParamsConfig;
  systemPrompts: SystemPromptsConfig;
  userProfile?: { name: string; title: string };
}): Promise<{
  summary: string;
  consensus: string[];
  disagreements: string[];
  decisions: string[];
  nextActions: string[];
}> {
  const activeEngine = engineConfig;
  const moderator = moderatorModes.find((m) => m.id === moderatorId) || moderatorModes[0];

  if (!activeEngine) {
    throw new Error(
      "未配置大模型引擎参数。请先在后台管理中添加并激活至少一个大模型引擎！"
    );
  }

  const moderatorName = systemPrompts.moderatorName || moderator.name;
  const moderatorTitle = systemPrompts.moderatorTitle || "决策协调官";

  const systemPrompt = (systemPrompts?.synthesisPrompt ?? "")
    .replace("{moderatorName}", moderatorName)
    .replace("{moderatorDesc}", moderator.description)
    .replace(/{moderatorTitle}/g, moderatorTitle);

  // 格式化历史消息
  const historyMessages = formatConversationHistoryForLLM(conversationHistory);

  const promptMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt },
    ...historyMessages,
  ];

  const cleanThink = systemPrompts.cleanThinkForSynthesis !== false;
  const blockquoteFormat = systemPrompts.blockquoteFormatForTurns !== false;

  const expertTurnsText = expertRounds.map((round) => {
    let content = round.content ?? "";
    if (cleanThink) {
      content = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      const thinkIdx = content.indexOf("<think>");
      if (thinkIdx !== -1) {
        content = content.substring(0, thinkIdx).trim();
      }
    }
    let formattedContent = content.trim();
    if (blockquoteFormat) {
      formattedContent = formattedContent.split("\n").map(line => `> ${line}`).join("\n");
    }
    return `【${round.expertName}】发言：\n${formattedContent}`;
  }).join("\n\n");
  const contextText = projectContext ? `项目背景：\n${projectContext}` : "";
  const userTitle = userProfile?.title || "首席决策官";
  const userName = userProfile?.name || "主持人";

  const currentUserTurnText = (systemPrompts.synthesisUserPromptFormat ?? "当前会议议题：{question}\n\n{context}\n\n本轮参会专家发言记录：\n{expertTurns}\n\n请对以上圆桌会议内容进行主持人综合总结。")
    .replace(/{question}/g, question)
    .replace(/{context}/g, contextText)
    .replace(/{expertTurns}/g, expertTurnsText)
    .replace(/{userTitle}/g, userTitle)
    .replace(/{userName}/g, userName);

  promptMessages.push({ role: "user", content: currentUserTurnText });

  const responseText = await callLLM({
    config: activeEngine,
    messages: promptMessages,
    temperature: llmParams.synthesisTemperature,
    maxTokens: llmParams.maxTokens,
    target: `主持人: ${moderatorName}`,
  });

  try {
    const parsedRes = extractAndCleanModeratorJson(responseText, moderatorName, moderatorTitle);
    return {
      summary: parsedRes.content,
      consensus: parsedRes.moderatorSummary.consensus,
      disagreements: parsedRes.moderatorSummary.disagreements,
      decisions: parsedRes.moderatorSummary.decisions,
      nextActions: parsedRes.moderatorSummary.nextActions,
    };
  } catch (e) {
    console.error("Failed to parse synthesis JSON", responseText, e);
  }

  return {
    summary: responseText,
    consensus: [],
    disagreements: [],
    decisions: [],
    nextActions: [],
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
  previousTurns: { expertName: string; expertTitle?: string; content: string }[];
  candidateExperts: Expert[];
  engineConfig?: LLMEngineConfig;
  conversationHistory?: ChatMessage[];
  llmParams: LLMParamsConfig;
  systemPrompts: SystemPromptsConfig;
}): Promise<string> {
  if (candidateExperts.length === 0) {
    return "";
  }

  const activeEngine = engineConfig;

  if (!activeEngine) {
    if (candidateExperts.length > 1) {
      throw new Error(
        "未配置大模型引擎参数。请先在后台管理中添加并激活至少一个大模型配置！"
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

  const previousTurnsText = formatPreviousTurns(
    previousTurns,
    systemPrompts.prevTurnsHeaderPrompt ?? "本轮专家讨论中，此前已发言记录：",
    systemPrompts.prevTurnsEmptyPrompt ?? "本轮中你是第一个发言的专家。",
  );

  const currentUserTurnText = (systemPrompts.nextSpeakerUserPromptFormat ?? "当前新议题：{question}\n\n本轮讨论已有发言历史：\n{previousTurns}\n\n根据以上记录，请返回下一个最契合的候选专家 ID：")
    .replace(/{question}/g, question)
    .replace(/{previousTurns}/g, previousTurnsText);

  promptMessages.push({ role: "user", content: currentUserTurnText });

  const chosenId = await callLLM({
    config: activeEngine,
    messages: promptMessages,
    temperature: llmParams.nextSpeakerTemperature,
    maxTokens: llmParams.maxTokens,
    target: "智能派单调度官",
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
  const activeEngine = engineConfig;
  
  if (!activeEngine) {
    throw new Error(
      "未配置大模型引擎参数。请先在后台管理中添加并激活至少一个大模型引擎！"
    );
  }

  const systemPrompt = systemPrompts.finalConclusionPrompt;

  const historyMessages = formatConversationHistoryForLLM(conversationHistory);

  const contextText = projectContext ? `会议背景信息：\n${projectContext}` : "";
  const userContent = (systemPrompts.finalConclusionUserPromptFormat ?? "{context}\n\n请根据上述会议全程记录，提炼一份极具执行指导意义的最终结论（仅输出 Markdown）。")
    .replace(/{context}/g, contextText);

  const promptMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt },
    ...historyMessages,
    { role: "user", content: userContent }
  ];

  const responseText = await callLLM({
    config: activeEngine,
    messages: promptMessages,
    temperature: llmParams.conclusionTemperature,
    maxTokens: llmParams.maxTokens,
    target: "最终结论提炼官",
  });

  return responseText.trim();
}

// 5. 评估是否需要追问补充信息
export async function getInquiryDecision({
  question,
  projectContext = "",
  conversationHistory = [],
  engineConfig,
  llmParams,
  systemPrompts,
}: {
  question: string;
  projectContext?: string;
  conversationHistory: ChatMessage[];
  engineConfig?: LLMEngineConfig;
  llmParams: LLMParamsConfig;
  systemPrompts: SystemPromptsConfig;
}): Promise<string> {
  const activeEngine = engineConfig;
  if (!activeEngine) {
    throw new Error("未配置大模型引擎参数。请先在后台管理中添加并激活至少一个大模型引擎！");
  }

  const systemPrompt = systemPrompts.inquiryJudgmentPrompt;
  const historyMessages = formatConversationHistoryForLLM(conversationHistory);

  const contextText = projectContext ? `项目背景及附件信息：\n${projectContext}` : "";
  const userContent = `当前会议最新议题是：${question}\n\n${contextText}\n\n请评估是否需要用户进一步补充数据事实以开启/继续这次评审。`;

  const promptMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt },
    ...historyMessages,
    { role: "user", content: userContent }
  ];

  const responseText = await callLLM({
    config: activeEngine,
    messages: promptMessages,
    temperature: 0.3,
    maxTokens: 1000,
    target: "信息追问判定官",
  });

  return responseText.trim();
}

// 6. 生成可供抉择的方向性意见选项
function extractJSONArrayString(text: string): string | null {
  const startIdx = text.indexOf('[');
  if (startIdx === -1) return null;

  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let i = startIdx; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (char === "\\") {
        isEscaped = !isEscaped;
      } else if (char === '"' && !isEscaped) {
        inString = false;
      } else {
        isEscaped = false;
      }
    } else {
      if (char === '"') {
        inString = true;
        isEscaped = false;
      } else if (char === '[') {
        depth++;
      } else if (char === ']') {
        depth--;
        if (depth === 0) {
          return text.substring(startIdx, i + 1);
        }
      }
    }
  }

  return text.substring(startIdx);
}

export async function getDecisionOptions({
  question,
  projectContext = "",
  conversationHistory = [],
  synthesisSummary = "",
  engineConfig,
  llmParams,
  systemPrompts,
}: {
  question: string;
  projectContext?: string;
  conversationHistory: ChatMessage[];
  synthesisSummary: string;
  engineConfig?: LLMEngineConfig;
  llmParams?: LLMParamsConfig;
  systemPrompts?: SystemPromptsConfig;
}): Promise<string[]> {
  const activeEngine = engineConfig;
  if (!activeEngine) {
    throw new Error("未配置大模型引擎参数。请先在后台管理中添加并激活至少一个大模型引擎！");
  }

  const DEFAULT_DECISION_PROMPT = "你是一位专业的决策分析师。请根据当前讨论情况，以 JSON 数组格式输出 2-4 个具体、可供人类决策者抉择的方向性意见/备选方案。";
  const systemPrompt = systemPrompts?.decisionOptionsPrompt || DEFAULT_DECISION_PROMPT;
  const historyMessages = formatConversationHistoryForLLM(conversationHistory);

  const contextText = projectContext ? `项目背景信息：\n${projectContext}` : "";
  const userContent = `当前会议议题：${question}\n\n${contextText}\n\n最近专家发言及主持人的总结：\n${synthesisSummary}\n\n请根据上述讨论内容，给出 2-4 个具体、可供人类决策者抉择的方向性意见/备选方案。`;

  const promptMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt },
    ...historyMessages,
    { role: "user", content: userContent }
  ];

  const responseText = await callLLM({
    config: activeEngine,
    messages: promptMessages,
    temperature: 0.5,
    maxTokens: 1000,
    target: "决策备选方案官",
  });

  try {
    const rawText = responseText.trim();
    const cleanedText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
    const extracted = extractJSONArrayString(cleanedText);
    if (extracted) {
      const parsed = cleanAndParseJson<any>(extracted);
      if (Array.isArray(parsed)) {
        return parsed.map(item => String(item).trim());
      }
    }
  } catch (e) {
    console.error("解析决策方案 JSON 失败，模型返回：", responseText, e);
  }

  return [
    "方向一：维持现状，进一步观测和评估指标细节",
    "方向二：折中改进，在局部实施优化以规避最严重风险",
    "方向三：全面重构，按专家的最高标准建议执行"
  ];
}
