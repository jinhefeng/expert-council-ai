import { getInquiryDecision } from "@/lib/model-router";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      question,
      projectContext,
      conversationHistory,
      engineConfig,
      llmParams,
      systemPrompts,
    } = body;

    if (!question) {
      return Response.json({ error: "question is required" }, { status: 400 });
    }

    const responseText = await getInquiryDecision({
      question,
      projectContext,
      conversationHistory: conversationHistory || [],
      engineConfig,
      llmParams,
      systemPrompts,
    });

    return Response.json({ result: responseText });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to judge inquiry.";
    return Response.json({ error: message }, { status: 500 });
  }
}
