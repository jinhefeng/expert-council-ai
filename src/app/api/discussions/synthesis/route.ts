import { getSynthesis, getSynthesisStream } from "@/lib/model-router";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      question,
      projectContext,
      expertRounds,
      moderatorId,
      engineConfig,
      conversationHistory,
      llmParams,
      systemPrompts,
      userProfile,
    } = body;

    if (!question || !expertRounds) {
      return Response.json({ error: "question and expertRounds are required" }, { status: 400 });
    }

    if (engineConfig?.enableStreaming) {
      const responseStream = await getSynthesisStream({
        question,
        projectContext,
        expertRounds,
        moderatorId,
        engineConfig,
        conversationHistory,
        llmParams,
        systemPrompts,
        userProfile,
      });
      return responseStream;
    } else {
      const synthesis = await getSynthesis({
        question,
        projectContext,
        expertRounds,
        moderatorId,
        engineConfig,
        conversationHistory,
        llmParams,
        systemPrompts,
        userProfile,
      });

      return Response.json(synthesis);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to synthesize discussion.";
    return Response.json({ error: message }, { status: 500 });
  }
}
