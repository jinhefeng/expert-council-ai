import { getNextSpeaker } from "@/lib/model-router";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      question,
      previousTurns,
      candidateExperts,
      engineConfig,
      conversationHistory,
    } = body;

    if (!question || !candidateExperts) {
      return Response.json({ error: "question and candidateExperts are required" }, { status: 400 });
    }

    const nextSpeakerId = await getNextSpeaker({
      question,
      previousTurns,
      candidateExperts,
      engineConfig,
      conversationHistory, // 传入对话历史
    });

    return Response.json({ nextSpeakerId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to determine next speaker.";
    return Response.json({ error: message }, { status: 500 });
  }
}
