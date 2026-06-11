import { getExpertTurn } from "@/lib/model-router";

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
    } = body;

    if (!question || !expert) {
      return Response.json({ error: "question and expert are required" }, { status: 400 });
    }

    const result = await getExpertTurn({
      question,
      projectContext,
      expert,
      previousTurns,
      globalDebateIntensity: Number(globalDebateIntensity ?? 3),
      engineConfig,
      conversationHistory,
      llmParams,
      systemPrompts,
    });

    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate expert turn.";
    return Response.json({ error: message }, { status: 500 });
  }
}
