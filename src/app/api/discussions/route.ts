import { createDiscussion } from "@/lib/model-router";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await createDiscussion(body);
    return Response.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create discussion.";
    return Response.json({ error: message }, { status: 400 });
  }
}
