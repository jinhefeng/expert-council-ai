import { getFinalConclusion } from "@/lib/model-router";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { conversationHistory, engineConfig } = body;

    if (!conversationHistory || !Array.isArray(conversationHistory)) {
      return Response.json({ error: "conversationHistory is required" }, { status: 400 });
    }

    const conclusion = await getFinalConclusion({
      conversationHistory,
      engineConfig,
    });

    return Response.json({ conclusion });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to synthesize conclusion.";
    return Response.json({ error: message }, { status: 500 });
  }
}
