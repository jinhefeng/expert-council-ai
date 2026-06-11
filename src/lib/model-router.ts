import { Expert, LLMEngineConfig, ChatMessage } from "./types";
import { moderatorModes } from "./experts";

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
}: {
  config: LLMEngineConfig;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  temperature?: number;
}): Promise<string> {
  const baseUrl = config.baseUrl || "https://api.openai.com/v1";
  const apiKey = config.apiKey;
  const model = config.model;

  if (!apiKey) {
    throw new Error(`引擎 "${config.name}" 未配置 API Key`);
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: 4000,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`模型请求失败: ${detail}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "模型没有返回内容。";
}

// 将前端完整的 ChatMessage[] 聊天流转换格式化为大模型兼容的对话轮次
export function formatConversationHistoryForLLM(
  history: ChatMessage[],
): { role: "user" | "assistant"; content: string }[] {
  const result: { role: "user" | "assistant"; content: string }[] = [];

  for (const msg of history) {
    if (msg.role === "user") {
      result.push({
        role: "user",
        content: msg.content,
      });
    } else if (msg.role === "expert") {
      // 携带发言专家名称，以便其他智能体明确引用关系
      result.push({
        role: "assistant",
        content: `【${msg.senderName} (${msg.senderTitle || "专家"})】：${msg.content}`,
      });
    } else if (msg.role === "moderator") {
      result.push({
        role: "assistant",
        content: `【主持人】：${msg.content}`,
      });
    }
  }

  return result;
}

// 拼接对抗强度相关的系统指示
function getIntensityPrompt(personal: number, global: number): string {
  const intensity = Math.min(5, Math.max(1, Math.round((personal + global) / 2)));

  if (intensity <= 2) {
    return "【辩论对抗强度：温和协作 (Level " + intensity + ")】\n在圆桌会议中，你应当温和、包容，倾向于寻找共识。请重点指出你同意之前发言专家的哪些意见，并在此基础上做建设性的微调与补充。避免激烈的观点对抗，语气要柔和友好。";
  } else if (intensity === 3) {
    return "// 【辩论对抗强度：中立理性 (Level " + intensity + ")】\n在圆桌会议中，你应当客观、理性地表达专业判断。不用刻意迎合，也无需刻意抬杠。如实指出你的视角关注的核心问题，并提出独立的专业建议。";
  } else {
    return "【辩论对抗强度：激烈批判 (Level " + intensity + ")】\n在圆桌会议中，你代表此视角的极致挑剔立场。态度必须极其强硬、敏锐，充满批判性。请主动挑战并质问前几位发言专家的漏洞，无情揭示其方案逻辑或盲区（如：开发成本激增、系统风险、商业转化低效等）。请用犀利、直接的语气表态，并给出强烈的反制或替代建议。";
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
}: {
  question: string;
  projectContext?: string;
  expert: Expert;
  previousTurns: { expertName: string; content: string }[];
  globalDebateIntensity?: number;
  engineConfig?: LLMEngineConfig;
  conversationHistory?: ChatMessage[];
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
  const intensityPrompt = getIntensityPrompt(expert.debateIntensity, globalDebateIntensity);

  const systemPrompt = [
    expert.systemPrompt,
    `你的性格与气质：${expert.temperament}`,
    `你关注的焦点：${expert.focus.join("、")}`,
    intensityPrompt,
    `请以第一人称（我是${expert.name}）的口吻直接输出你的发言。
IMPORTANT: 必须全程使用中文（简体中文）进行回答！
输出要求：
1. 包含一段直观生动的会议发言内容（content）。
2. 在发言的最后，必须提供一个纯 JSON 格式的结构化摘要（便于前端拆分展示），JSON 的 key 如下：
{
  "stance": "清晰简短的立场总结",
  "concern": "最担心的核心风险",
  "recommendation": "可执行的具体修改建议",
  "tradeoff": "为了这个决策我们必须做出的取舍/牺牲"
}
请注意：JSON 字段必须放在发言的最后，并使用 \`\`\`json ... \`\`\` 标记包裹起来。`
  ].join("\n\n");

  // 格式化以往所有轮次的会议聊天记录作为对话历史上下文
  const historyMessages = formatConversationHistoryForLLM(conversationHistory);

  const promptMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt },
    ...historyMessages,
  ];

  // 拼接当前这一轮的最新 User 问题以及本轮内先于此专家发言的其他专家的观点
  const currentTurnPreviousText = previousTurns.length
    ? "本轮专家讨论中，此前已发言记录：\n" +
      previousTurns.map((turn) => `【${turn.expertName}】：${turn.content}`).join("\n\n")
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
  });

  // 解析大模型返回的 JSON 块
  let stance = "暂无立场摘要";
  let concern = "暂无风险摘要";
  let recommendation = "暂无建议摘要";
  let tradeoff = "暂无取舍摘要";
  let displayContent = responseText;

  try {
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) || responseText.match(/({[\s\S]*?})/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1]);
      stance = parsed.stance || stance;
      concern = parsed.concern || concern;
      recommendation = parsed.recommendation || recommendation;
      tradeoff = parsed.tradeoff || tradeoff;

      displayContent = responseText.replace(jsonMatch[0], "").trim();
    }
  } catch (e) {
    console.warn("Failed to parse expert JSON response, falling back to regex extraction", e);
    const matchField = (field: string) => {
      const regex = new RegExp(`"${field}"\\s*:\\s*"([^"]+)"`);
      const res = responseText.match(regex);
      return res ? res[1] : "";
    };
    stance = matchField("stance") || stance;
    concern = matchField("concern") || concern;
    recommendation = matchField("recommendation") || recommendation;
    tradeoff = matchField("tradeoff") || tradeoff;
  }

  return {
    content: displayContent,
    expertStance: {
      stance,
      concern,
      recommendation,
      tradeoff,
    },
  };
}

