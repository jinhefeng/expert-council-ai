import { getExpertTurn, getExpertTurnStream } from "@/lib/model-router";
import { getRelevantChunks } from "@/lib/rag-service";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      question,
      projectContext,
      expert,
      previousTurns,
      globalDebateIntensity,
      engineConfig,
      conversationHistory,
      llmParams,
      systemPrompts,
      userProfile,
      meetingName,
      meetingDesc,
    } = body;

    if (!question || !expert) {
      return Response.json({ error: "question and expert are required" }, { status: 400 });
    }

    let enrichedExpert = { ...expert };
    try {
      const knowledgeContext = await getRelevantChunks(expert, question);
      if (knowledgeContext) {
        enrichedExpert.systemPrompt = `【参考评审规范】：
=== 规范开始 ===
${knowledgeContext}
=== 规范结束 ===

在分析和评审当前议题时，请结合上述客观参考规范。如果当前方案偏离或违反了规范中的条款，必须在发言的立场卡片（Stance Card）中精准指出。

${expert.systemPrompt || ""}`;
      }
    } catch (e) {
      console.error("[RAG] 检索外挂出错", e);
    }

    if (engineConfig?.enableStreaming) {
      const responseStream = await getExpertTurnStream({
        question,
        projectContext,
        expert: enrichedExpert,
        previousTurns,
        globalDebateIntensity: Number(globalDebateIntensity ?? 3),
        engineConfig,
        conversationHistory,
        llmParams,
        systemPrompts,
        userProfile,
        meetingName,
        meetingDesc,
      });
      return responseStream;
    } else {
      const result = await getExpertTurn({
        question,
        projectContext,
        expert: enrichedExpert,
        previousTurns,
        globalDebateIntensity: Number(globalDebateIntensity ?? 3),
        engineConfig,
        conversationHistory,
        llmParams,
        systemPrompts,
        userProfile,
        meetingName,
        meetingDesc,
      });

      return Response.json(result);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate expert turn.";
    return Response.json({ error: message }, { status: 500 });
  }
}
