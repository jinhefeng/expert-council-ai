import { Expert } from "./types";

declare global {
  var wsRelayServer: any;
  var wsRelayServerWSS: any;
  var wsRelayBotConnections: Map<string, any>;
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
    private lastSentTurnIndices: Map<string, number>;

    constructor() {
      if (!global.wsRelayBotConnections) {
        global.wsRelayBotConnections = new Map<string, any>();
      }
      if (!global.wsRelayFrontendConnections) {
        global.wsRelayFrontendConnections = new Set<any>();
      }
      if (!global.wsRelayLastSentTurnIndices) {
        global.wsRelayLastSentTurnIndices = new Map<string, number>();
      }

      this.botConnections = global.wsRelayBotConnections;
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
      console.log(`[WS-Relay] [${this.instanceId}] Handover existing active connections: frontend: ${this.frontendConnections.size}, bot: ${this.botConnections.size}`);
      
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

      if (Array.isArray(payload.bots)) {
        payload.bots.forEach((b: any) => {
          if (b.expertId && b.botToken) {
            const cleanToken = b.botToken.trim();
            newRegisteredTokens.set(cleanToken, b.expertId);
          }
        });
      }

      const obsoleteTokens: string[] = [];
      this.botConnections.forEach((ws, token) => {
        if (!newRegisteredTokens.has(token)) {
          obsoleteTokens.push(token);
        }
      });

      obsoleteTokens.forEach((token) => {
        const ws = this.botConnections.get(token);
        if (ws) {
          console.log(`[WS-Relay] [${this.instanceId}] Disconnecting Bot for obsolete token (Token: ${token.substring(0, 8)}...)`);
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
        this.logPayload(`[WS-Relay] [${this.instanceId}] Received CLP payload from bot "${expertId}" (Token: ${token.substring(0, 8)}...)`, payload);

        if (payload.event === "reply.thought" || payload.event === "reply.chunk" || payload.event === "reply.done") {
          const frontendPayload = {
            type: payload.event === "reply.done" ? "stream_done" : "stream_chunk",
            expertId: this.registeredTokens.get(token) || "unknown",
            chunk: payload.data?.chunk || "",
            isThought: payload.event === "reply.thought",
            turnId: payload.data?.turnId,
            expertStance: payload.data?.expertStance
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
      
      const rawPreviousTurns = payload.previousTurns || [];
      const previousTurns = rawPreviousTurns.map((t: any) => {
        let content = t.content || "";
        // 物理清除 <think>...</think> 标签及其内容
        content = content.replace(/<think>[\s\S]*?<\/think>/g, "");
        // 兜底防御：如果是截断未闭合的 <think>，裁切其后的内容
        const thinkIdx = content.indexOf("<think>");
        if (thinkIdx !== -1) {
          content = content.substring(0, thinkIdx);
        }
        return {
          ...t,
          content: content.trim()
        };
      });

      let lastIndex = this.lastSentTurnIndices.get(sessionKey) || 0;
      if (previousTurns.length < lastIndex) {
        lastIndex = 0;
      }
      
      const isIncremental = lastIndex > 0;
      this.lastSentTurnIndices.set(sessionKey, previousTurns.length);

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
          error: "未为该专家配置有效的机器人 Token"
        });
        return;
      }

      const botWs = this.botConnections.get(targetToken);
      if (!botWs || botWs.readyState !== wsModule.OPEN) {
        console.error(`[WS-Relay] [${this.instanceId}] Bot connection offline for expertId: ${expertId}`);
        this.broadcastToFrontend({
          type: "stream_error",
          expertId,
          error: "智能体连接已离线，请确保您的本地智能体服务已开启并成功连接"
        });
        return;
      }

      const clpEvent = {
        event: "turn.request",
        data: {
          meetingId: payload.meetingId,
          turnId: payload.turnId,
          question: payload.question,
          context: payload.context,
          expertName: payload.expertName || "未知专家",
          previousTurns: previousTurns,
          isIncremental,
          externalAgentPrompt: payload.externalAgentPrompt || ""
        }
      };

      this.logPayload(`[WS-Relay] [${this.instanceId}] Outgoing CLP payload to expert "${expertId}" for turn ${payload.turnId} (isIncremental: ${isIncremental})`, clpEvent);

      botWs.send(JSON.stringify(clpEvent));
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
