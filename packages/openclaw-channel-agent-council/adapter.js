const WebSocket = require("ws");

class AgentCouncilAdapter {
  constructor(config, gateway) {
    this.config = config; // Contains botToken, serverUrl
    this.gateway = gateway; // OpenClaw Gateway instance
    this.ws = null;
    this.serverUrl = config.serverUrl || "ws://localhost:18788/bot";
    this.botToken = config.botToken;
    this.sessionMapping = new Map(); // turnId -> sessionKey
  }

  start() {
    this.connect();
  }

  connect() {
    const url = `${this.serverUrl}?token=${this.botToken}`;
    console.log(`[AgentCouncil-Channel] Connecting to platform at ${url}...`);
    this.ws = new WebSocket(url);

    this.ws.on("open", () => {
      console.log("[AgentCouncil-Channel] Successfully connected to Agent Council Platform!");
    });

    this.ws.on("message", async (data) => {
      try {
        const payload = JSON.parse(data);
        if (payload.event === "turn.active") {
          await this.handleTurnActive(payload.data);
        }
      } catch (e) {
        console.error("[AgentCouncil-Channel] Error handling WebSocket message:", e);
      }
    });

    this.ws.on("close", () => {
      console.log("[AgentCouncil-Channel] Connection lost, reconnecting in 5s...");
      setTimeout(() => this.connect(), 5000);
    });

    this.ws.on("error", (err) => {
      console.error("[AgentCouncil-Channel] WebSocket error:", err.message);
    });
  }

  async handleTurnActive(data) {
    // data: { meetingId, turnId, question, context, previousTurns }
    console.log(`[AgentCouncil-Channel] Turn activated for meeting: ${data.meetingId}, turn: ${data.turnId}`);
    
    // Create or find an OpenClaw Session for this meeting
    const sessionKey = `ac-${data.meetingId}`;
    this.sessionMapping.set(sessionKey, data.turnId);

    // Normalize the input message from Agent Council into OpenClaw's internal Message format
    const incomingMessage = {
      role: "user",
      content: `议题：${data.question}\n\n背景上下文：${data.context || "无"}\n\n此前讨论发言：\n${
        data.previousTurns?.map(t => `【${t.expertName}】：${t.content}`).join("\n") || "暂无"
      }\n\n请针对以上议题表达您的专业视角发言。请在发言结束时附带以下 JSON 格式的结构化摘要：\n\n\`\`\`json\n{\n  \"stance\": \"您的立场总结\",\n  \"concern\": \"您最担心的风险\",\n  \"recommendation\": \"您的具体修改建议\",\n  \"tradeoff\": \"需要做出的取舍/牺牲\"\n}\n\`\`\``
    };

    // Feed the message into OpenClaw gateway
    // This triggers the agent reasoning and eventually calls this.send()
    await this.gateway.receive(sessionKey, incomingMessage);
  }

  // OpenClaw calls this method when the agent has output ready to send back to the user
  send(sessionKey, message) {
    const turnId = this.sessionMapping.get(sessionKey);
    if (!turnId) {
      console.warn(`[AgentCouncil-Channel] No turnId mapping found for session: ${sessionKey}`);
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      if (message.isStream) {
        // Stream chunk
        this.ws.send(JSON.stringify({
          event: "reply.chunk",
          data: {
            turnId,
            chunk: message.content
          }
        }));
      } else {
        // Final complete response or stream ended
        if (message.content) {
          this.ws.send(JSON.stringify({
            event: "reply.chunk",
            data: {
              turnId,
              chunk: message.content
            }
          }));
        }
        
        // Signal completion
        this.ws.send(JSON.stringify({
          event: "reply.done",
          data: { turnId }
        }));
        
        this.sessionMapping.delete(sessionKey);
        console.log(`[AgentCouncil-Channel] Completed turn: ${turnId}`);
      }
    } else {
      console.error("[AgentCouncil-Channel] WebSocket is not open. Failed to send message back.");
    }
  }
}

module.exports = AgentCouncilAdapter;
