import { PromptLogService } from "@/lib/prompt-log-service";

export async function GET() {
  try {
    const logs = PromptLogService.getLogs();
    return Response.json(logs);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch prompt logs.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    PromptLogService.clearLogs();
    return Response.json({ success: true, message: "Logs cleared successfully." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to clear prompt logs.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    PromptLogService.addLog(body);
    return Response.json({ success: true, message: "Log added successfully." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to add prompt log.";
    return Response.json({ error: message }, { status: 500 });
  }
}
