import { Expert } from "./types";

declare global {
  var wsRelayServer: any;
  var wsRelayServerWSS: any;
  var wsRelayBotConnections: Map<string, any>;
  var wsRelayOneBotClients: Map<string, any>;
  var wsRelayFrontendConnections: Set<any>;
  var wsRelayLastSentTurnIndices: Map<string, number>;
  var consoleOverridden: boolean;
  var originalLog: (...args: any[]) => void;
  var originalError: (...args: any[]) => void;
  var originalWarn: (...args: any[]) => void;
}

// Ensure this only runs on the Node.js server side
if (typeof window === "undefined") {
  // Dynamic import of 'ws' to avoid Webpack issues in the browser build
  const wsModule = require("ws");
  const urlModule = require("url");
  const fsModule = require("fs");
  const pathModule = require("path");

  function logToFile(msg: string) {
    try {
      const logDir = pathModule.join(process.cwd(), "logs");
      if (!fsModule.existsSync(logDir)) {
        fsModule.mkdirSync(logDir, { recursive: true });
      }
      const logFile = pathModule.join(logDir, "ws-relay.log");
      const timestamp = new Date().toISOString();
      fsModule.appendFileSync(logFile, `[${timestamp}] ${msg}\n`);
    } catch (e) {}
  }

  if (!global.consoleOverridden) {
    global.originalLog = console.log;
    global.originalError = console.error;
    global.originalWarn = console.warn;

    console.log = (...args: any[]) => {
      if (global.originalLog) global.originalLog(...args);
      logToFile(args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" "));
    };

    console.error = (...args: any[]) => {
      if (global.originalError) global.originalError(...args);
      logToFile("[ERROR] " + args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" "));
    };

    console.warn = (...args: any[]) => {
      if (global.originalWarn) global.originalWarn(...args);
      logToFile("[WARN] " + args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" "));
    };

    global.consoleOverridden = true;
  }

  class WSRelayServer {
    private instanceId = Math.random().toString(36).substring(2, 9);
    private wss: any;
    private botConnections: Map<string, any>;
    private registeredTokens = new Map<string, string>();
    private frontendConnections: Set<any>;
    private onebotClients: Map<string, any>;
    private onebotConfigs = new Map<string, { wsEndpoint: string, onebotToken?: string }>();
    private onebotHeartbeats = new Map<string, NodeJS.Timeout>();
    private onebotReconnectTimers = new Map<string, NodeJS.Timeout>();
    private activeOneBotTurns = new Map<string, string>();
    private onebotMessageBuffers = new Map<string, string>();
    private onebotDoneTimers = new Map<string, NodeJS.Timeout>();
    private lastSentTurnIndices: Map<string, number>;

    constructor() {
      if (!global.wsRelayBotConnections) {
        global.wsRelayBotConnections = new Map<string, any>();
      }
      if (!global.wsRelayOneBotClients) {
        global.wsRelayOneBotClients = new Map<string, any>();
      }
      if (!global.wsRelayFrontendConnections) {
        global.wsRelayFrontendConnections = new Set<any>();
      }
      if (!global.wsRelayLastSentTurnIndices) {
        global.wsRelayLastSentTurnIndices = new Map<string, number>();
      }

      this.botConnections = global.wsRelayBotConnections;
      this.onebotClients = global.wsRelayOneBotClients;
      this.frontendConnections = global.wsRelayFrontendConnections;
      this.lastSentTurnIndices = global.wsRelayLastSentTurnIndices;

      this.handoverExistingConnections();

      const port = 18788;
      try {
        if (global.wsRelayServerWSS) {
          this.wss = global.wsRelayServerWSS;
          this.wss.removeAllListeners("connection");
          this.wss.removeAllListeners("error");
          console.log(`[WS-Relay] [${this.instanceId}] Reusing global WebSocketServer on port ${port}`);
        } else {
          this.wss = new wsModule.WebSocketServer({ port });
          global.wsRelayServerWSS = this.wss;
          console.log(`[WS-Relay] [${this.instanceId}] Created new global WebSocketServer on port ${port}`);
        }

        this.wss.on("error", (err: any) => {
          console.error(`[WS-Relay] [${this.instanceId}] WebSocket Relay Server error:`, err);
        });

        this.wss.on("connection", (ws: any, req: any) => {
          const parsedUrl = urlModule.parse(req.url, true);
          const path = parsedUrl.pathname;
          const query = parsedUrl.query;

          if (path === "/frontend") {
            this.handleFrontendConnection(ws);
          } else if (path === "/api/bot/connect" || path === "/bot") {
            const rawToken = query.token || req.headers["authorization"]?.replace("Bearer ", "");
            const token = typeof rawToken === "string" ? rawToken.trim() : rawToken;
            this.handleBotConnection(ws, token);
          } else {
            ws.close(1008, "Invalid connection path");
          }
        });
      } catch (err: any) {
        console.error(`[WS-Relay] [${this.instanceId}] Failed to setup WebSocket Relay Server on port ${port}:`, err.message);
      }
    }

    private handoverExistingConnections() {
      console.log(`[WS-Relay] [${this.instanceId}] Handover existing active connections: frontend: ${this.frontendConnections.size}, bot: ${this.botConnections.size}, onebot: ${this.onebotClients.size}`);
      
      this.frontendConnections.forEach((ws: any) => {
        try {
          ws.removeAllListeners("message");
          ws.removeAllListeners("close");
          ws.removeAllListeners("error");
          
          ws.on("message", (message: string) => this.handleFrontendMessage(ws, message));
          ws.on("close", () => this.handleFrontendClose(ws));
          ws.on("error", (err: any) => {
            console.error(`[WS-Relay] [${this.instanceId}] Frontend socket error:`, err.message);
          });
        } catch (e) {}
      });

      this.botConnections.forEach((ws: any, token: string) => {
        try {
          ws.removeAllListeners("message");
          ws.removeAllListeners("close");
          ws.removeAllListeners("error");

          ws.on("message", (message: string) => this.handleBotMessage(ws, token, message));
          ws.on("close", () => this.handleBotClose(ws, token));
          ws.on("error", (err: any) => {
            console.error(`[WS-Relay] [${this.instanceId}] Bot socket error (Token: ${token.substring(0, 8)}...):`, err.message);
          });
        } catch (e) {}
      });

      this.onebotClients.forEach((client: any, expertId: string) => {
        try {
          client.removeAllListeners("message");
          client.removeAllListeners("close");
          client.removeAllListeners("error");

          client.on("message", (data: any) => this.handleOneBotMessage(expertId, client, data));
          client.on("close", () => this.handleOneBotClose(expertId, client));
          client.on("error", (err: any) => {
            console.error(`[WS-Relay] [${this.instanceId}] OneBot client connection error for ${expertId}:`, err.message);
          });
        } catch (e) {}
      });
    }

    private handleFrontendConnection(ws: any) {
      this.frontendConnections.add(ws);
      console.log(`[WS-Relay] [${this.instanceId}] Frontend client connected. Total: ${this.frontendConnections.size}`);

      this.broadcastBotStatus();

      ws.on("message", (message: string) => this.handleFrontendMessage(ws, message));
      ws.on("close", () => this.handleFrontendClose(ws));
      ws.on("error", (err: any) => {
        console.error(`[WS-Relay] [${this.instanceId}] Frontend socket error:`, err.message);
      });
    }

    private handleFrontendMessage(ws: any, message: string) {
      try {
        const payload = JSON.parse(message);
        console.log(`[WS-Relay] [${this.instanceId}] Received from Frontend:`, payload.type);

        switch (payload.type) {
          case "register_bots":
            this.registerBots(payload);
            break;
          case "request_turn":
            this.forwardTurnToBot(payload);
            break;
          default:
            console.warn(`[WS-Relay] [${this.instanceId}] Unknown frontend message type: ${payload.type}`);
        }
      } catch (e) {
        console.error(`[WS-Relay] [${this.instanceId}] Error processing frontend message:`, e);
      }
    }

    private handleFrontendClose(ws: any) {
      this.frontendConnections.delete(ws);
      console.log(`[WS-Relay] [${this.instanceId}] Frontend client disconnected. Total: ${this.frontendConnections.size}`);
    }

    private registerBots(payload: any) {
      const newRegisteredTokens = new Map<string, string>();
      const currentOneBotIds = new Set<string>();
      const incomingBotsMap = new Map<string, any>();

      if (Array.isArray(payload.bots)) {
        payload.bots.forEach((b: any) => {
          incomingBotsMap.set(b.expertId, b);
          if (b.agentType === "onebot" && b.wsEndpoint) {
            currentOneBotIds.add(b.expertId);
            newRegisteredTokens.set(b.expertId, b.expertId);
          } else if (b.expertId && b.botToken) {
            const cleanToken = b.botToken.trim();
            newRegisteredTokens.set(cleanToken, b.expertId);
          }
        });
      }

      incomingBotsMap.forEach((b, expertId) => {
        if (b.agentType === "onebot" && b.wsEndpoint) {
          const oldConfig = this.onebotConfigs.get(expertId);
          const configChanged = !oldConfig || 
            (oldConfig.wsEndpoint !== b.wsEndpoint || oldConfig.onebotToken !== b.onebotToken);

          if (configChanged) {
            console.log(`[WS-Relay] [${this.instanceId}] Config changed or new for OneBot expert ${expertId}. Reconnecting...`);
            this.onebotConfigs.set(expertId, { wsEndpoint: b.wsEndpoint, onebotToken: b.onebotToken });

            const client = this.onebotClients.get(expertId);
            if (client) {
              try {
                client.removeAllListeners();
                client.close();
              } catch (e) {}
              this.onebotClients.delete(expertId);
            }

            const timer = this.onebotReconnectTimers.get(expertId);
            if (timer) {
              clearTimeout(timer);
              this.onebotReconnectTimers.delete(expertId);
            }

            this.connectToOneBot(expertId, b.wsEndpoint, b.onebotToken);
          }
        }
      });

      this.onebotClients.forEach((client, expertId) => {
        if (!currentOneBotIds.has(expertId)) {
          console.log(`[WS-Relay] [${this.instanceId}] Disconnecting OneBot client for removed expert ${expertId}`);
          try {
            client.removeAllListeners();
            client.close();
          } catch (e) {}
          this.onebotClients.delete(expertId);
          this.onebotConfigs.delete(expertId);
        }
      });

      const obsoleteTokens: string[] = [];
      this.botConnections.forEach((ws, token) => {
        if (!newRegisteredTokens.has(token)) {
          obsoleteTokens.push(token);
        }
      });

      obsoleteTokens.forEach((token) => {
        const ws = this.botConnections.get(token);
        if (ws) {
          console.log(`[WS-Relay] [${this.instanceId}] Disconnecting OpenClaw bot for obsolete token (Token: ${token.substring(0, 8)}...)`);
          try {
            ws.removeAllListeners();
            ws.close(1000, "Token expired or unregistered");
          } catch (e) {}
          this.botConnections.delete(token);
        }
      });

      this.registeredTokens = newRegisteredTokens;
      this.broadcastBotStatus();
    }

    private handleBotConnection(ws: any, token: string) {
      if (!token) {
        ws.close(1008, "Missing BotToken parameter");
        return;
      }

      this.botConnections.set(token, ws);
      const expertId = this.registeredTokens.get(token) || "Unknown Expert";
      console.log(`[WS-Relay] [${this.instanceId}] Bot connected for expert "${expertId}" (Token: ${token.substring(0, 8)}...)`);

      this.broadcastBotStatus();

      ws.on("message", (message: string) => this.handleBotMessage(ws, token, message));
      ws.on("close", () => this.handleBotClose(ws, token));
      ws.on("error", (err: any) => {
        console.error(`[WS-Relay] [${this.instanceId}] Bot socket error (Token: ${token.substring(0, 8)}...):`, err.message);
      });
    }

    private handleBotMessage(ws: any, token: string, message: string) {
      const expertId = this.registeredTokens.get(token) || "Unknown Expert";
      try {
        const payload = JSON.parse(message);
        this.logPayload(`[WS-Relay] [${this.instanceId}] Received OpenClaw payload from bot "${expertId}" (Token: ${token.substring(0, 8)}...)`, payload);

        if (payload.event === "reply.thought" || payload.event === "reply.chunk" || payload.event === "reply.done") {
          const frontendPayload = {
            type: payload.event === "reply.done" ? "stream_done" : "stream_chunk",
            expertId: this.registeredTokens.get(token) || "unknown",
            chunk: payload.data?.chunk || "",
            isThought: payload.event === "reply.thought",
            turnId: payload.data?.turnId
          };
          this.broadcastToFrontend(frontendPayload);
        }
      } catch (e) {
        console.error(`[WS-Relay] [${this.instanceId}] Error processing bot message:`, e);
      }
    }

    private handleBotClose(ws: any, token: string) {
      if (this.botConnections.get(token) === ws) {
        this.botConnections.delete(token);
        const expertId = this.registeredTokens.get(token) || "Unknown Expert";
        console.log(`[WS-Relay] [${this.instanceId}] Bot disconnected for expert "${expertId}"`);
        this.broadcastBotStatus();
      }
    }

    private connectToOneBot(expertId: string, wsEndpoint: string, token?: string) {
      const existing = this.onebotClients.get(expertId);
      if (existing) {
        if (existing.readyState === wsModule.CONNECTING || existing.readyState === wsModule.OPEN) {
          console.log(`[WS-Relay] [${this.instanceId}] OneBot client for ${expertId} is already connecting or open. Skipping duplicate connection.`);
          return;
        }
        try {
          existing.removeAllListeners();
          existing.close();
        } catch (e) {}
        this.onebotClients.delete(expertId);
      }

      const existingHeartbeat = this.onebotHeartbeats.get(expertId);
      if (existingHeartbeat) {
        clearInterval(existingHeartbeat);
        this.onebotHeartbeats.delete(expertId);
      }

      const existingReconnect = this.onebotReconnectTimers.get(expertId);
      if (existingReconnect) {
        clearTimeout(existingReconnect);
        this.onebotReconnectTimers.delete(expertId);
      }

      let targetEndpoint = wsEndpoint;
      if (targetEndpoint.includes("localhost")) {
        targetEndpoint = targetEndpoint.replace("localhost", "127.0.0.1");
      }

      console.log(`[WS-Relay] [${this.instanceId}] Actively connecting to OneBot server for expert ${expertId} at ${targetEndpoint} (original: ${wsEndpoint})...`);
      const headers: any = {};
      if (token) {
        headers["Authorization"] = `Token ${token}`;
      }

      try {
        const client = new wsModule(targetEndpoint, { headers });

        client.on("open", () => {
          this.handleOneBotOpen(expertId, client);
        });

        client.on("message", (data: any) => {
          this.handleOneBotMessage(expertId, client, data);
        });

        client.on("close", () => {
          this.handleOneBotClose(expertId, client);
        });

        client.on("error", (err: any) => {
          this.handleOneBotError(expertId, err);
        });

      } catch (err: any) {
        console.error(`[WS-Relay] [${this.instanceId}] Failed to initiate OneBot connection to ${wsEndpoint}:`, err.message);
      }
    }

    private handleOneBotOpen(expertId: string, client: any) {
      console.log(`[WS-Relay] [${this.instanceId}] OneBot connection established with ${expertId} (QwenPaw)`);
      this.onebotClients.set(expertId, client);
      this.broadcastBotStatus();

      client.send(JSON.stringify({
        time: Math.floor(Date.now() / 1000),
        self_id: 123456,
        post_type: "meta_event",
        meta_event_type: "lifecycle",
        sub_type: "connect"
      }));

      const heartbeatInterval = setInterval(() => {
        if (client.readyState === wsModule.OPEN) {
          client.send(JSON.stringify({
            time: Math.floor(Date.now() / 1000),
            self_id: 123456,
            post_type: "meta_event",
            meta_event_type: "heartbeat",
            status: {
              online: true,
              good: true
            },
            interval: 15000
          }));
        }
      }, 15000);

      this.onebotHeartbeats.set(expertId, heartbeatInterval);
    }

    private handleOneBotMessage(expertId: string, client: any, data: any) {
      try {
        const payload = JSON.parse(data.toString());
        
        if (payload.post_type === "meta_event") {
          console.log(`[WS-Relay] [${this.instanceId}] Received OneBot meta_event (${payload.meta_event_type}) from ${expertId}`);
        } else {
          this.logPayload(`[WS-Relay] [${this.instanceId}] Received OneBot payload from ${expertId}`, payload);
        }

        if (payload.action === "send_private_msg" || payload.action === "send_msg" || payload.action === "send_group_msg") {
          console.log(`[WS-Relay] [${this.instanceId}] Active turns keys: ${Array.from(this.activeOneBotTurns.keys()).join(", ")}, looking for: ${expertId}`);
          
          const turnId = this.activeOneBotTurns.get(expertId) || `turn-${Date.now()}`;
          const rawMsg = payload.params?.message;
          const text = this.extractOneBotMessageText(rawMsg);

          const currentBuffer = this.onebotMessageBuffers.get(expertId) || "";
          const prefix = currentBuffer ? "\n\n" : "";
          this.onebotMessageBuffers.set(expertId, currentBuffer + prefix + text);

          console.log(`[WS-Relay] [${this.instanceId}] OneBot received send_private_msg from ${expertId} for turn ${turnId}, length: ${text.length}. Accumulating.`);

          this.broadcastToFrontend({
            type: "stream_chunk",
            expertId,
            chunk: prefix + text,
            isThought: false,
            turnId
          });

          const existingTimer = this.onebotDoneTimers.get(expertId);
          if (existingTimer) {
            clearTimeout(existingTimer);
          }

          const timer = setTimeout(() => {
            console.log(`[WS-Relay] [${this.instanceId}] OneBot turn completed for ${expertId} (turn: ${turnId}). Triggering stream_done.`);
            this.broadcastToFrontend({
              type: "stream_done",
              expertId,
              turnId
            });

            this.onebotMessageBuffers.delete(expertId);
            this.activeOneBotTurns.delete(expertId);
            this.onebotDoneTimers.delete(expertId);
          }, 800);

          this.onebotDoneTimers.set(expertId, timer);

          client.send(JSON.stringify({
            status: "ok",
            retcode: 0,
            data: {
              message_id: Math.floor(Math.random() * 100000)
            },
            echo: payload.echo
          }));
        }
      } catch (e) {
        console.error(`[WS-Relay] [${this.instanceId}] Error handling OneBot client message:`, e);
      }
    }

    private handleOneBotClose(expertId: string, client: any) {
      console.log(`[WS-Relay] [${this.instanceId}] OneBot connection closed for ${expertId}`);
      
      if (this.onebotClients.get(expertId) === client) {
        this.onebotClients.delete(expertId);
        
        const heartbeat = this.onebotHeartbeats.get(expertId);
        if (heartbeat) {
          clearInterval(heartbeat);
          this.onebotHeartbeats.delete(expertId);
        }

        const oldReconnect = this.onebotReconnectTimers.get(expertId);
        if (oldReconnect) {
          clearTimeout(oldReconnect);
          this.onebotReconnectTimers.delete(expertId);
        }

        this.broadcastBotStatus();

        if (this.onebotConfigs.has(expertId)) {
          const config = this.onebotConfigs.get(expertId)!;
          const timer = setTimeout(() => {
            if (this.onebotConfigs.has(expertId)) {
              this.connectToOneBot(expertId, config.wsEndpoint, config.onebotToken);
            }
          }, 5000);
          this.onebotReconnectTimers.set(expertId, timer);
        }
      } else {
        console.log(`[WS-Relay] [${this.instanceId}] Obsolete OneBot client closed for ${expertId}. Skipping cleanup.`);
      }
    }

    private handleOneBotError(expertId: string, err: any) {
      console.error(`[WS-Relay] [${this.instanceId}] OneBot connection error for ${expertId}:`, err.message);
    }

    private stringToNumericId(str: string): number {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash;
      }
      return Math.abs(hash) % 1000000000 + 10000000;
    }

    private extractOneBotMessageText(message: any): string {
      if (typeof message === "string") {
        return message;
      }
      if (Array.isArray(message)) {
        return message.map((msg: any) => {
          if (typeof msg === "string") return msg;
          if (msg && msg.type === "text") return msg.data?.text || "";
          return "";
        }).join("");
      }
      if (message && typeof message === "object") {
        if (message.type === "text") {
          return message.data?.text || "";
        }
        if (message.data?.text) {
          return message.data.text;
        }
        if (message.text) {
          return message.text;
        }
      }
      return "";
    }

    private logPayload(prefix: string, payload: any) {
      try {
        const cloned = JSON.parse(JSON.stringify(payload));
        const maskSensitive = (obj: any) => {
          if (!obj || typeof obj !== "object") return;
          for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
              const lowerKey = key.toLowerCase();
              if (lowerKey.includes("token") || lowerKey.includes("authorization") || lowerKey.includes("password") || lowerKey.includes("secret")) {
                if (typeof obj[key] === "string") {
                  obj[key] = obj[key].substring(0, Math.min(8, obj[key].length)) + "... (masked)";
                } else {
                  obj[key] = "***";
                }
              } else if (typeof obj[key] === "object") {
                maskSensitive(obj[key]);
              }
            }
          }
        };
        maskSensitive(cloned);
        console.log(`${prefix}:\n${JSON.stringify(cloned, null, 2)}`);
      } catch (e) {
        console.error(`[WS-Relay] [${this.instanceId}] Failed to log payload:`, e);
      }
    }

    private forwardTurnToBot(payload: any) {
      const expertId = payload.expertId;
      const meetingId = payload.meetingId || "default";
      const sessionKey = `${expertId}-${meetingId}`;
      const sessionUserId = this.stringToNumericId(sessionKey);
      
      const previousTurns = payload.previousTurns || [];
      let lastIndex = this.lastSentTurnIndices.get(sessionKey) || 0;
      if (previousTurns.length < lastIndex) {
        lastIndex = 0;
      }
      
      const isIncremental = lastIndex > 0;
      this.lastSentTurnIndices.set(sessionKey, previousTurns.length);

      const onebotWs = this.onebotClients.get(expertId);
      if (onebotWs && onebotWs.readyState === wsModule.OPEN) {
        let messagePrompt = "";
        const expertName = payload.expertName || payload.expertId || "外部专家";

        if (isIncremental) {
          const incrementalTurns = previousTurns.slice(lastIndex);
          const incrementalContent = incrementalTurns.map((t: any) => {
            const cleanContent = (t.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
            return `【${t.expertName}】：${cleanContent}`;
          }).join("\n\n") || "无";

          messagePrompt = `会议新增发言如下：\n\n${incrementalContent}\n\n` +
            `本轮新议题（若有更新）：${payload.question}\n\n` +
            `请针对以上新增的讨论发表您的最新视角发言。如果你支持推理/思考（Reasoning/Thinking），请将你的完整思考与推理过程输出在 \`<think>...\` 和 \`</think>\` 标签内，随后再输出您的正式评审意见。\n` +
            `请在您回答的最后，必须附带如下格式的纯 JSON 结构化摘要（注意：必须包含这四个字段，且不要在 JSON 块后再跟任何其他文字）：\n` +
            `\`\`\`json\n` +
            `{\n` +
            `  "stance": "您的核心立场",\n` +
            `  "concern": "最担忧的风险",\n` +
            `  "recommendation": "具体可落地建议",\n` +
            `  "tradeoff": "做此项决策必须付出的取舍"\n` +
            `}\n` +
            `\`\`\`\n\n` +
            `【安全提示】：你当前扮演的专家角色是【${expertName}】。你只能代表他/她进行本次发言。请在完成你本人的发言及要求的 JSON 摘要后，立即停止输出，严禁进行剧本续写。`;
        } else {
          const cleanPreviousTurns = previousTurns.map((t: any) => {
            const cleanContent = (t.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
            return `【${t.expertName}】：${cleanContent}`;
          }).join("\n\n") || "无";

          const userPrompt = payload.externalAgentPrompt;
          if (typeof userPrompt === "string" && userPrompt.trim() !== "") {
            messagePrompt = userPrompt
              .replace(/\{question\}/g, payload.question || "")
              .replace(/\{context\}/g, payload.context || "无")
              .replace(/\{previousTurns\}/g, cleanPreviousTurns)
              .replace(/\{expertName\}/g, expertName);
          } else {
            messagePrompt = `当前会议新议题：${payload.question}\n\n` +
              `项目背景及附件信息：\n${payload.context || "无"}\n\n` +
              `本轮此前发言记录：\n${cleanPreviousTurns}\n\n` +
              `请针对当前议题表达您的专业视角发言。如果你支持推理/思考（Reasoning/Thinking），请将你的完整思考与推理过程输出在 \`<think>...\` 和 \`</think>\` 标签内，随后再输出您的正式评审意见。\n` +
              `请在您回答的最后，必须附带如下格式的纯 JSON 结构化摘要（注意：必须包含这四个字段，且不要在 JSON 块后再跟任何其他文字）：\n` +
              `\`\`\`json\n` +
              `{\n` +
              `  "stance": "您的核心立场",\n` +
              `  "concern": "最担忧的风险",\n` +
              `  "recommendation": "具体可落地建议",\n` +
              `  "tradeoff": "做此项决策必须付出的取舍"\n` +
              `}\n` +
              `\`\`\`\n\n` +
              `【安全提示】：你当前扮演的专家角色是【${expertName}】。你只能代表他/她进行本次发言。严禁代替、模拟或续写会议中其他专家（如董事长、主持人等）的发言。请在完成你本人的发言及要求的 JSON 摘要后，立即停止输出，严禁进行剧本续写。`;
          }
        }

        const onebotEvent = {
          time: Math.floor(Date.now() / 1000),
          self_id: 123456,
          post_type: "message",
          message_type: "private",
          sub_type: "friend",
          message_id: Math.floor(Math.random() * 1000000),
          user_id: sessionUserId,
          message: messagePrompt,
          raw_message: "",
          font: 0,
          sender: {
            user_id: sessionUserId,
            nickname: "Design Council"
          }
        };

        this.logPayload(`[WS-Relay] [${this.instanceId}] Outgoing OneBot payload to expert "${expertId}" for turn ${payload.turnId} (isIncremental: ${isIncremental})`, onebotEvent);

        onebotWs.send(JSON.stringify(onebotEvent));
        this.activeOneBotTurns.set(expertId, payload.turnId);
        console.log(`[WS-Relay] [${this.instanceId}] Sent OneBot message event to ${expertId} for turn ${payload.turnId} (sessionUserId: ${sessionUserId}, isIncremental: ${isIncremental})`);
        return;
      }

      let targetToken: string | undefined;
      for (const [token, registeredId] of this.registeredTokens.entries()) {
        if (registeredId === expertId) {
          targetToken = token;
          break;
        }
      }

      if (!targetToken) {
        console.error(`[WS-Relay] [${this.instanceId}] No bot token registered for expertId: ${expertId}`);
        this.broadcastToFrontend({
          type: "stream_error",
          expertId,
          error: "未为该专家配置有效的机器人 Token 或 OneBot 地址"
        });
        return;
      }

      const botWs = this.botConnections.get(targetToken);
      if (!botWs || botWs.readyState !== wsModule.OPEN) {
        console.error(`[WS-Relay] [${this.instanceId}] Bot connection offline for expertId: ${expertId}`);
        this.broadcastToFrontend({
          type: "stream_error",
          expertId,
          error: "小龙虾智能体连接已离线，请确保您的本地智能体服务已开启并成功连接"
        });
        return;
      }

      let clawPreviousTurns = [];
      if (isIncremental) {
        const incrementalTurns = previousTurns.slice(lastIndex);
        clawPreviousTurns = incrementalTurns.map((t: any) => ({
          expertName: t.expertName,
          content: (t.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim()
        }));
      } else {
        clawPreviousTurns = previousTurns.map((t: any) => ({
          expertName: t.expertName,
          content: (t.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim()
        }));
      }

      const clawEvent = {
        event: "turn.active",
        data: {
          meetingId: payload.meetingId,
          turnId: payload.turnId,
          question: payload.question,
          context: payload.context,
          previousTurns: clawPreviousTurns,
          isIncremental,
          externalAgentPrompt: payload.externalAgentPrompt || ""
        }
      };

      this.logPayload(`[WS-Relay] [${this.instanceId}] Outgoing OpenClaw payload to expert "${expertId}" for turn ${payload.turnId} (isIncremental: ${isIncremental})`, clawEvent);

      botWs.send(JSON.stringify(clawEvent));
      console.log(`[WS-Relay] [${this.instanceId}] Successfully triggered turn for bot: ${expertId} (isIncremental: ${isIncremental})`);
    }

    private broadcastBotStatus() {
      const statusList: { expertId: string; status: "online" | "offline" }[] = [];
      
      this.registeredTokens.forEach((expertId, token) => {
        if (expertId !== token) {
          const ws = this.botConnections.get(token);
          statusList.push({
            expertId,
            status: ws && ws.readyState === wsModule.OPEN ? "online" : "offline"
          });
        }
      });

      this.onebotClients.forEach((ws, expertId) => {
        statusList.push({
          expertId,
          status: ws && ws.readyState === wsModule.OPEN ? "online" : "offline"
        });
      });

      this.broadcastToFrontend({
        type: "bot_status_update",
        statuses: statusList
      });
    }

    private broadcastToFrontend(message: any) {
      const msgStr = JSON.stringify(message);
      this.frontendConnections.forEach((ws) => {
        if (ws.readyState === wsModule.OPEN) {
          ws.send(msgStr);
        }
      });
    }
  }

  // Next.js 热重载时：仅仅实例化 WSRelayServer。新实例构造函数中会去覆盖全局 WSS 事件与接管物理套接字连接
  global.wsRelayServer = new WSRelayServer();
}

export function initWSRelayServer() {
  // Triggered test comment for HMR handover validation
  return global.wsRelayServer;
}
