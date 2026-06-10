import { getSynthesis } from "@/lib/model-router";

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
    } = body;

    if (!question || !expertRounds) {
      return Response.json({ error: "question and expertRounds are required" }, { status: 400 });
    }

    const synthesis = await getSynthesis({
      question,
      projectContext,
      expertRounds,
      moderatorId,
      engineConfig,
      conversationHistory, // 传入对话历史
    });

    return Response.json(synthesis);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to synthesize discussion.";
    return Response.json({ error: message }, { status: 500 });
  }
}
