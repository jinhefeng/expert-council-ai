import { Expert, moderatorModes, pickExperts } from "./experts";

export type DiscussionRequest = {
  question: string;
  projectContext?: string;
  conversationHistory?: ConversationTurn[];
  expertIds: string[];
  customExperts?: Expert[];
  moderatorId?: string;
  provider?: "mock" | "qwen";
};

export type ConversationTurn = {
  role: "user" | "assistant";
  content: string;
  sourceNames?: string[];
};

export type ExpertRound = {
  expertId: string;
  expertName: string;
  title: string;
  stance: string;
  concern: string;
  recommendation: string;
  tradeoff: string;
};

export type DiscussionResponse = {
  provider: "mock" | "qwen";
  model: string;
  usedRealModel: boolean;
  note?: string;
  expertRounds: ExpertRound[];
  synthesis: {
    summary: string;
    consensus: string[];
    disagreements: string[];
    decisions: string[];
    nextActions: string[];
  };
  promptPreview: string;
};

const MAX_EXPERTS = 5;

export async function createDiscussion(
  input: DiscussionRequest,
): Promise<DiscussionResponse> {
  const question = normalizeText(input.question, 4000);
  const projectContext = normalizeText(input.projectContext ?? "", 2000);
  const conversationHistory = normalizeConversationHistory(
    input.conversationHistory ?? [],
  );
  const selectedExperts = resolveSelectedExperts(
    input.expertIds,
    input.customExperts,
  );

  if (!question) {
    throw new Error("Question is required.");
  }

  if (selectedExperts.length === 0) {
    throw new Error("At least one expert is required.");
  }

  if (input.provider === "qwen" && process.env.DASHSCOPE_API_KEY) {
    return runQwenDiscussion({
      question,
      projectContext,
      conversationHistory,
      selectedExperts,
      moderatorId: input.moderatorId,
    });
  }

  return createMockDiscussion({
    question,
    projectContext,
    conversationHistory,
    selectedExperts,
    moderatorId: input.moderatorId,
    providerRequested: input.provider,
  });
}

function createMockDiscussion({
  question,
  projectContext,
  conversationHistory,
  selectedExperts,
  moderatorId,
  providerRequested,
}: {
  question: string;
  projectContext: string;
  conversationHistory: ConversationTurn[];
  selectedExperts: Expert[];
  moderatorId?: string;
  providerRequested?: "mock" | "qwen";
}): DiscussionResponse {
  const expertRounds = selectedExperts.map((expert) => mockExpertRound(expert));
  const moderator =
    moderatorModes.find((mode) => mode.id === moderatorId) ?? moderatorModes[0];

  return {
    provider: "mock",
    model: "local-mock",
    usedRealModel: false,
    note:
      providerRequested === "qwen"
        ? "没有检测到 DASHSCOPE_API_KEY，已自动使用本地模拟结果。"
        : undefined,
    expertRounds,
    synthesis: {
      summary: `${moderator.name}认为，这个问题需要先明确目标，再决定视觉、文案和交互的取舍。`,
      consensus: [
        "先把本次设计的首要目标写成一句话，避免专家各自优化不同指标。",
        "把建议拆成高影响、低成本的修改项，先验证最关键假设。",
        "保留角色分歧，因为分歧往往对应真实业务取舍。",
      ],
      disagreements: [
        "品牌侧可能希望更克制，增长侧可能希望更强行动召唤。",
        "UI 侧关注完成度，产品侧会追问这些细节是否值得当前阶段投入。",
      ],
      decisions: [
        "默认采用平衡方案：先提升信息清晰度和主行动路径，再做风格强化。",
        "如果这是商业转化页面，优先让增长设计师和文案策略师参与下一轮。",
      ],
      nextActions: [
        "补充目标用户、页面类型和当前设计截图。",
        "选择 3 个专家做第一轮深度评审，避免讨论过散。",
        "把最终建议整理成 P0/P1/P2 修改清单。",
      ],
    },
    promptPreview: buildPromptPreview({
      question,
      projectContext,
      conversationHistory,
      selectedExperts,
      moderatorName: moderator.name,
    }),
  };
}