// 2. 主持人决策综合
export async function getSynthesis({
  question,
  projectContext = "",
  expertRounds,
  moderatorId = "balanced",
  engineConfig,
  conversationHistory = [],
}: {
  question: string;
  projectContext?: string;
  expertRounds: { expertName: string; content: string }[];
  moderatorId?: string;
  engineConfig?: LLMEngineConfig;
  conversationHistory?: ChatMessage[];
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

  const systemPrompt = `你是一名专业的圆桌评审主持人。你的主持风格是：${moderator.name}（${moderator.description}）。
IMPORTANT: 必须全程使用中文（简体中文）进行回答！
请综合本轮所有专家的讨论发言，为用户生成一份极具专业度、可执行的会议纪要。
输出格式要求：
你必须输出一个纯 JSON 块。不得含有任何 markdown 格式的说明文字，仅返回 JSON：
{
  "summary": "本次会议综合性的总结词，交代主持结论",
  "consensus": ["共识点一", "共识点二"],
  "disagreements": ["主要的分歧点一", "主要的分歧点二"],
  "decisions": ["最终的主持决策决定一", "最终的主持决策决定二"],
  "nextActions": ["下一步行动一", "下一步行动二"]
}
注意：直接输出 JSON 格式即可。`;

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
    temperature: 0.3,
  });

  try {
    const jsonMatch = responseText.match(/({[\s\S]*?})/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]);
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
}: {
  question: string;
  previousTurns: { expertName: string; content: string }[];
  candidateExperts: Expert[];
  engineConfig?: LLMEngineConfig;
  conversationHistory?: ChatMessage[];
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

  const systemPrompt = `你名是会议发言调度官。根据当前的讨论问题和历史发言内容，从剩余的候选发言专家中，挑选一个“与当前话题最契合、最应该进行回应或发言”的专家。
候选专家列表：
${candidateExperts.map((exp) => `- ID: ${exp.id}, 专家名称: ${exp.name}, 判断视角: ${exp.lens}`).join("\n")}

请从列表中选择其一，仅返回选中的专家 ID，不要输出任何其他解释文字。`;

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
    temperature: 0.1,
  });

  const cleanedId = chosenId.trim();
  const matched = candidateExperts.find((c) => c.id === cleanedId);
  return matched ? matched.id : candidateExperts[0].id;
}

// 4. 提炼全场最终结论
export async function getFinalConclusion({
  conversationHistory = [],
  engineConfig,
}: {
  conversationHistory: ChatMessage[];
  engineConfig?: LLMEngineConfig;
}): Promise<string> {
  const activeEngine = engineConfig || getSystemEngine();
  
  if (!activeEngine) {
    throw new Error(
      "未配置 API Key 且前端未添加自定义大模型。请配置密钥后重试！"
    );
  }

  const systemPrompt = `你是一名高阶会议纪要与战略复盘专家。
IMPORTANT: 必须全程使用中文（简体中文）进行回答！
请根据以下所有的会议历史记录，全面客观地提取出本场会议的“最终结论”。
输出要求：
1. 结论必须是对整场会议核心共识、遗留分歧、后续行动的精炼总结。
2. 必须直接输出纯文本的 Markdown 格式（建议使用二级/三级标题、加粗、列表），不需要包裹 JSON，也不要包含多余的客套话。
3. 语言必须高度专业、客观、不偏不倚，具有“一锤定音”的总裁办汇报风格。`;

  const historyMessages = formatConversationHistoryForLLM(conversationHistory);

  const promptMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt },
    ...historyMessages,
    { role: "user", content: "请根据上述会议全程记录，提炼一份极具执行指导意义的最终结论（仅输出 Markdown）。" }
  ];

  const responseText = await callLLM({
    config: activeEngine,
    messages: promptMessages,
    temperature: 0.3, // 降低温度以保证结论的确定性与客观性
  });

  return responseText.trim();
}
