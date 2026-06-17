import { callLLM, getSystemEngine } from "@/lib/model-router";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { task, input, engineConfig, meetingContext, systemPrompts } = body;

    if (!task || !input) {
      return Response.json({ error: "task and input are required" }, { status: 400 });
    }

    const activeEngine = engineConfig || getSystemEngine();
    if (!activeEngine) {
      return Response.json({ error: "No LLM engine available" }, { status: 500 });
    }

    let systemPrompt = "";
    let userPrompt = "";

    if (task === "meeting_description") {
      systemPrompt = systemPrompts?.meetingDescPrompt || "你是一个专业的高管会议秘书。你的任务是根据给定的会议主题，生成一段专业、精炼的会议描述（核心议题上下文）。要求语气正式，直接切入重点，只输出1-2句话即可，绝对不要包含任何多余的问候语或解释。";
      userPrompt = `会议主题/名称：${input}`;
    } else if (task === "expert_details") {
      const defaultExpertPrompt = `你是一个智能体人设构建专家。你需要为专家【{expertName}】自动生成符合其身份特征的系统设定。
如果提供了会议上下文，请确保生成的人设紧密贴合会议语境。
会议名称：{meetingName}
会议描述：{meetingDesc}

请直接返回JSON格式（不要加\`\`\`json代码块，也不要加任何注释和废话），格式严格遵循如下结构：
{
  "lens": "不超过20字的审视视角，例如：商业价值评估、代码架构安全...",
  "temperament": "不超过20字的性格与气质描述，例如：冷静客观、数据驱动、风险厌恶...",
  "focus": ["关注点1", "关注点2", "关注点3"],
  "systemPrompt": "一段完整的系统提示词，以第一人称设定，不超过100字，说明该专家的核心职责、分析问题的视角以及他/她的利益立场。"
}`;
      let rawPrompt = systemPrompts?.expertDetailsPrompt || defaultExpertPrompt;
      
      const mName = meetingContext?.name || "未知";
      const mDesc = meetingContext?.description || "无";
      
      systemPrompt = rawPrompt
        .replace(/{expertName}/g, input || "")
        .replace(/{meetingName}/g, mName)
        .replace(/{meetingDesc}/g, mDesc);
        
      userPrompt = `请开始生成专家人设（仅输出JSON）：${input}`;
    } else {
      return Response.json({ error: "Invalid task" }, { status: 400 });
    }

    const responseText = await callLLM({
      config: activeEngine,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.7,
      maxTokens: 2048,
    });

    if (task === "expert_details") {
      try {
        const firstBrace = responseText.indexOf('{');
        const lastBrace = responseText.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
          const jsonString = responseText.substring(firstBrace, lastBrace + 1);
          const jsonResponse = JSON.parse(jsonString);
          return Response.json({ result: jsonResponse });
        } else {
          throw new Error("No JSON object found in response");
        }
      } catch (e) {
        console.error("Failed to parse JSON response from LLM:", responseText);
        return Response.json({ error: "解析模型响应的JSON失败，模型返回的可能不是有效格式。原始返回：" + responseText.substring(0, 50) + "..." }, { status: 500 });
      }
    }

    return Response.json({ result: responseText });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate AI content.";
    return Response.json({ error: message }, { status: 500 });
  }
}
