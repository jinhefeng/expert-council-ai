import { Expert } from "./types";
import { PromptLogService, compileExternalAgentPrompt } from "./prompt-log-service";

declare global {
  var wsRelayServer: any;
  var wsRelayServerWSS: any;
  var wsRelayBotConnections: Map<string, any>;
  var wsRelayFrontendConnections: Set<any>;
  var wsRelayLastSentTurnIndices: Map<string, number>;
  var wsRelayTurnBuffers: Map<string, any>;
  var consoleOverridden: boolean;
  var originalLog: (...args: any[]) => void;
  var originalError: (...args: any[]) => void;
  var originalWarn: (...args: any[]) => void;
}

let createServerInstance: (() => any) | null = null;

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
    // turnId 粒度的发言缓冲：用于精准匹配上下文压缩周期 (多租户安全结构体缓存)
    private turnBuffers: Map<string, any>;

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
      if (!global.wsRelayTurnBuffers || !(global.wsRelayTurnBuffers instanceof Map)) {
        global.wsRelayTurnBuffers = new Map<string, any>();
      }

      this.botConnections = global.wsRelayBotConnections;
      this.frontendConnections = global.wsRelayFrontendConnections;
      this.lastSentTurnIndices = global.wsRelayLastSentTurnIndices;
      this.turnBuffers = global.wsRelayTurnBuffers;

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
      // 惰性防御性属性补录：防范热重载引起的 constructor 未执行
      if (!this.turnBuffers) {
        this.turnBuffers = global.wsRelayTurnBuffers || new Map<string, any>();
      }

      // 内存垃圾回收 (GC)：清理超过 5 分钟（300,000 毫秒）未更新的僵尸缓冲，确保高并发多租户环境下无内存泄露
      const now = Date.now();
      this.turnBuffers.forEach((item, key) => {
        if (item && now - item.updatedAt > 300000) {
          this.turnBuffers.delete(key);
          console.log(`[WS-Relay] [GC] Cleaned zombie buffer for turnId=${key} due to TTL timeout.`);
        }
      });

      const expertId = this.registeredTokens.get(token) || "Unknown Expert";
      try {
        const payload = JSON.parse(message);
        this.logPayload(`[WS-Relay] [${this.instanceId}] Received CLP payload from bot "${expertId}" (Token: ${token.substring(0, 8)}...)`, payload);

        if (payload.event === "reply.thought" || payload.event === "reply.chunk" || payload.event === "reply.done") {
          const resolvedExpertId = this.registeredTokens.get(token) || "unknown";
          const turnId = payload.data?.turnId || "";

          if (payload.event === "reply.done") {
            const bufferItem = turnId ? this.turnBuffers.get(turnId) : null;
            const fullText = bufferItem?.text || "";
            const isCompactionDone = fullText.toLowerCase().includes("context compaction");

            if (isCompactionDone) {
              console.log(`[WS-Relay] [${this.instanceId}] Compaction done detected for turnId=${turnId}. Intercepting done and broadcasting stream_compaction_pending.`);
              this.broadcastToFrontend({
                type: "stream_compaction_pending",
                expertId: resolvedExpertId,
                turnId,
                chunk: "🔄 正在整理上下文记忆中..."
              });
              if (turnId) {
                // 重置缓冲以备后续接收真正发言 (保存 expertId 和最新时间戳)
                this.turnBuffers.set(turnId, {
                  expertId: resolvedExpertId,
                  text: "",
                  updatedAt: Date.now()
                });
              }
            } else {
              console.log(`[WS-Relay] [${this.instanceId}] Real reply done for turnId=${turnId}. Broadcasting stream_done.`);
              if (turnId) {
                this.turnBuffers.delete(turnId);
              }
              this.broadcastToFrontend({
                type: "stream_done",
                expertId: resolvedExpertId,
                chunk: payload.data?.chunk || "",
                isThought: false,
                turnId,
                expertStance: payload.data?.expertStance
              });
            }
          } else {
            // reply.chunk 或 reply.thought
            const chunk = payload.data?.chunk || "";
            let isCompactingFlow = false;

            if (turnId && payload.event === "reply.chunk") {
              const bufferItem = this.turnBuffers.get(turnId);
              const currentText = bufferItem?.text || "";
              const nextText = currentText + chunk;

              this.turnBuffers.set(turnId, {
                expertId: resolvedExpertId,
                text: nextText,
                updatedAt: Date.now()
              });

              // 检查该流式片段或当前累积内容是否为上下文压缩相关日志
              const lowerText = nextText.toLowerCase();
              if (lowerText.includes("context compaction") || lowerText.includes("正在整理上下文")) {
                isCompactingFlow = true;
              }
            }

            if (isCompactingFlow) {
              // 属于上下文压缩流量：静默拦截，只向下发等待通知以消除前端闪现现象
              this.broadcastToFrontend({
                type: "stream_compaction_pending",
                expertId: resolvedExpertId,
                turnId,
                chunk: "🔄 正在整理上下文记忆中..."
              });
              return; // 直接拦截返回，不广播给前端作为普通消息内容
            }

            const chunkPayload = {
              type: "stream_chunk" as const,
              expertId: resolvedExpertId,
              chunk,
              isThought: payload.event === "reply.thought",
              turnId,
              expertStance: payload.data?.expertStance
            };
            this.broadcastToFrontend(chunkPayload);
          }
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

        // 惰性属性防御绑定
        if (!this.turnBuffers) {
          this.turnBuffers = global.wsRelayTurnBuffers || new Map<string, any>();
        }

        // 物理断连 GC：清除该 Bot 之前留在内存中的所有挂起发言缓冲，强健防泄露
        this.turnBuffers.forEach((item, key) => {
          if (item && item.expertId === expertId) {
            this.turnBuffers.delete(key);
            console.log(`[WS-Relay] [GC] Physically cleaned pending buffer for turnId=${key} due to Bot disconnection.`);
          }
        });

        // 当机器人意外断开连接时，主动通知前端当前专家的发言已经中断，触发前端发言的自愈与异常防护
        this.broadcastToFrontend({
          type: "stream_error",
          expertId,
          error: "智能体连接意外断开，发言已中断"
        });
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
          expertTitle: payload.expertTitle || "未知头衔",
          previousTurns: isIncremental ? previousTurns.slice(lastIndex) : previousTurns,
          isIncremental,
          externalAgentPrompt: payload.externalAgentPrompt || "",
          userTitle: payload.userTitle || "首席决策官",
          userName: payload.userName || "主持人",
          meetingName: payload.meetingName || "未知会议",
          meetingDesc: payload.meetingDesc || "暂无背景描述"
        }
      };

      this.logPayload(`[WS-Relay] [${this.instanceId}] Outgoing CLP payload to expert "${expertId}" for turn ${payload.turnId} (isIncremental: ${isIncremental})`, clpEvent);

      try {
        const compiledPrompt = compileExternalAgentPrompt(clpEvent.data);
        void this.sendLogToMainServer({
          id: `log-req-${expertId}-${payload.turnId}`,
          type: "external_bot",
          target: `外部专家: ${payload.expertName || expertId}`,
          modelOrToken: targetToken ? targetToken.substring(0, Math.min(12, targetToken.length)) + "..." : "Unknown Token",
          botRequestPayload: compiledPrompt,
          systemPrompt: "传给外部智能体小龙虾的系统指令模版与拼接内容",
          userPrompt: compiledPrompt,
          rawPayload: clpEvent.data
        });
      } catch (e) {
        console.error("[PromptLog] 记录外部机器人日志失败:", e);
      }

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

    private async sendLogToMainServer(log: any) {
      try {
        // 1. 内存直存双保险
        PromptLogService.addLog(log);
      } catch (e) {
        console.log("[WS-Relay] 写入内存日志提示 (非致命错误，可能是多进程隔离):", e);
      }

      try {
        // 2. HTTP 降级推送
        const port = process.env.PORT || "3000";
        const response = await fetch(`http://127.0.0.1:${port}/api/prompt-logs`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(log)
        });
        if (!response.ok) {
          console.log(`[WS-Relay] 向主站发送日志提示: ${response.statusText} (可能是多进程隔离)`);
        }
      } catch (e) {
        // 忽略报错，在内存直存已保底的情况下，网络隔离时降级不输出错误，仅 debug 级别记录
      }
    }

    public hotReload() {
      console.log(`[WS-Relay] [${this.instanceId}] Performing hot reload and connection handover...`);
      if (!this.turnBuffers) {
        this.turnBuffers = global.wsRelayTurnBuffers || new Map<string, any>();
      }
      this.handoverExistingConnections();
    }
  }

  // 闭包函数，用于实例化局部作用域内的 WSRelayServer 类
  createServerInstance = () => {
    if (global.wsRelayServer) {
      // 动态接管原型，平滑替换为最新代码的逻辑，并重新绑定已有连接的监听器
      Object.setPrototypeOf(global.wsRelayServer, WSRelayServer.prototype);
      global.wsRelayServer.hotReload();
      console.log(`[WS-Relay] Successfully upgraded wsRelayServer instance prototype to latest.`);
    } else {
      global.wsRelayServer = new WSRelayServer();
    }
    return global.wsRelayServer;
  };
}
 
export function initWSRelayServer() {
  // 1. 如果处于 Next.js 静态打包构建、页面生成或 Edge 边缘运行环境，跳过实例化
  if (
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.IS_NEXT_BUILD === "true" ||
    process.env.NEXT_RUNTIME === "edge"
  ) {
    return null;
  }
 
  // 2. 在服务端真正运行且有实际需要时进行惰性单例初始化
  if (createServerInstance) {
    return createServerInstance();
  }
  return null;
}
