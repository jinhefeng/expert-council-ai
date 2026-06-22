import { getDecisionOptions } from "@/lib/model-router";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      question,
      projectContext,
      conversationHistory,
      synthesisSummary,
      engineConfig,
      llmParams,
      systemPrompts,
    } = body;

    if (!question || !synthesisSummary) {
      return Response.json({ error: "question and synthesisSummary are required" }, { status: 400 });
    }

    const options = await getDecisionOptions({
      question,
      projectContext,
      conversationHistory: conversationHistory || [],
      synthesisSummary,
      engineConfig,
      llmParams: llmParams || undefined,
      systemPrompts: systemPrompts || undefined,
    });

    return Response.json({ options });
  } catch (error) {
    console.error("[decision-options] 决策选项生成失败:", error);
    const message = error instanceof Error ? error.message : "Failed to generate decision options.";
    return Response.json({ error: message }, { status: 500 });
  }
}
