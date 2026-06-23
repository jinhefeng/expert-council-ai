export interface PromptLogEntry {
  id: string;
  timestamp: number;
  type: "api_sync" | "api_stream" | "external_bot";
  target: string;        // 触发的目标名称，如 “平衡主持人” / “专家小蔚”
  modelOrToken?: string; // 调用引擎（gpt-4o）或机器人的 token
  systemPrompt?: string; // 拼接后的 System Prompt 
  userPrompt?: string;   // 拼接后的最终 User Prompt
  rawPayload?: any;      // 外部智能体 CLP 请求的 raw json
  rawRequestPayload?: any; // 真正喂给大模型 API 的底层 JSON 载荷
  botRequestPayload?: string; // 外部智能体(小龙虾)底层实际喂给 API 的最终 Prompt
}

declare global {
  var promptLogsQueue: PromptLogEntry[] | undefined;
}

if (!global.promptLogsQueue) {
  global.promptLogsQueue = [];
}

export const PromptLogService = {
  addLog(log: Omit<PromptLogEntry, "id" | "timestamp"> & { id?: string }) {
    if (!global.promptLogsQueue) {
      global.promptLogsQueue = [];
    }
    const finalId = log.id || `log-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    
    // 幂等去重
    if (global.promptLogsQueue.some(e => e.id === finalId)) {
      return;
    }

    const entry: PromptLogEntry = {
      ...log,
      id: finalId,
      timestamp: Date.now(),
    };
    global.promptLogsQueue.unshift(entry); // 最新的置于顶部
    if (global.promptLogsQueue.length > 100) {
      global.promptLogsQueue.pop(); // 保持最大 100 条
    }
  },

  getLogs(): PromptLogEntry[] {
    const rawLogs = global.promptLogsQueue || [];
    return rawLogs.map(log => {
      if (log.type === "external_bot" && log.rawPayload) {
        return {
          ...log,
          botRequestPayload: compileExternalAgentPrompt(log.rawPayload)
        };
      }
      return log;
    });
  },

  clearLogs() {
    global.promptLogsQueue = [];
  }
};

export function compileExternalAgentPrompt(data: any): string {
  const question = data.question || "";
  const context = data.context || "";
  const previousTurns = data.previousTurns || [];
  const expertName = data.expertName || "未知专家";
  const expertTitle = data.expertTitle || "未知头衔";
  const externalPromptTpl = data.externalAgentPrompt || "";
  const userTitle = data.userTitle || "首席决策官";
  const userName = data.userName || "主持人";

  let previousTurnsText = "";
  for (const t of previousTurns) {
    let content = t.content || "";
    // 物理清除 <think>...</think> 标签及其内容
    content = content.replace(/<think>[\s\S]*?<\/think>/g, "");
    const thinkIdx = content.indexOf("<think>");
    if (thinkIdx !== -1) {
      content = content.substring(0, thinkIdx);
    }
    const tName = t.expertName || "未知专家";
    const tTitle = t.expertTitle || "未知头衔";
    previousTurnsText += 
      `┌──────────────────────────────────────────\n` +
      `│ 参会专家发言观点：${tName} (${tTitle})\n` +
      `└──────────────────────────────────────────\n` +
      `${content.trim()}\n\n`;
  }
  if (!previousTurnsText) {
    previousTurnsText = "本轮中你是第一个发言的专家。";
  } else {
    previousTurnsText = previousTurnsText.trim();
  }

  if (externalPromptTpl) {
    let prompt = externalPromptTpl;
    prompt = prompt.replace(/{question}/g, question);
    prompt = prompt.replace(/{context}/g, context);
    prompt = prompt.replace(/{previousTurns}/g, previousTurnsText);
    prompt = prompt.replace(/{expertName}/g, expertName);
    prompt = prompt.replace(/{expertTitle}/g, expertTitle);
    prompt = prompt.replace(/{userTitle}/g, userTitle);
    prompt = prompt.replace(/{userName}/g, userName);
    prompt = prompt.replace(/{meetingName}/g, data.meetingName || "未知会议");
    prompt = prompt.replace(/{meetingDesc}/g, data.meetingDesc || "暂无背景描述");
    return prompt;
  } else {
    let prompt = 
      `你当前在会议中扮演的角色是【${expertName}】，核心头衔是【${expertTitle}】。\n` +
      `当前来自人类决策者（${userTitle} ${userName}）的现场干预与最新指令：\n${question}\n` +
      `项目背景：{context}\n` +
      `此前会议发言：\n{previousTurns}\n`;
    prompt = prompt.replace("{context}", context).replace("{previousTurns}", previousTurnsText);
    prompt += 
      `\n请针对上述讨论，发表您的专家评审意见。请使用简体中文进行专业且具有对抗性的回答。\n` +
      `【思维链指引】：如果您的模型支持推理/思考（Reasoning/Thinking），请将您的完整思考和推理过程输出在 \`<think>...</think>\` 标签内，随后再输出您的正式评审意见。\n` +
      `在回答的最后，必须附带如下格式的纯 JSON 结构化摘要：\n` +
      `\`\`\`json\n` +
      `{\n` +
      `  "stance": "您的核心立场",\n` +
      `  "concern": "最担忧的风险",\n` +
      `  "recommendation": "具体可落地建议",\n` +
      `  "tradeoff": "做此项决策必须付出的取舍"\n` +
      `}\n` +
      `\`\`\``;
    return prompt;
  }
}
