import { getFinalConclusion } from "@/lib/model-router";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { projectContext,
      conversationHistory, engineConfig, llmParams, systemPrompts } = body;

    if (!conversationHistory || !Array.isArray(conversationHistory)) {
      return Response.json({ error: "conversationHistory is required" }, { status: 400 });
    }

    const conclusion = await getFinalConclusion({
      projectContext,
      conversationHistory,
      engineConfig,
      llmParams,
      systemPrompts,
    });

    return Response.json({ conclusion });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to synthesize conclusion.";
    return Response.json({ error: message }, { status: 500 });
  }
}