async function runQwenDiscussion({
  question,
  projectContext,
  conversationHistory,
  selectedExperts,
  moderatorId,
}: {
  question: string;
  projectContext: string;
  conversationHistory: ConversationTurn[];
  selectedExperts: Expert[];
  moderatorId?: string;
}): Promise<DiscussionResponse> {
  const model = process.env.DASHSCOPE_MODEL || "qwen-plus";
  const moderator =
    moderatorModes.find((mode) => mode.id === moderatorId) ?? moderatorModes[0];

  const expertTexts = await Promise.all(
    selectedExperts.map(async (expert) => {
      const content = await callOpenAICompatible({
        model,
        messages: [
          {
            role: "system",
            content: `${expert.systemPrompt}\n你的性格：${expert.temperament}\n请用中文输出：立场、主要风险、建议、取舍。`,
          },
          {
            role: "user",
            content: buildUserPrompt(
              question,
              projectContext,
              conversationHistory,
            ),
          },
        ],
      });

      return {
        expert,
        content,
      };
    }),
  );

  const synthesisText = await callOpenAICompatible({
    model,
    messages: [
      {
        role: "system",
        content:
          "你是一名设计评审主持人。请综合多位专家观点，输出共识、分歧、最终设计决策和下一步行动。保持清晰、具体、可执行。",
      },
      {
        role: "user",
        content: [
          `主持模式：${moderator.name}`,
          formatConversationHistory(conversationHistory),
          `问题：${question}`,
          projectContext ? `项目背景：${projectContext}` : "",
          "专家观点：",
          ...expertTexts.map(
            ({ expert, content }) => `【${expert.name}】\n${content}`,
          ),
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
  });

  return {
    provider: "qwen",
    model,
    usedRealModel: true,
    expertRounds: expertTexts.map(({ expert, content }) => ({
      expertId: expert.id,
      expertName: expert.name,
      title: expert.title,
      stance: content,
      concern: "由千问模型生成，建议在下一轮把输出结构化成可编辑决策项。",
      recommendation: "保留原始专家观点，并由主持人进行综合。",
      tradeoff: "真实模型回答更灵活，但需要后续加 JSON schema 来提升稳定性。",
    })),
    synthesis: {
      summary: synthesisText,
      consensus: [],
      disagreements: [],
      decisions: [],
      nextActions: [],
    },
    promptPreview: buildPromptPreview({
      question,
      projectContext,
      conversationHistory,
      selectedExperts,
      moderatorName: moderator.name,
    }),
  };
}

async function callOpenAICompatible({
  model,
  messages,
}: {
  model: string;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
}) {
  const baseUrl =
    process.env.DASHSCOPE_BASE_URL ||
    "https://dashscope.aliyuncs.com/compatible-mode/v1";
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.4,
      max_tokens: 1200,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Model request failed: ${detail}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "模型没有返回内容。";
}

function mockExpertRound(expert: Expert): ExpertRound {
  const firstFocus = expert.focus[0];
  const secondFocus = expert.focus[1] ?? expert.focus[0];

  return {
    expertId: expert.id,
    expertName: expert.name,
    title: expert.title,
    stance: `我会先从${firstFocus}看这个问题，而不是马上进入具体画面细节。`,
    concern: `当前最大的风险是${secondFocus}没有被说清楚，导致后续建议可能各自优化不同目标。`,
    recommendation: `建议先补充目标用户、业务目标和当前方案截图，再把修改项拆成“必须改”和“可探索”。`,
    tradeoff: `如果追求速度，可以先做轻量调整；如果追求长期质量，需要把${expert.focus.join("、")}纳入同一套判断标准。`,
  };
}

function buildUserPrompt(
  question: string,
  projectContext: string,
  conversationHistory: ConversationTurn[],
) {
  return [
    formatConversationHistory(conversationHistory),
    projectContext ? `项目背景：${projectContext}` : "",
    `设计问题：${question}`,
    "请输出具体判断，不要只给原则。",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildPromptPreview({
  question,
  projectContext,
  conversationHistory,
  selectedExperts,
  moderatorName,
}: {
  question: string;
  projectContext: string;
  conversationHistory: ConversationTurn[];
  selectedExperts: Expert[];
  moderatorName: string;
}) {
  return [
    `主持人：${moderatorName}`,
    `参与专家：${selectedExperts.map((expert) => expert.name).join("、")}`,
    formatConversationHistory(conversationHistory),
    projectContext ? `项目背景：${projectContext}` : "",
    `设计问题：${question}`,
    "请先让每位专家独立判断，再整理共识、分歧、最终决策和下一步行动。",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function normalizeText(value: string, maxLength: number) {
  return value.trim().slice(0, maxLength);
}

function normalizeConversationHistory(turns: ConversationTurn[]) {
  return turns
    .slice(-8)
    .map((turn) => ({
      role: turn.role,
      content: normalizeText(turn.content, 1200),
      sourceNames: turn.sourceNames?.slice(0, 6).map((name) =>
        normalizeText(name, 120),
      ),
    }))
    .filter((turn) => turn.content);
}

function formatConversationHistory(turns: ConversationTurn[]) {
  if (!turns.length) {
    return "";
  }

  return [
    "最近对话上下文：",
    ...turns.map((turn, index) => {
      const speaker = turn.role === "user" ? "用户" : "专家圆桌";
      const sourceLine = turn.sourceNames?.length
        ? `\n附件：${turn.sourceNames.join("、")}`
        : "";

      return `${index + 1}. ${speaker}：${turn.content}${sourceLine}`;
    }),
    "请把当前问题理解为这段对话的延续，避免重复已经回答过的内容。",
  ].join("\n");
}

function resolveSelectedExperts(ids: string[], customExperts: Expert[] = []) {
  const idSet = new Set(ids);
  const builtInExperts = pickExperts(ids);
  const safeCustomExperts = customExperts
    .map(sanitizeCustomExpert)
    .filter((expert): expert is Expert => Boolean(expert))
    .filter((expert) => idSet.has(expert.id));

  return [...builtInExperts, ...safeCustomExperts].slice(0, MAX_EXPERTS);
}

function sanitizeCustomExpert(expert: Expert): Expert | null {
  const id = normalizeText(expert.id, 80);
  const name = normalizeText(expert.name, 40);
  const title = normalizeText(expert.title, 40) || "自定义视角";
  const lens = normalizeText(expert.lens, 240);
  const temperament =
    normalizeText(expert.temperament, 160) || "按照自定义人物设定进行判断。";
  const systemPrompt = normalizeText(expert.systemPrompt, 1200);

  if (!id || !name || !lens) {
    return null;
  }

  return {
    id,
    name,
    title,
    lens,
    temperament,
    focus: expert.focus?.length
      ? expert.focus.map((item) => normalizeText(item, 24)).filter(Boolean)
      : ["自定义判断", "偏好", "风险", "决策影响"],
    systemPrompt:
      systemPrompt ||
      `你是${name}。请按照这个人物视角评审设计：${lens}。你的性格和判断偏好：${temperament}。请指出这个人物会认可什么、反对什么、担心什么，以及会推动什么修改。`,
  };
}
