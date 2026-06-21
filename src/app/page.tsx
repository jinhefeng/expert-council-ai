"use client";

import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { experts as defaultExperts, moderatorModes, mergeSystemExperts } from "@/lib/experts";
import { ExpertModal } from "@/components/ExpertModal";
import { LocalStorageService } from "@/lib/storage-service";
import { extractAndCleanJson, cleanStreamingJson, beautifyListFormatting } from "@/lib/content-parser";
import {
  Expert,
  LLMEngineConfig,
  Meeting,
  ChatMessage,
  SourceItem,
  UserProfile,
  LLMParamsConfig,
  SystemPromptsConfig,
  BusinessDefaultsConfig
} from "@/lib/types";

const TENANT_ID = "default-org";

const SYSTEM_LOADERS = {
  "__WAKING__": {
    title: "正在唤醒外部智能体",
    subtitle: "正在载入历史对话上下文、附件并装载长记忆..."
  },
  "__COMPACTING__": {
    title: "正在整理会议上下文记忆",
    subtitle: "当前多轮对话超出模型窗口限制，正在网关执行有状态增量信息压缩..."
  },
  "__TIMEOUT__": {
    title: "智能体发言已超时",
    subtitle: "外部智能体响应已超出安全耗时阈值，系统已自动跳过该环节以保障会议流程连续性。",
    isError: true
  },
  "__ERROR__": {
    title: "智能体连接异常",
    subtitle: "本地中继网关已断开，或该智能体连接已离线。请检查外部智能体服务状态。",
    isError: true
  }
} as const;


function ensureString(val: any): string {
  if (val === null || val === undefined) {
    return "";
  }
  if (typeof val === "string") {
    return val;
  }
  if (Array.isArray(val)) {
    return val
      .map((item) => {
        if (item === null || item === undefined) {
          return "";
        }
        if (typeof item === "object") {
          return `- ${JSON.stringify(item)}`;
        }
        return `- ${item}`;
      })
      .filter((line) => line.trim() !== "")
      .join("\n");
  }
  if (typeof val === "object") {
    return JSON.stringify(val);
  }
  return String(val);
}

export default function Home() {
  // 存储服务实例
  const storage = useMemo(() => new LocalStorageService(), []);

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [activeMeetingId, setActiveMeetingId] = useState<string>("");
  const [systemExperts, setSystemExperts] = useState<Expert[]>(defaultExperts);
  const [customExperts, setCustomExperts] = useState<Expert[]>([]);
  const [engineConfigs, setEngineConfigs] = useState<LLMEngineConfig[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile>({ name: "产品经理", title: "需求提出人" });
  
  const [botStatuses, setBotStatuses] = useState<Record<string, "online" | "offline">>({});
  const wsRef = useRef<WebSocket | null>(null);
  const wsResolversRef = useRef<Record<string, {
    text: string;
    onChunk?: (text: string) => void;
    resolve: (res: { content: string; expertStance: any }) => void;
    reject: (err: Error) => void;
  }>>({});
  
  const [llmParams, setLlmParams] = useState<LLMParamsConfig | null>(null);
  const [systemPrompts, setSystemPrompts] = useState<SystemPromptsConfig | null>(null);
  const [businessDefaults, setBusinessDefaults] = useState<BusinessDefaultsConfig | null>(null);
  
  // 活动的模型引擎 ID：真刀真枪下默认使用系统环境内置的 system-env
  const [activeEngineId, setActiveEngineId] = useState<string>("system-env");

  // 前端辅助交互状态
  const [question, setQuestion] = useState("");
  const [isLoaded, setIsLoaded] = useState(false);
  const [expertActivationTimestamps, setExpertActivationTimestamps] = useState<Record<string, number>>({});
  const [projectContext, setProjectContext] = useState("");
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [isDraggingSources, setIsDraggingSources] = useState(false);
  
  // 运行期讨论状态机
  const [isEditingMeeting, setIsEditingMeeting] = useState(false);
  const [meetingDraft, setMeetingDraft] = useState<Partial<Meeting>>({});

  // 最终结论相关状态
  const [generatingConclusions, setGeneratingConclusions] = useState<Record<string, boolean>>({});
  const [isEditingConclusion, setIsEditingConclusion] = useState(false);
  const [conclusionDraft, setConclusionDraft] = useState("");
  const [unlockedComposers, setUnlockedComposers] = useState<Record<string, boolean>>({});
  
  const [discussingMeetings, setDiscussingMeetings] = useState<Record<string, boolean>>({});
  const [speakingExpertIds, setSpeakingExpertIds] = useState<Record<string, string | null>>({});
  const [synthesisPendingMeetings, setSynthesisPendingMeetings] = useState<Record<string, boolean>>({});
  const [assigningNextSpeaker, setAssigningNextSpeaker] = useState<Record<string, boolean>>({});

  const discussAbortControllersRef = useRef<Record<string, AbortController>>({});
  const conclusionAbortControllersRef = useRef<Record<string, AbortController>>({});

  // 面板展开/收起
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // 弹窗与表单配置状态
  const [isCustomModalOpen, setIsCustomModalOpen] = useState(false);
  const [customModalMode, setCustomModalMode] = useState<"create" | "edit">("create");
  const [customModalDraft, setCustomModalDraft] = useState<Partial<Expert>>({});
  const [isMeetingModalOpen, setIsMeetingModalOpen] = useState(false);
  const [meetingModalMode, setMeetingModalMode] = useState<"create" | "edit">("create");
  const [newMeetingDraft, setNewMeetingDraft] = useState<Partial<Meeting>>({});
  const [isGeneratingMeetingDesc, setIsGeneratingMeetingDesc] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState<string>("");

  async function handleGenerateMeetingDesc() {
    if (!newMeetingDraft.name?.trim()) return;
    setIsGeneratingMeetingDesc(true);
    try {
      const activeEngine = engineConfigs.find(c => c.isActive) || engineConfigs[0];
      const res = await fetch("/api/discussions/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: "meeting_description",
          input: newMeetingDraft.name,
          engineConfig: activeEngine,
          systemPrompts: systemPrompts,
        }),
      });
      const data = await res.json();
      if (data.result) {
        setNewMeetingDraft(prev => ({ ...prev, description: data.result }));
      } else if (data.error) {
        alert("AI 生成失败: " + data.error);
      }
    } catch (e) {
      console.error("Failed to generate meeting desc:", e);
      alert("AI 生成失败，可能网络连接异常。");
    } finally {
      setIsGeneratingMeetingDesc(false);
    }
  }

  const [isEngineModalOpen, setIsEngineModalOpen] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<Expert | null>(null);

  // 自定义模型配置表单
  const [engineDraft, setEngineDraft] = useState<LLMEngineConfig>({
    id: "",
    name: "",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-4o",
    isActive: false,
  });
  const [engineError, setEngineError] = useState("");

  // 叫停控制器引用
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const chatThreadRef = useRef<HTMLElement | null>(null);
  const scrollPositions = useRef<Record<string, number>>({});
  const prevMeetingIdRef = useRef<string | null>(null);
  const isAutoScrollEnabled = useRef<boolean>(true);

  const handleThreadScroll = () => {
    if (!chatThreadRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = chatThreadRef.current;
    // 如果滚动条距离底部小于 150px，视为在最底部，开启自动滚动
    isAutoScrollEnabled.current = scrollHeight - scrollTop - clientHeight < 150;
  };

  const handleSwitchMeeting = (newMeetingId: string) => {
    if (activeMeetingId && chatThreadRef.current) {
      scrollPositions.current[activeMeetingId] = chatThreadRef.current.scrollTop;
    }
    setActiveMeetingId(newMeetingId);
  };
  // 初始化加载本地组织资源与会议
  useEffect(() => {
    async function initData() {
      const loadedMeetings = await storage.getMeetings(TENANT_ID);
      const loadedExperts = await storage.getCustomExperts(TENANT_ID);
      const loadedConfigs = await storage.getEngineConfigs(TENANT_ID);
      const systemOverrides = await storage.getSystemExpertsOverrides(TENANT_ID);
      const profile = await storage.getUserProfile(TENANT_ID);
      const loadedLlmParams = await storage.getLLMParamsConfig(TENANT_ID);
      const loadedSystemPrompts = await storage.getSystemPromptsConfig(TENANT_ID);
      const loadedBusinessDefaults = await storage.getBusinessDefaultsConfig(TENANT_ID);

      setSystemExperts(mergeSystemExperts(defaultExperts, systemOverrides));
      setCustomExperts(loadedExperts);
      setEngineConfigs(loadedConfigs);
      setUserProfile(profile);
      setLlmParams(loadedLlmParams);
      setSystemPrompts(loadedSystemPrompts);
      setBusinessDefaults(loadedBusinessDefaults);

      // 决定默认的模型引擎选择
      const activeConfig = loadedConfigs.find(c => c.isActive);
      if (activeConfig) {
        setActiveEngineId(activeConfig.id);
      } else {
        // 若没有自定义的，强制走系统环境内置大模型
        setActiveEngineId("system-env");
      }

      // 从 localStorage 加载面板折叠状态
      const savedSidebar = localStorage.getItem("DC_sidebar_collapsed");
      if (savedSidebar === "true") setIsSidebarCollapsed(true);
      
      const savedActivations = localStorage.getItem("DC_expert_activations");
      if (savedActivations) {
        try {
          setExpertActivationTimestamps(JSON.parse(savedActivations));
        } catch (e) {}
      }

      const savedUnlocked = localStorage.getItem("DC_unlocked_meetings");
      if (savedUnlocked) {
        try {
          const ids = JSON.parse(savedUnlocked) as string[];
          const dict: Record<string, boolean> = {};
          ids.forEach(id => { dict[id] = true; });
          setUnlockedComposers(dict);
        } catch (e) {}
      }
      
      setIsLoaded(true);

      if (loadedMeetings.length > 0) {
        setMeetings(loadedMeetings);
        const savedMeetingId = localStorage.getItem("DC_active_meeting_id");
        if (savedMeetingId && loadedMeetings.some(m => m.id === savedMeetingId)) {
          setActiveMeetingId(savedMeetingId);
        } else {
          setActiveMeetingId(loadedMeetings[0].id);
        }
      } else {
        // 创建初始默认会议
        const defaultMeeting: Meeting = {
          id: `meeting-${Date.now()}`,
          tenantId: TENANT_ID,
          name: loadedBusinessDefaults?.defaultMeetingName || "核心业务方案跨职能评审会",
          description: loadedBusinessDefaults?.defaultMeetingDesc || "评估核心业务逻辑、架构设计与用户价值的专家圆桌会",
          expertIds: loadedBusinessDefaults?.defaultExpertIds || ["ux-researcher", "brand-strategist", "growth-designer"],
          moderatorId: loadedBusinessDefaults?.defaultModeratorId || "balanced",
          globalDebateIntensity: loadedBusinessDefaults?.defaultDebateIntensity || 3,
          turnOrderMode: loadedBusinessDefaults?.defaultTurnOrderMode || "sequential",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: [],
        };
        await storage.saveMeeting(TENANT_ID, defaultMeeting);
        setMeetings([defaultMeeting]);
        setActiveMeetingId(defaultMeeting.id);
      }
    }
    void initData();
  }, [storage]);

  // 同步保存面板折叠状态
  useEffect(() => {
    if (isLoaded) {
      localStorage.setItem("DC_sidebar_collapsed", String(isSidebarCollapsed));
    }
  }, [isSidebarCollapsed, isLoaded]);

  // 保存当前会议状态
  useEffect(() => {
    if (activeMeetingId) {
      localStorage.setItem("DC_active_meeting_id", activeMeetingId);
    }
  }, [activeMeetingId]);

  // 保存所有已解锁（解除归档）的会议ID
  useEffect(() => {
    if (isLoaded) {
      const unlockedIds = Object.keys(unlockedComposers).filter(id => unlockedComposers[id]);
      localStorage.setItem("DC_unlocked_meetings", JSON.stringify(unlockedIds));
    }
  }, [unlockedComposers, isLoaded]);

  // 计算属性
  const allExperts = useMemo(() => {
    // 过滤出系统专家、全局级专家(!meetingId) 以及当前会议专属专家
    const availableCustom = customExperts.filter(e => !e.meetingId || e.meetingId === activeMeetingId);
    return [...systemExperts, ...availableCustom];
  }, [systemExperts, customExperts, activeMeetingId]);

  const activeMeeting = useMemo(() => {
    return meetings.find(m => m.id === activeMeetingId);
  }, [meetings, activeMeetingId]);

  const sortedMeetings = useMemo(() => {
    return [...meetings].sort((a, b) => {
      const aArchived = !!a.finalConclusion && !unlockedComposers[a.id];
      const bArchived = !!b.finalConclusion && !unlockedComposers[b.id];
      if (aArchived !== bArchived) {
        return aArchived ? 1 : -1;
      }
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }, [meetings, unlockedComposers]);

  const activeEngineConfig = useMemo(() => {
    return engineConfigs.find(c => c.id === activeEngineId);
  }, [engineConfigs, activeEngineId]);

  const allExpertsRef = useRef(allExperts);
  useEffect(() => {
    allExpertsRef.current = allExperts;
  }, [allExperts]);

  // 维护到本地小龙虾转发网关的 WebSocket 客户端长连接
  useEffect(() => {
    let socket: WebSocket;
    let reconnectTimeout: any;

    function connect() {
      if (typeof window === "undefined") return;
      const isSecure = window.location.protocol === "https:";
      const protocol = isSecure ? "wss:" : "ws:";
      const host = window.location.host;
      
      let wsUrl = "";
      if (host.includes("localhost") || host.includes("127.0.0.1")) {
        wsUrl = `${protocol}//${window.location.hostname}:18788/frontend`;
      } else {
        wsUrl = `${protocol}//${host}/frontend`;
      }
      
      console.log(`[WS-Frontend] Connecting to relay server at ${wsUrl} ...`);
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        console.log("[WS-Frontend] Connected to relay server");
        // 注册当前所有的外部 Bot
        const bots = allExpertsRef.current
          .filter(e => e.isExternalAgent)
          .map(e => ({ 
            expertId: e.id, 
            botToken: e.botToken?.trim(),
            agentType: e.agentType || "openclaw",
            wsEndpoint: e.wsEndpoint?.trim(),
            onebotToken: e.onebotToken?.trim()
          }));
        socket.send(JSON.stringify({ type: "register_bots", bots }));
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          switch (message.type) {
            case "bot_status_update":
              const statuses: Record<string, "online" | "offline"> = {};
              message.statuses.forEach((s: any) => {
                statuses[s.expertId] = s.status;
              });
              setBotStatuses(statuses);
              break;

            case "stream_chunk":
              const resolver = wsResolversRef.current[message.expertId];
              if (resolver) {
                // 终极解耦：直接追加大模型返回的发言文本，无需任何模糊或特定关键字判断
                resolver.text += message.chunk;
                if (resolver.onChunk) {
                  if (message.isThought) {
                    resolver.onChunk(resolver.text);
                  } else {
                    resolver.onChunk(cleanStreamingJson(resolver.text));
                  }
                }
              }
              break;

            case "stream_compaction_pending":
              // 收到网关发来的上下文压缩挂起通知，展示过渡等待信息，防范用户误以为系统卡死
              const pendingResolver = wsResolversRef.current[message.expertId];
              if (pendingResolver) {
                pendingResolver.text = ""; // 将正在累加的文本重置为空，等待新发言
                if (pendingResolver.onChunk) {
                  pendingResolver.onChunk("__COMPACTING__");
                }
              }
              break;

            case "stream_done":
              // 解决方案 2 的前端自适应相对路径补录双保险
              if (message.botRequestPayload) {
                const curExpert = allExpertsRef.current.find(e => e.id === message.expertId);
                const curExpertName = curExpert ? curExpert.name : "未知专家";
                const token = curExpert?.botToken || "";
                void fetch("/api/prompt-logs", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    type: "external_bot",
                    target: `外部专家响应 (前端补录): ${curExpertName}`,
                    modelOrToken: token ? token.substring(0, Math.min(12, token.length)) + "..." : "Unknown Token",
                    botRequestPayload: message.botRequestPayload,
                    systemPrompt: "外部大模型系统指令 (由Python端编译组装)",
                    userPrompt: message.botRequestPayload
                  })
                }).catch(() => {});
              }

              const doneResolver = wsResolversRef.current[message.expertId];
              if (doneResolver) {
                const curExpert = allExpertsRef.current.find(e => e.id === message.expertId);
                const curExpertName = curExpert ? curExpert.name : "";
                const curExpertTitle = curExpert ? curExpert.title : "";
                
                // 强制对最终发言内容进行清洗，剪除尾部 JSON 卡片，确保历史正文完美呈现
                const cleaned = extractAndCleanJson(doneResolver.text, curExpertName, curExpertTitle);
                const content = cleaned.content;
                const expertStance = message.expertStance || cleaned.expertStance;

                doneResolver.resolve({
                  content,
                  expertStance
                });
                delete wsResolversRef.current[message.expertId];
              }
              break;

            case "stream_error":
              const errResolver = wsResolversRef.current[message.expertId];
              if (errResolver) {
                const curExpert = allExpertsRef.current.find(e => e.id === message.expertId);
                const curExpertName = curExpert ? curExpert.name : "";
                const curExpertTitle = curExpert ? curExpert.title : "";
                
                // 如果已经有部分大模型发言吐字，执行容错自愈，将其转换为正常的发言结束并清洗
                if (errResolver.text && errResolver.text.trim().length > 0) {
                  console.warn(`[WS-Frontend] Expert ${message.expertId} stream error, but self-healing with partial text.`, message.error);
                  const cleaned = extractAndCleanJson(errResolver.text, curExpertName, curExpertTitle);
                  errResolver.resolve({
                    content: cleaned.content,
                    expertStance: cleaned.expertStance
                  });
                } else {
                  errResolver.reject(new Error(message.error));
                }
                delete wsResolversRef.current[message.expertId];
              }
              break;
          }
        } catch (e) {
          console.error("[WS-Frontend] Error parsing WS message", e);
        }
      };

      socket.onclose = () => {
        console.log("[WS-Frontend] Connection closed, retrying in 3s...");
        reconnectTimeout = setTimeout(connect, 3000);
      };

      wsRef.current = socket;
    }

    connect();

    return () => {
      if (socket) socket.close();
      clearTimeout(reconnectTimeout);
    };
  }, []);

  // 当专家列表变化时，同步向网关注册新智能体 Token
  useEffect(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const bots = allExperts
        .filter(e => e.isExternalAgent)
        .map(e => ({ 
          expertId: e.id, 
          botToken: e.botToken?.trim(),
          agentType: e.agentType || "openclaw",
          wsEndpoint: e.wsEndpoint?.trim(),
          onebotToken: e.onebotToken?.trim()
        }));
      wsRef.current.send(JSON.stringify({ type: "register_bots", bots }));
    }
  }, [allExperts]);

  // 智能滚动处理：保存/恢复滚动条，并在同一会议有新消息时自动沉底
  useEffect(() => {
    if (activeMeetingId !== prevMeetingIdRef.current) {
      // 切换了会议，尝试恢复保存的滚动位置
      const thread = chatThreadRef.current;
      if (thread && activeMeetingId) {
        // 使用 setTimeout 确保 DOM 渲染完成
        setTimeout(() => {
          const savedScroll = scrollPositions.current[activeMeetingId];
          if (savedScroll !== undefined) {
            thread.scrollTop = savedScroll;
            const { scrollTop, scrollHeight, clientHeight } = thread;
            isAutoScrollEnabled.current = scrollHeight - scrollTop - clientHeight < 150;
          } else {
            const conclusionEl = document.getElementById("conclusion-panel");
            if (activeMeeting?.finalConclusion && !unlockedComposers[activeMeetingId] && conclusionEl) {
              conclusionEl.scrollIntoView({ behavior: "auto" });
              isAutoScrollEnabled.current = false;
            } else {
              chatEndRef.current?.scrollIntoView({ behavior: "auto" });
              isAutoScrollEnabled.current = true;
            }
          }
        }, 0);
      }
    } else {
      // 同一会议下，如果有新内容生成且允许自动滚动，则滚动到底部
      if (isAutoScrollEnabled.current) {
        // 使用 auto 而不是 smooth 可以在流式输出时避免画面抖动冲突
        chatEndRef.current?.scrollIntoView({ behavior: "auto" });
      }
    }
    prevMeetingIdRef.current = activeMeetingId || null;
  }, [activeMeetingId, activeMeeting?.messages, activeMeetingId ? speakingExpertIds[activeMeetingId] : null, activeMeetingId ? synthesisPendingMeetings[activeMeetingId] : false]);

  // 稳定排序缓存，避免点击时跳动
  const sortRef = useRef<{ meetingId: string | null; positions: Record<string, number> }>({
    meetingId: null,
    positions: {}
  });

  const displayExperts = useMemo(() => {
    let needsNewSort = false;
    if (activeMeetingId !== sortRef.current.meetingId) {
      needsNewSort = true;
    }
    
    const knownIds = Object.keys(sortRef.current.positions);
    const hasNewExperts = allExperts.some(e => !knownIds.includes(e.id));
    if (hasNewExperts) {
      needsNewSort = true;
    }

    if (needsNewSort) {
      const sorted = [...allExperts].sort((a, b) => {
        const aSelected = activeMeeting?.expertIds.includes(a.id) ? -1 : 1;
        const bSelected = activeMeeting?.expertIds.includes(b.id) ? -1 : 1;
        if (aSelected !== bSelected) return aSelected - bSelected;
        
        const timeA = expertActivationTimestamps[a.id] || 0;
        const timeB = expertActivationTimestamps[b.id] || 0;
        
        if (aSelected === -1) {
          // 激活的专家：激活时间顺序（正序）
          return timeA - timeB;
        } else {
          // 未激活的专家：激活时间倒序
          return timeB - timeA;
        }
      });
      
      const newPos: Record<string, number> = {};
      sorted.forEach((exp, idx) => {
        newPos[exp.id] = idx;
      });
      
      sortRef.current = {
        meetingId: activeMeetingId || null,
        positions: newPos
      };
    }
    
    return [...allExperts].sort((a, b) => {
      const posA = sortRef.current.positions[a.id] ?? 999;
      const posB = sortRef.current.positions[b.id] ?? 999;
      return posA - posB;
    });
  }, [allExperts, activeMeetingId, activeMeeting?.expertIds, expertActivationTimestamps]);

  // 是否缺失 API 密钥（在真实模式下，且没有自定义引擎，且假设用户没有在本地配 .env）
  // 此时我们在 UI 上输出友好提示，防止大模型请求报错
  const showKeyWarning = useMemo(() => {
    return activeEngineId === "system-env" && engineConfigs.length === 0;
  }, [activeEngineId, engineConfigs]);

  // 更新当前会议属性并保存
  async function updateActiveMeeting(fields: Partial<Meeting>) {
    if (!activeMeeting) return;
    const updated = { ...activeMeeting, ...fields, updatedAt: Date.now() };
    const nextMeetings = meetings.map(m => m.id === activeMeetingId ? updated : m);
    setMeetings(nextMeetings);
    await storage.saveMeeting(TENANT_ID, updated);
  }

  // 会议管理
  function openNewMeetingModal() {
    setMeetingModalMode("create");
    setNewMeetingDraft({
      name: businessDefaults?.defaultMeetingName || "新业务评审会议",
      description: businessDefaults?.defaultMeetingDesc || "关于复杂议题论证的圆桌会议",
      globalDebateIntensity: businessDefaults?.defaultDebateIntensity || 3,
      turnOrderMode: businessDefaults?.defaultTurnOrderMode || "sequential",
    });
    setIsMeetingModalOpen(true);
  }

  function openEditMeetingModal() {
    if (!activeMeeting) return;
    setMeetingModalMode("edit");
    setNewMeetingDraft({
      name: activeMeeting.name,
      description: activeMeeting.description,
      globalDebateIntensity: activeMeeting.globalDebateIntensity,
      turnOrderMode: activeMeeting.turnOrderMode,
    });
    setIsMeetingModalOpen(true);
  }

  async function handleConfirmCreateMeeting(e: React.FormEvent) {
    e.preventDefault();
    if (!newMeetingDraft.name?.trim()) return;

    if (meetingModalMode === "create") {
      const newMeeting: Meeting = {
        id: `meeting-${Date.now()}`,
        tenantId: TENANT_ID,
        name: newMeetingDraft.name.trim(),
        description: newMeetingDraft.description || "",
        expertIds: businessDefaults?.defaultExpertIds || ["ux-researcher", "brand-strategist", "growth-designer"],
        moderatorId: businessDefaults?.defaultModeratorId || "balanced",
        globalDebateIntensity: newMeetingDraft.globalDebateIntensity || 3,
        turnOrderMode: newMeetingDraft.turnOrderMode || "sequential",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
      };

      await storage.saveMeeting(TENANT_ID, newMeeting);
      setMeetings(prev => [...prev, newMeeting]);
      handleSwitchMeeting(newMeeting.id);
    } else {
      if (activeMeeting) {
        await updateActiveMeeting({
          name: newMeetingDraft.name.trim(),
          description: newMeetingDraft.description || "",
          globalDebateIntensity: newMeetingDraft.globalDebateIntensity || 3,
          turnOrderMode: newMeetingDraft.turnOrderMode || "sequential",
        });
      }
    }
    setIsMeetingModalOpen(true); // Wait, this should be false!
    setIsMeetingModalOpen(false);
  }

  async function handleDeleteMeeting(id: string, event: React.MouseEvent) {
    event.stopPropagation();
    if (!window.confirm("确定要删除这场会议吗？相关的对话记录将被清除。")) return;

    await storage.deleteMeeting(TENANT_ID, id);
    const nextMeetings = meetings.filter(m => m.id !== id);
    setMeetings(nextMeetings);
    if (activeMeetingId === id && nextMeetings.length > 0) {
      handleSwitchMeeting(nextMeetings[0].id);
    }
  }

  // 自定义智能体操作
  function openCustomModal() {
    setCustomModalMode("create");
    setCustomModalDraft({ isCustom: true });
    setIsCustomModalOpen(true);
  }

  function openEditCustomModal(expert: Expert) {
    setCustomModalMode("edit");
    setCustomModalDraft({ ...expert });
    setIsCustomModalOpen(true);
  }

  async function handleSaveCustomExpert(newExpert: Expert) {
    if (activeMeetingId) {
      newExpert.meetingId = activeMeetingId;
    }
    
    await storage.saveCustomExpert(TENANT_ID, newExpert);
    
    if (customModalMode === "create") {
      setCustomExperts(prev => [...prev, newExpert]);
      if (activeMeeting) {
        await updateActiveMeeting({
          expertIds: [...activeMeeting.expertIds, newExpert.id]
        });
      }
    } else {
      setCustomExperts(prev => prev.map(e => e.id === newExpert.id ? newExpert : e));
    }

    setIsCustomModalOpen(false);
  }

  async function confirmDeleteCustomExpert() {
    if (!deleteCandidate) return;
    await storage.deleteCustomExpert(TENANT_ID, deleteCandidate.id);
    setCustomExperts(prev => prev.filter(e => e.id !== deleteCandidate.id));
    
    // 从所有的参会配置中删除
    if (activeMeeting) {
      await updateActiveMeeting({
        expertIds: activeMeeting.expertIds.filter(id => id !== deleteCandidate.id)
      });
    }
    setDeleteCandidate(null);
  }

  // 自定义引擎配置管理
  function openEngineModal() {
    setIsEngineModalOpen(true);
    setEngineError("");
    setEngineDraft({
      id: `engine-${Date.now()}`,
      name: "",
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
      model: "gpt-4o",
      isActive: false,
    });
  }

  async function handleAddEngineConfig() {
    const { name, baseUrl, apiKey, model, provider } = engineDraft;
    if (!name.trim() || !apiKey.trim() || !model.trim()) {
      setEngineError("请完整填写引擎名称、API Key 和模型名称。");
      return;
    }

    const newConfig: LLMEngineConfig = {
      ...engineDraft,
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      model: model.trim(),
      isActive: true, // 新建大模型保存后默认启用
    };

    // 将其他自定义引擎设为非激活
    const updatedConfigs = engineConfigs.map(c => ({ ...c, isActive: false }));
    const nextConfigs = [...updatedConfigs, newConfig];
    setEngineConfigs(nextConfigs);
    await storage.saveEngineConfigs(TENANT_ID, nextConfigs);

    setActiveEngineId(newConfig.id);
    setIsEngineModalOpen(false);
  }

  async function handleSelectEngine(id: string) {
    setActiveEngineId(id);
    const updated = engineConfigs.map(c => ({
      ...c,
      isActive: c.id === id,
    }));
    setEngineConfigs(updated);
    await storage.saveEngineConfigs(TENANT_ID, updated);
  }

  async function handleDeleteEngine(id: string) {
    if (!window.confirm("确定要删除这个模型配置吗？")) return;
    const nextConfigs = engineConfigs.filter(c => c.id !== id);
    setEngineConfigs(nextConfigs);
    await storage.saveEngineConfigs(TENANT_ID, nextConfigs);

    if (activeEngineId === id) {
      setActiveEngineId("system-env");
    }
  }

  function handleExportEngineConfigs() {
    if (engineConfigs.length === 0) {
      alert("没有可导出的自定义模型配置。");
      return;
    }
    const exportData = JSON.stringify(engineConfigs, null, 2);
    // 采用 navigator.clipboard 以及 fallback 到 prompt
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(exportData).then(() => {
        alert("模型配置已成功复制到剪贴板！");
      }).catch(() => {
        window.prompt("请复制以下配置文本：", exportData);
      });
    } else {
      window.prompt("请复制以下配置文本：", exportData);
    }
  }

  async function handleImportEngineConfigs() {
    const importData = window.prompt("请粘贴包含引擎配置的 JSON 文本：");
    if (!importData?.trim()) return;
    try {
      const parsed = JSON.parse(importData);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      
      let newConfigs = [...engineConfigs];
      let importedCount = 0;

      for (const item of arr) {
        if (item.id && item.name && item.provider && item.baseUrl && item.apiKey && item.model) {
          const existingIdx = newConfigs.findIndex(c => c.id === item.id);
          if (existingIdx >= 0) {
            newConfigs[existingIdx] = { ...newConfigs[existingIdx], ...item };
          } else {
            newConfigs.push(item as LLMEngineConfig);
          }
          importedCount++;
        }
      }

      if (importedCount > 0) {
        setEngineConfigs(newConfigs);
        await storage.saveEngineConfigs(TENANT_ID, newConfigs);
        alert(`成功导入 ${importedCount} 个引擎配置！`);
      } else {
        alert("导入失败：未找到合法的引擎配置格式。");
      }
    } catch (e) {
      alert("导入失败：JSON 格式不正确。");
    }
  }

  // 附件上传与拖拽
  async function addSourceFiles(fileList: FileList | null) {
    if (!fileList?.length) return;

    const nextSources = await Promise.all(
      Array.from(fileList).map(async (file) => {
        const kind = getSourceKind(file);
        const source: SourceItem = {
          id: `source-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          name: file.name,
          type: file.type || "unknown",
          size: file.size,
          kind,
        };

        if (kind === "image") {
          source.previewUrl = URL.createObjectURL(file);
        }

        if (kind === "text" && file.size < 240_000) {
          source.textSnippet = await file.text();
        }

        return source;
      }),
    );

    setSources(prev => [...prev, ...nextSources]);
  }

  function handleSourceInputChange(event: ChangeEvent<HTMLInputElement>) {
    void addSourceFiles(event.target.files);
    event.target.value = "";
  }

  function removeSource(id: string) {
    setSources(prev => {
      const source = prev.find(item => item.id === id);
      if (source?.previewUrl) {
        URL.revokeObjectURL(source.previewUrl);
      }
      return prev.filter(item => item.id !== id);
    });
  }

  function buildSourceContext() {
    if (!sources.length) return "";
    return [
      "用户上传的相关附件资料：",
      ...sources.map((source, index) =>
        [
          `${index + 1}. ${source.name}，文件类型：${source.kind}，大小：${formatFileSize(source.size)}`,
          source.textSnippet ? `文本摘要/代码：\n${source.textSnippet.slice(0, 1500)}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      ),
    ].join("\n\n");
  }

  async function requestExpertTurn(
    meeting: Meeting,
    expert: Expert,
    previousTurns: { expertName: string; expertTitle?: string; content: string }[],
    userQuestion: string,
    contextStr: string,
    history: ChatMessage[],
    signal: AbortSignal,
    onChunk?: (text: string) => void
  ) {
    if (expert.isExternalAgent) {
      if (botStatuses[expert.id] !== "online") {
        return Promise.reject(new Error(`智能体专家 [${expert.name}] 当前处于离线状态，无法发言。请确保其成功连接中继网关。`));
      }

      return new Promise((resolve, reject) => {
        const turnId = `turn-${Date.now()}`;
        let timeoutId: NodeJS.Timeout | null = null;
        let hasReceivedFirstChar = false;

        const cleanupTimeout = () => {
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
        };

        const onAbort = () => {
          cleanupTimeout();
          delete wsResolversRef.current[expert.id];
          reject(new DOMException("Aborted", "AbortError"));
        };

        if (signal.aborted) {
          return onAbort();
        }
        signal.addEventListener("abort", onAbort);

        const resetKeepAliveTimeout = () => {
          cleanupTimeout();
          timeoutId = setTimeout(() => {
            cleanupTimeout();
            delete wsResolversRef.current[expert.id];
            signal.removeEventListener("abort", onAbort);
            reject(new Error(`外部智能体 [${expert.name}] 发言断流超时：已超过 45 秒未收到后续文本，流程自动跳过。`));
          }, 45000);
        };

        const wrappedOnChunk = (text: string) => {
          if (!hasReceivedFirstChar) {
            hasReceivedFirstChar = true;
            cleanupTimeout(); // 清除 90 秒首字超时
          }
          resetKeepAliveTimeout(); // 刷新 45 秒断流超时
          if (onChunk) {
            onChunk(text);
          }
        };

        wsResolversRef.current[expert.id] = {
          text: "",
          onChunk: wrappedOnChunk,
          resolve: (val) => {
            cleanupTimeout();
            signal.removeEventListener("abort", onAbort);
            resolve(val);
          },
          reject: (err) => {
            cleanupTimeout();
            signal.removeEventListener("abort", onAbort);
            reject(err);
          }
        };

        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          // 启动 90 秒首字无响应超时定时器
          timeoutId = setTimeout(() => {
            cleanupTimeout();
            delete wsResolversRef.current[expert.id];
            signal.removeEventListener("abort", onAbort);
            reject(new Error(`外部智能体 [${expert.name}] 响应超时：已超过 90 秒无任何吐字回应，流程自动跳过。`));
          }, 90000);

          wsRef.current.send(JSON.stringify({
            type: "request_turn",
            meetingId: meeting.id,
            expertId: expert.id,
            expertName: expert.name,
            expertTitle: expert.title,
            question: userQuestion,
            context: contextStr,
            previousTurns,
            externalAgentPrompt: systemPrompts?.externalAgentPrompt || "",
            userTitle: userProfile.title,
            userName: userProfile.name,
            turnId
          }));
        } else {
          cleanupTimeout();
          signal.removeEventListener("abort", onAbort);
          delete wsResolversRef.current[expert.id];
          reject(new Error("本地中继网关已断开连接，无法请求外部智能体。"));
        }
      });
    }

    const response = await fetch("/api/discussions/expert-turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: userQuestion,
        projectContext: contextStr,
        expert,
        previousTurns,
        globalDebateIntensity: meeting.globalDebateIntensity,
        engineConfig: activeEngineId === "system-env" ? undefined : activeEngineConfig,
        conversationHistory: history,
        llmParams,
        systemPrompts,
        userProfile,
      }),
      signal,
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "大模型在生成智能体观点时失败。");
    }

    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("text/event-stream")) {
      const reader = response.body?.getReader();
      const decoder = new TextDecoder("utf-8");
      let fullContent = "";
      if (!reader) throw new Error("No reader");
      
      let isNativeReasoning = false;
      let hasClosedNativeReasoning = false;
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ") && line !== "data: [DONE]") {
            try {
              const data = JSON.parse(line.slice(6));
              const reasoningChunk = data.choices[0]?.delta?.reasoning_content;
              const contentChunk = data.choices[0]?.delta?.content;

              if (reasoningChunk) {
                if (!isNativeReasoning) {
                  fullContent += "<think>\n";
                  isNativeReasoning = true;
                }
                fullContent += reasoningChunk;
              }

              if (contentChunk) {
                if (isNativeReasoning && !hasClosedNativeReasoning) {
                  fullContent += "\n</think>\n";
                  hasClosedNativeReasoning = true;
                }
                fullContent += contentChunk;
              }

              const isInsideReasoning = isNativeReasoning && !hasClosedNativeReasoning;
              if (onChunk) {
                if (isInsideReasoning) {
                  onChunk(fullContent);
                } else {
                  onChunk(cleanStreamingJson(fullContent));
                }
              }
            } catch (e) {}
          }
        }
      }
      
      return extractAndCleanJson(fullContent, expert.name, expert.title);
    } else {
      return response.json();
    }
  }

  // 智能相关度下一发言人决策
  async function requestNextSpeakerId(
    userQuestion: string,
    previousTurns: { expertName: string; expertTitle?: string; content: string }[],
    candidateExperts: Expert[],
    history: ChatMessage[],
    signal: AbortSignal
  ): Promise<string> {
    const response = await fetch("/api/discussions/next-speaker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: userQuestion,
        previousTurns,
        candidateExperts,
        engineConfig: activeEngineId === "system-env" ? undefined : activeEngineConfig,
        conversationHistory: history,
        llmParams,
        systemPrompts,
      }),
      signal,
    });

    if (!response.ok) {
      return candidateExperts[0].id;
    }

    const payload = await response.json();
    return payload.nextSpeakerId || candidateExperts[0].id;
  }

  // 主持人决策总结
  async function requestSynthesis(
    meeting: Meeting,
    userQuestion: string,
    expertRounds: { expertName: string; expertTitle?: string; content: string }[],
    contextStr: string,
    history: ChatMessage[],
    signal: AbortSignal
  ) {
    const response = await fetch("/api/discussions/synthesis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: userQuestion,
        projectContext: contextStr,
        expertRounds,
        moderatorId: meeting.moderatorId,
        engineConfig: activeEngineId === "system-env" ? undefined : activeEngineConfig,
        conversationHistory: history,
        llmParams,
        systemPrompts,
        userProfile,
      }),
      signal,
    });

    if (!response.ok) {
      const payload = await response.json();
      throw new Error(payload.error || "主持人总结处理失败。");
    }

    return response.json();
  }

  // 叫停会议讨论
  function handleAbort() {
    if (activeMeetingId && discussAbortControllersRef.current[activeMeetingId]) {
      discussAbortControllersRef.current[activeMeetingId].abort();
      delete discussAbortControllersRef.current[activeMeetingId];

      // 同步叫停并注销所有悬空等待中的外部智能体 Promise，防范控制台未捕获拒绝错误
      Object.keys(wsResolversRef.current).forEach((expertId) => {
        const resolver = wsResolversRef.current[expertId];
        if (resolver) {
          resolver.reject(new DOMException("Aborted", "AbortError"));
          delete wsResolversRef.current[expertId];
        }
      });
    }
  }

  // 取消生成结论
  function handleAbortConclusion() {
    if (activeMeetingId && conclusionAbortControllersRef.current[activeMeetingId]) {
      conclusionAbortControllersRef.current[activeMeetingId].abort();
      delete conclusionAbortControllersRef.current[activeMeetingId];
      setGeneratingConclusions(prev => ({ ...prev, [activeMeetingId]: false }));
    }
  }

  // 圆桌讨论主提交入口
  async function handleSubmitDiscussion(
    event?: FormEvent<HTMLFormElement>,
    editParams?: { targetMeetingId: string; userQuestion: string; baseHistory: ChatMessage[]; baseSources: any[] }
  ) {
    if (event) event.preventDefault();
    
    const targetMeetingId = editParams ? editParams.targetMeetingId : activeMeeting?.id;
    const targetMeeting = meetings.find(m => m.id === targetMeetingId);
    if (!targetMeetingId || !targetMeeting || discussingMeetings[targetMeetingId] || generatingConclusions[targetMeetingId]) return;

    const userQuestion = editParams ? editParams.userQuestion.trim() : question.trim();
    if (!userQuestion) return;

    setDiscussingMeetings(prev => ({ ...prev, [targetMeetingId]: true }));
    if (!editParams) {
      setQuestion("");
      setSources([]);
    }

    // 缓存这轮提问发生前的整场历史对话列表
    const conversationHistory = editParams ? editParams.baseHistory : targetMeeting.messages;

    // 1. 创建 User 消息
    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}-user`,
      meetingId: targetMeetingId,
      tenantId: TENANT_ID,
      role: "user",
      senderName: userProfile.name,
      senderTitle: userProfile.title,
      content: userQuestion,
      sources: editParams ? [...editParams.baseSources] : [...sources],
      createdAt: Date.now(),
    };

    const updatedMessages = [...conversationHistory, userMessage];
    const nextMeetingState = { ...targetMeeting, messages: updatedMessages };
    
    // 初始化 UI 并立刻保存（用户的话立即上屏）
    setMeetings(prev => prev.map(m => m.id === targetMeetingId ? nextMeetingState : m));
    await storage.saveMeeting(TENANT_ID, nextMeetingState);

    // 强制重置滚动锁定并沉底（确保模型回复时能自动跟随）
    isAutoScrollEnabled.current = true;
    setTimeout(() => {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 50);

    // 2. 构造 Abort 监控
    const controller = new AbortController();
    discussAbortControllersRef.current[targetMeetingId] = controller;
    const signal = controller.signal;

    // 获取参会的专家
    const selectedExperts = allExperts.filter(e => targetMeeting.expertIds.includes(e.id));
    const meetingContextStr = `会议名称：${targetMeeting.name}\n会议背景与描述：${targetMeeting.description}`;
    const contextStr = [meetingContextStr, projectContext, buildSourceContext()].filter(Boolean).join("\n\n");

    // 本轮发言缓冲
    const previousTurns: { expertName: string; expertTitle?: string; content: string }[] = [];
    let currentMeeting = nextMeetingState;

    try {
      // 如果没有勾选任何参会专家，直接跑主持人总结
      if (selectedExperts.length === 0) {
        setSynthesisPendingMeetings(prev => ({ ...prev, [targetMeetingId]: true }));
        const synth = await requestSynthesis(currentMeeting, userQuestion, [], contextStr, conversationHistory, signal);
        
        const modMessage: ChatMessage = {
          id: `msg-${Date.now()}-mod`,
          meetingId: targetMeetingId,
          tenantId: TENANT_ID,
          role: "moderator",
          senderName: systemPrompts?.moderatorName || "主持人",
          senderTitle: systemPrompts?.moderatorTitle || "决策协调官",
          content: synth.summary,
          moderatorSummary: {
            consensus: synth.consensus || [],
            disagreements: synth.disagreements || [],
            decisions: synth.decisions || [],
            nextActions: synth.nextActions || [],
          },
          createdAt: Date.now(),
        };

        const finalMessages = [...currentMeeting.messages, modMessage];
        currentMeeting = { ...currentMeeting, messages: finalMessages };
        setMeetings(prev => prev.map(m => m.id === targetMeetingId ? currentMeeting : m));
        await storage.saveMeeting(TENANT_ID, currentMeeting);
        
        setSynthesisPendingMeetings(prev => ({ ...prev, [targetMeetingId]: false }));
        setDiscussingMeetings(prev => ({ ...prev, [targetMeetingId]: false }));
        return;
      }

      // 如果是“手动点名”模式，只生成一个占位消息，提示用户点名，不自动流转队列
      if (currentMeeting.turnOrderMode === "manual") {
        setDiscussingMeetings(prev => ({ ...prev, [targetMeetingId]: false }));
        return;
      }

      // 自动圆桌发言流 (Sequential 或 Relevance)
      // 自动排除处于离线状态的外部智能体，防止调用链崩溃中断会议
      let remainCandidates = selectedExperts.filter(e => {
        if (e.isExternalAgent) {
          return botStatuses[e.id] === "online";
        }
        return true;
      });

      while (remainCandidates.length > 0) {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");

        // 确定下一个发言人
        let currentExpert: Expert;
        if (currentMeeting.turnOrderMode === "relevance" && remainCandidates.length > 1) {
          setAssigningNextSpeaker(prev => ({ ...prev, [targetMeetingId]: true }));
          const nextId = await requestNextSpeakerId(userQuestion, previousTurns, remainCandidates, conversationHistory, signal);
          setAssigningNextSpeaker(prev => ({ ...prev, [targetMeetingId]: false }));
          currentExpert = remainCandidates.find(e => e.id === nextId) || remainCandidates[0];
        } else {
          currentExpert = remainCandidates[0];
        }

        remainCandidates = remainCandidates.filter(e => e.id !== currentExpert.id);

        setSpeakingExpertIds(prev => ({ ...prev, [targetMeetingId]: currentExpert.id }));

        // 先创建一条空的专家发言
        const expertMessageId = `msg-${Date.now()}-${currentExpert.id}`;
        let expertMessage: ChatMessage = {
          id: expertMessageId,
          meetingId: targetMeetingId,
          tenantId: TENANT_ID,
          role: "expert",
          senderId: currentExpert.id,
          senderName: currentExpert.name,
          senderTitle: currentExpert.title,
          content: currentExpert.isExternalAgent ? "__WAKING__" : "",
          createdAt: Date.now(),
        };

        let nextMsgs = [...currentMeeting.messages, expertMessage];
        currentMeeting = { ...currentMeeting, messages: nextMsgs };
        setMeetings(prev => prev.map(m => m.id === targetMeetingId ? currentMeeting : m));

        let finalTurnContent = "";
        let finalExpertStance = undefined;

        try {
          // 调用单步发言
          const turnResult = await requestExpertTurn(
            currentMeeting,
            currentExpert,
            previousTurns,
            userQuestion,
            contextStr,
            conversationHistory,
            signal,
            (text) => {
              // Update message content incrementally
              expertMessage.content = text;
              const updatedMsgs = currentMeeting.messages.map(msg => 
                msg.id === expertMessageId ? { ...expertMessage } : msg
              );
              setMeetings(prev => prev.map(m => m.id === targetMeetingId ? { ...m, messages: updatedMsgs } : m));
            }
          );
          
          finalTurnContent = turnResult.content;
          finalExpertStance = turnResult.expertStance;
        } catch (error: any) {
          console.error(`专家 [${currentExpert.name}] 发言异常:`, error);
          
          // 如果是 AbortError，直接往外抛出以触发全局叫停退出
          if (error.name === "AbortError" || signal.aborted) {
            throw error;
          }

          // 判断错误类型是否为超时
          const errMsg = (error.message || "").toLowerCase();
          const isTimeout = errMsg.includes("超时") || errMsg.includes("timeout") || errMsg.includes("limit");
          
          finalTurnContent = isTimeout ? "__TIMEOUT__" : "__ERROR__";
          finalExpertStance = undefined;
        }

        // 终结：填入最终内容并保存
        expertMessage = {
          ...expertMessage,
          content: finalTurnContent,
          expertStance: finalExpertStance,
        };

        nextMsgs = currentMeeting.messages.map(msg => 
          msg.id === expertMessageId ? expertMessage : msg
        );
        currentMeeting = { ...currentMeeting, messages: nextMsgs };
        setMeetings(prev => prev.map(m => m.id === targetMeetingId ? currentMeeting : m));
        await storage.saveMeeting(TENANT_ID, currentMeeting);

        // 净化输入 previousTurns 中的内容，以免破坏大模型后续解析
        const previousTurnContent = (finalTurnContent === "__TIMEOUT__" || finalTurnContent === "__ERROR__")
          ? `[该专家发言由于${finalTurnContent === "__TIMEOUT__" ? "响应超时" : "网关连接异常"}被系统跳过]`
          : finalTurnContent;

        previousTurns.push({
          expertName: currentExpert.name,
          expertTitle: currentExpert.title,
          content: previousTurnContent,
        });

      }

      // 4. 调用主持人综合总结
      setSpeakingExpertIds(prev => ({ ...prev, [targetMeetingId]: null }));
      setSynthesisPendingMeetings(prev => ({ ...prev, [targetMeetingId]: true }));

      const synth = await requestSynthesis(currentMeeting, userQuestion, previousTurns, contextStr, conversationHistory, signal);
      
      const modMessage: ChatMessage = {
        id: `msg-${Date.now()}-mod`,
        meetingId: currentMeeting.id,
        tenantId: TENANT_ID,
        role: "moderator",
        senderName: systemPrompts?.moderatorName || "主持人",
        senderTitle: systemPrompts?.moderatorTitle || "决策协调官",
        content: synth.summary,
        moderatorSummary: {
          consensus: synth.consensus || [],
          disagreements: synth.disagreements || [],
          decisions: synth.decisions || [],
          nextActions: synth.nextActions || [],
        },
        createdAt: Date.now(),
      };

      const finalMessages = [...currentMeeting.messages, modMessage];
      currentMeeting = { ...currentMeeting, messages: finalMessages };
      setMeetings(prev => prev.map(m => m.id === targetMeetingId ? currentMeeting : m));
      await storage.saveMeeting(TENANT_ID, currentMeeting);

    } catch (e: any) {
      if (e.name === "AbortError" || signal.aborted) {
        // 叫停处理
        const abortMessage: ChatMessage = {
          id: `msg-abort-${Date.now()}`,
          meetingId: targetMeetingId,
          tenantId: TENANT_ID,
          role: "moderator",
          senderName: "系统提示",
          content: "⚠️ 本轮专家圆桌讨论已被手动叫停中止。已保留之前生成的讨论观点，您可以输入新的追问或调整设置。",
          createdAt: Date.now(),
        };
        const nextMsgs = [...currentMeeting.messages, abortMessage];
        const nextState = { ...currentMeeting, messages: nextMsgs };
        setMeetings(prev => prev.map(m => m.id === targetMeetingId ? nextState : m));
        await storage.saveMeeting(TENANT_ID, nextState);
      } else {
        console.error("圆桌讨论异常中止", e);
        const errMsg = e.message || "请求失败";
        const isTimeout = errMsg.toLowerCase().includes("超时") || errMsg.includes("timeout") || errMsg.includes("limit");
        
        if (isTimeout) {
          const timeoutMsg: ChatMessage = {
            id: `msg-timeout-err-${Date.now()}`,
            meetingId: targetMeetingId,
            tenantId: TENANT_ID,
            role: "moderator",
            senderName: "系统提示",
            content: `⚠️ 圆桌讨论部分流程发生响应超时 (${errMsg})，已自动跳过并恢复流程，您可以继续发起讨论或调整设置。`,
            createdAt: Date.now(),
          };
          const nextState = { ...currentMeeting, messages: [...currentMeeting.messages, timeoutMsg] };
          setMeetings(prev => prev.map(m => m.id === targetMeetingId ? nextState : m));
          await storage.saveMeeting(TENANT_ID, nextState);
        } else {
          alert(`圆桌发生异常: ${errMsg}`);
        }
      }
    } finally {
      setDiscussingMeetings(prev => ({ ...prev, [targetMeetingId]: false }));
      setSpeakingExpertIds(prev => ({ ...prev, [targetMeetingId]: null }));
      setSynthesisPendingMeetings(prev => ({ ...prev, [targetMeetingId]: false }));
      delete discussAbortControllersRef.current[targetMeetingId];
    }
  }

  // 主持人点名手动触发特定专家发言
  async function handleCallExpertDirectly(expert: Expert) {
    if (!activeMeeting || discussingMeetings[activeMeetingId] || generatingConclusions[activeMeetingId]) return;
    
    const targetMeetingId = activeMeeting.id;
    setDiscussingMeetings(prev => ({ ...prev, [targetMeetingId]: true }));
    setSpeakingExpertIds(prev => ({ ...prev, [targetMeetingId]: expert.id }));

    // 寻找最近的 user 提问作为本轮议题
    const lastUserMsg = [...activeMeeting.messages].reverse().find(m => m.role === "user");
    const userQuestion = lastUserMsg ? lastUserMsg.content : "关于当前的项目的整体评审";
    const lastUserIdx = lastUserMsg ? activeMeeting.messages.indexOf(lastUserMsg) : -1;

    // 前几轮对话作为历史
    const conversationHistory = activeMeeting.messages.slice(0, lastUserIdx);

    // 本轮内在他之前已经发言过的其他专家观点
    const historyRounds = activeMeeting.messages
      .slice(lastUserIdx + 1)
      .filter(m => m.role === "expert")
      .map(m => ({
        expertName: m.senderName,
        content: m.content,
      }));

    const controller = new AbortController();
    discussAbortControllersRef.current[targetMeetingId] = controller;
    const signal = controller.signal;
    const meetingContextStr = `会议名称：${activeMeeting.name}\n会议背景与描述：${activeMeeting.description}`;
    const contextStr = [meetingContextStr, projectContext, buildSourceContext()].filter(Boolean).join("\n\n");

    try {
      const expertMessageId = `msg-${Date.now()}-${expert.id}`;
      let expertMessage: ChatMessage = {
        id: expertMessageId,
        meetingId: targetMeetingId,
        tenantId: TENANT_ID,
        role: "expert",
        senderId: expert.id,
        senderName: expert.name,
        senderTitle: expert.title,
        content: expert.isExternalAgent ? "__WAKING__" : "",
        createdAt: Date.now(),
      };

      let nextMsgs = [...activeMeeting.messages, expertMessage];
      let currentMeetingState = { ...activeMeeting, messages: nextMsgs };
      setMeetings(prev => prev.map(m => m.id === targetMeetingId ? currentMeetingState : m));

      const turnResult = await requestExpertTurn(
        activeMeeting,
        expert,
        historyRounds,
        userQuestion,
        contextStr,
        conversationHistory,
        signal,
        (text) => {
          expertMessage.content = text;
          const updatedMsgs = currentMeetingState.messages.map(msg => 
            msg.id === expertMessageId ? { ...expertMessage } : msg
          );
          setMeetings(prev => prev.map(m => m.id === targetMeetingId ? { ...m, messages: updatedMsgs } : m));
        }
      );

      expertMessage = {
        ...expertMessage,
        content: turnResult.content,
        expertStance: turnResult.expertStance,
      };

      nextMsgs = currentMeetingState.messages.map(msg => 
        msg.id === expertMessageId ? expertMessage : msg
      );
      currentMeetingState = { ...currentMeetingState, messages: nextMsgs };
      setMeetings(prev => prev.map(m => m.id === targetMeetingId ? currentMeetingState : m));
      await storage.saveMeeting(TENANT_ID, currentMeetingState);

    } catch (e: any) {
      if (e.name !== "AbortError" && !signal.aborted) {
        alert("点名专家发言失败: " + e.message);
      }
    } finally {
      setDiscussingMeetings(prev => ({ ...prev, [targetMeetingId]: false }));
      setSpeakingExpertIds(prev => ({ ...prev, [targetMeetingId]: null }));
      delete discussAbortControllersRef.current[targetMeetingId];
    }
  }

  // 主持人手动终结会议，输出汇总
  async function handleManualSynthesize() {
    if (!activeMeeting || discussingMeetings[activeMeetingId] || generatingConclusions[activeMeetingId]) return;
    
    const targetMeetingId = activeMeeting.id;
    setDiscussingMeetings(prev => ({ ...prev, [targetMeetingId]: true }));
    setSynthesisPendingMeetings(prev => ({ ...prev, [targetMeetingId]: true }));

    const lastUserMsg = [...activeMeeting.messages].reverse().find(m => m.role === "user");
    const userQuestion = lastUserMsg ? lastUserMsg.content : "关于当前的项目的整体评审";
    const lastUserIdx = lastUserMsg ? activeMeeting.messages.indexOf(lastUserMsg) : -1;

    // 前几轮对话作为历史
    const conversationHistory = activeMeeting.messages.slice(0, lastUserIdx);

    const historyRounds = activeMeeting.messages
      .slice(lastUserIdx + 1)
      .filter(m => m.role === "expert")
      .map(m => ({
        expertName: m.senderName,
        content: m.content,
      }));

    const controller = new AbortController();
    discussAbortControllersRef.current[targetMeetingId] = controller;
    const signal = controller.signal;
    const meetingContextStr = `会议名称：${activeMeeting.name}\n会议背景与描述：${activeMeeting.description}`;
    const contextStr = [meetingContextStr, projectContext, buildSourceContext()].filter(Boolean).join("\n\n");

    try {
      const synth = await requestSynthesis(activeMeeting, userQuestion, historyRounds, contextStr, conversationHistory, signal);
      
      const modMessage: ChatMessage = {
        id: `msg-${Date.now()}-mod`,
        meetingId: targetMeetingId,
        tenantId: TENANT_ID,
        role: "moderator",
        senderName: systemPrompts?.moderatorName || "主持人",
        senderTitle: systemPrompts?.moderatorTitle || "决策协调官",
        content: synth.summary,
        moderatorSummary: {
          consensus: synth.consensus || [],
          disagreements: synth.disagreements || [],
          decisions: synth.decisions || [],
          nextActions: synth.nextActions || [],
        },
        createdAt: Date.now(),
      };

      const finalMessages = [...activeMeeting.messages, modMessage];
      const nextMeetingState = { ...activeMeeting, messages: finalMessages };
      setMeetings(prev => prev.map(m => m.id === targetMeetingId ? nextMeetingState : m));
      await storage.saveMeeting(TENANT_ID, nextMeetingState);

    } catch (e: any) {
      if (e.name !== "AbortError" && !signal.aborted) {
        alert("生成主持人汇总失败: " + e.message);
      }
    } finally {
      setDiscussingMeetings(prev => ({ ...prev, [targetMeetingId]: false }));
      setSynthesisPendingMeetings(prev => ({ ...prev, [targetMeetingId]: false }));
      delete discussAbortControllersRef.current[targetMeetingId];
    }
  }

  // --- 结论相关处理 ---
  async function handleGenerateConclusion() {
    if (!activeMeeting || activeMeeting.messages.length === 0 || generatingConclusions[activeMeetingId]) return;
    
    const targetMeetingId = activeMeeting.id;
    setGeneratingConclusions(prev => ({ ...prev, [targetMeetingId]: true }));
    
    // 立即跳转/平滑滚动到页面最底部的“正在生成的控制按钮”处
    setTimeout(() => {
      if (chatThreadRef.current) {
        chatThreadRef.current.scrollTo({
          top: chatThreadRef.current.scrollHeight,
          behavior: "smooth"
        });
      }
    }, 60);
    
    const controller = new AbortController();
    conclusionAbortControllersRef.current[targetMeetingId] = controller;
    const signal = controller.signal;

    try {
      const activeConfig = engineConfigs.find(c => c.id === activeEngineId);
      const res = await fetch("/api/discussions/conclusion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectContext: `会议名称：${activeMeeting.name}\n会议背景与描述：${activeMeeting.description}`,
          conversationHistory: activeMeeting.messages,
          engineConfig: activeConfig,
          llmParams,
          systemPrompts,
        }),
        signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      
      const nextMeeting = { ...activeMeeting, finalConclusion: data.conclusion };
      setMeetings(prev => prev.map(m => m.id === targetMeetingId ? nextMeeting : m));
      await storage.saveMeeting(TENANT_ID, nextMeeting);
      
      setUnlockedComposers(prev => ({ ...prev, [targetMeetingId]: false }));
      
      setTimeout(() => {
        if (chatThreadRef.current) {
          chatThreadRef.current.scrollTop = chatThreadRef.current.scrollHeight;
        }
      }, 100);
    } catch (e: any) {
      if (e.name !== "AbortError" && !signal.aborted) {
        alert("提炼结论失败: " + e.message);
      }
    } finally {
      setGeneratingConclusions(prev => ({ ...prev, [targetMeetingId]: false }));
      delete conclusionAbortControllersRef.current[targetMeetingId];
    }
  }

  async function handleSaveConclusion() {
    if (!activeMeeting) return;
    const targetMeetingId = activeMeeting.id;
    const nextMeeting = { ...activeMeeting, finalConclusion: conclusionDraft };
    setMeetings(prev => prev.map(m => m.id === targetMeetingId ? nextMeeting : m));
    await storage.saveMeeting(TENANT_ID, nextMeeting);
    setIsEditingConclusion(false);
  }

  function handleUnlockComposer() {
    if (!activeMeeting) return;
    setUnlockedComposers(prev => ({ ...prev, [activeMeeting.id]: true }));
    setTimeout(() => {
      // scroll to bottom
      if (chatThreadRef.current) {
        chatThreadRef.current.scrollTop = chatThreadRef.current.scrollHeight;
      }
    }, 100);
  }

  // 辅助函数
  function getSourceKind(file: File): SourceItem["kind"] {
    if (file.type.startsWith("image/")) return "image";
    if (file.type.includes("pdf") || file.type.includes("word") || file.name.endsWith(".doc") || file.name.endsWith(".docx")) {
      return "document";
    }
    if (file.type.startsWith("text/") || file.name.endsWith(".md") || file.name.endsWith(".json") || file.name.endsWith(".csv")) {
      return "text";
    }
    return "file";
  }

  function formatFileSize(size: number) {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }

  const handleExportToHTML = () => {
    if (!activeMeeting || activeMeeting.messages.length === 0) return;

    const chatContainer = document.querySelector('.chat-thread');
    if (!chatContainer) return;

    let styleContent = '';
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          styleContent += rule.cssText;
        }
      } catch (e) {
        // Ignore cross-origin stylesheets
      }
    }
    
    document.querySelectorAll('style').forEach(s => {
      styleContent += s.innerHTML;
    });
    styleContent += "\n.export-hidden { display: none !important; }\n";

    const htmlContent = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${activeMeeting.name} - 会议记录</title>
<style>
  /* 注入页面的所有 CSS 以保证完美复刻 */
  ${styleContent}
  
  /* 基础包裹与视图调整 */
  html, body { height: auto !important; overflow: auto !important; }
  body { background: var(--surface-subtle, #f5f5f5); margin: 0; padding: 40px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .export-container { max-width: 900px; margin: 0 auto; background: var(--surface, #fff); border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); padding: 40px; }
  .export-header { border-bottom: 1px solid var(--line, #eee); padding-bottom: 20px; margin-bottom: 30px; }
  .export-header h1 { margin: 0 0 10px 0; font-size: 24px; color: var(--ink, #1a1a1a); }
  .export-header p { color: var(--muted, #666); margin: 0; font-size: 14px; }
  
  /* 确保聊天容器在导出视图中正常显示 */
  .chat-thread { height: auto !important; overflow: visible !important; padding: 0 !important; }
</style>
</head>
<body>
<div class="export-container">
  <div class="export-header">
    <h1>${activeMeeting.name}</h1>
    ${activeMeeting.description ? `<p style="margin-bottom: 12px; color: var(--ink, #333); font-size: 15px;">${activeMeeting.description}</p>` : ''}
    <p>导出时间: ${new Date().toLocaleString()}</p>
  </div>
  <div class="chat-thread">
    ${chatContainer.innerHTML}
  </div>
</div>
</body>
</html>
    `;

    const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeMeeting.name}-${new Date().toISOString().slice(0,10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="app-shell">
      <style dangerouslySetInnerHTML={{ __html: `
        .message-hover-wrapper .message-edit-btn {
          opacity: 0;
          transition: opacity 0.2s, background 0.2s, color 0.2s;
          background: transparent;
          border: none;
          color: var(--muted);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 6px;
          border-radius: 6px;
          flex-shrink: 0;
          margin-bottom: 2px;
        }
        .message-hover-wrapper:hover .message-edit-btn {
          opacity: 0.6;
        }
        .message-hover-wrapper .message-edit-btn:hover {
          opacity: 1;
          background: var(--surface-strong);
          color: var(--ink);
        }
      `}} />
      <header className="app-header">
        <div className="header-inner">
          <div className="brand-lockup">
            <div className="brand-mark" aria-hidden="true">
              EC
            </div>
            <div>
              <p className="eyebrow">Expert Council AI - Organization Level</p>
              <h1>智能体圆桌会议中心</h1>
            </div>
          </div>
          <div className="status-group">
            <span className="status-chip">{meetings.length} 场会议</span>
            <span className="status-chip">{customExperts.length} 自定义智能体</span>
            <span className="status-chip">
              {activeEngineId === "system-env" ? "系统环境模型" : activeEngineConfig?.name || "未知引擎"}
            </span>
            <a href="/manual.html" target="_blank" className="ghost-button" style={{ display: "inline-flex", alignItems: "center", minHeight: "30px", padding: "0 12px", textDecoration: "none", borderRadius: "999px", fontSize: "12px", border: "1px solid var(--line)", background: "var(--surface)", marginRight: "8px" }}>
              💡 使用说明
            </a>
            <a href="/admin" className="ghost-button" style={{ display: "inline-flex", alignItems: "center", minHeight: "30px", padding: "0 12px", textDecoration: "none", borderRadius: "999px", fontSize: "12px", border: "1px solid var(--line)", background: "var(--surface)" }}>
              后台管理 →
            </a>
          </div>
        </div>
      </header>

      <main className="app-main">
        <form
          className={`workspace-triple ${
            isSidebarCollapsed ? "is-sidebar-collapsed" : ""
          }`.trim()}
          onSubmit={(e) => void handleSubmitDiscussion(e)}
        >
        {/* 左侧栏一：会议列表空间 */}
        <section className={`panel side-panel ${isSidebarCollapsed ? "is-collapsed" : ""}`} style={{ position: "relative" }}>
          <button
            className="sidebar-collapse-tab"
            type="button"
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            title={isSidebarCollapsed ? "展开会议空间" : "收起会议空间"}
          >
            <span style={{ transform: isSidebarCollapsed ? "rotate(180deg)" : "none", transition: "transform 0.2s", display: "inline-block", fontSize: "12px", lineHeight: 1 }}>‹</span>
          </button>
          
          {isSidebarCollapsed ? (
            <div className="panel-rail" onClick={() => setIsSidebarCollapsed(false)} title="展开会议空间">
              <span className="rail-count">{meetings.length}</span>
              <span style={{ writingMode: "vertical-rl", letterSpacing: "8px", fontWeight: 600, fontSize: "14px" }}>会议</span>
            </div>
          ) : (
            <div className="meeting-section">
              <div className="panel-heading side-panel-heading">
                <h2>会议空间</h2>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <button
                    className="btn-create-meeting"
                    type="button"
                    onClick={openNewMeetingModal}
                    title="新建会议室"
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="meeting-list">
                {sortedMeetings.map((meeting) => {
                  const isActive = meeting.id === activeMeetingId;
                  const isArchived = !!meeting.finalConclusion && !unlockedComposers[meeting.id];
                  return (
                    <div
                      key={meeting.id}
                      className={`meeting-item ${isActive ? "is-active" : ""} ${isArchived ? "is-archived" : ""}`}
                      onClick={() => handleSwitchMeeting(meeting.id)}
                    >
                      <div className="meeting-item-info">
                        <span className="meeting-item-title" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px", width: "100%" }}>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{meeting.name}</span>
                          {isArchived && (
                            <span className="meeting-item-archive-badge" style={{ flexShrink: 0 }}>已归档</span>
                          )}
                        </span>
                        <span className="meeting-item-meta">
                          {meeting.messages.length} 轮发言 · {meeting.expertIds.length} 专家
                        </span>
                      </div>
                      <div className="meeting-item-actions">
                        <button
                          className="btn-delete"
                          type="button"
                          onClick={(e) => handleDeleteMeeting(meeting.id, e)}
                          title="删除会议"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* 左侧栏二：专家席位 */}
        <section className={`panel side-panel role-panel`}>
          <div className="panel-heading side-panel-heading">
            <h2>专家席位</h2>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <button
                className="btn-create-meeting"
                type="button"
                onClick={openCustomModal}
                title={activeMeetingId ? "新建会议专属智能体" : "请先选择或创建会议"}
                disabled={!activeMeetingId}
                style={{ opacity: !activeMeetingId ? 0.5 : 1, cursor: !activeMeetingId ? "not-allowed" : "pointer" }}
              >
                +
              </button>
            </div>
          </div>
              
              <div className="role-list">
                {displayExperts.map((expert) => {
                  const isSelected = activeMeeting?.expertIds.includes(expert.id) ?? false;
                  const isSpeaking = activeMeetingId ? speakingExpertIds[activeMeetingId] === expert.id : false;

                  return (
                    <div
                      key={expert.id}
                      className={`role-card ${isSelected ? "is-selected" : ""} ${isSpeaking ? "is-speaking" : ""} ${expert.isExternalAgent ? "is-external-agent" : ""}`}
                    >
                      <div className="role-toggle">
                        <div 
                          className="role-topline" 
                          style={{ cursor: "pointer" }}
                          onClick={() => {
                            if (!activeMeeting) return;
                            const ids = isSelected
                              ? activeMeeting.expertIds.filter(id => id !== expert.id)
                              : [...activeMeeting.expertIds, expert.id];
                              
                            if (!isSelected) {
                              const newDict = { ...expertActivationTimestamps, [expert.id]: Date.now() };
                              setExpertActivationTimestamps(newDict);
                              localStorage.setItem("DC_expert_activations", JSON.stringify(newDict));
                            }
                            
                            void updateActiveMeeting({ expertIds: ids });
                          }}
                        >
                          <div style={{ flex: 1 }}>
                            <p className="role-name" style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                              {expert.name}
                              {expert.isExternalAgent && (
                                <span style={{ fontSize: "10px", color: "var(--muted)", padding: "1.5px 5px", border: "1px solid var(--line)", borderRadius: "4px", fontWeight: "normal" }}>
                                  小龙虾
                                </span>
                              )}
                              {!expert.isExternalAgent && (
                                <span className={`intensity-badge lvl-${expert.debateIntensity}`}>
                                  Lvl {expert.debateIntensity} 对抗
                                </span>
                              )}
                              {expert.isExternalAgent && (
                                <span 
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "4px",
                                    fontSize: "10px",
                                    padding: "2px 6px",
                                    borderRadius: "4px",
                                    fontWeight: 600,
                                    background: botStatuses[expert.id] === "online" ? "rgba(40,167,69,0.12)" : "rgba(220,53,69,0.12)",
                                    color: botStatuses[expert.id] === "online" ? "#28a745" : "#dc3545",
                                    border: botStatuses[expert.id] === "online" ? "1px solid rgba(40,167,69,0.25)" : "1px solid rgba(220,53,69,0.25)"
                                  }}
                                >
                                  <span 
                                    className={botStatuses[expert.id] === "online" ? "online-dot-pulse" : ""}
                                    style={{
                                      width: "6px",
                                      height: "6px",
                                      borderRadius: "50%",
                                      background: botStatuses[expert.id] === "online" ? "#28a745" : "#dc3545"
                                    }} 
                                  />
                                  {botStatuses[expert.id] === "online" ? "在线" : "离线"}
                                </span>
                              )}
                            </p>
                            <p className="role-title">{expert.title}</p>
                          </div>
                          
                          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                            <span
                              className={`checkmark ${isSelected ? "is-active" : ""}`}
                              aria-hidden="true"
                            />
                          </div>
                        </div>
                        <p className="role-lens">{expert.lens}</p>
                        
                        <div style={{ marginTop: "8px", borderTop: "1px dashed var(--line)", paddingTop: "6px" }}>
                          <label className="intensity-selector">
                            <span style={{ fontSize: "11px", color: "var(--muted)" }}>辩论强度</span>
                            <input
                              type="range"
                              min="1"
                              max="5"
                              value={expert.debateIntensity}
                              disabled={activeMeetingId ? discussingMeetings[activeMeetingId] : false}
                              onChange={async (e) => {
                                const val = Number(e.target.value);
                                if (expert.isCustom) {
                                  const updated = { ...expert, debateIntensity: val };
                                  setCustomExperts(prev => prev.map(ex => ex.id === expert.id ? updated : ex));
                                  await storage.saveCustomExpert(TENANT_ID, updated);
                                } else {
                                  expert.debateIntensity = val;
                                  setMeetings([...meetings]);
                                }
                              }}
                            />
                            <span>{expert.debateIntensity}</span>
                          </label>
                        </div>

                        {/* 主持人点名模式：如果专家参会了，且非发言状态，显示点名发言按钮 */}
                        {activeMeeting?.turnOrderMode === "manual" && isSelected && !(activeMeetingId ? discussingMeetings[activeMeetingId] : false) && (
                          <button
                            className="btn-small-action active"
                            type="button"
                            style={{ width: "100%", marginTop: "8px" }}
                            onClick={() => handleCallExpertDirectly(expert)}
                          >
                            点名发言 👉
                          </button>
                        )}
                        {isSpeaking && (
                          <div className="speaking-indicator" style={{ marginTop: "6px" }}>
                            <span>● Speaking...</span>
                          </div>
                        )}
                      </div>
                      
                      {expert.isCustom && expert.meetingId && (
                        <div style={{ position: "absolute", right: "12px", top: "42px", display: "flex", gap: "8px" }}>
                          <button
                            className="text-button"
                            type="button"
                            onClick={() => openEditCustomModal(expert)}
                            style={{ color: "var(--amber)" }}
                          >
                            编辑
                          </button>
                          <button
                            className="text-button"
                            type="button"
                            onClick={() => setDeleteCandidate(expert)}
                          >
                            删除
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>


        </section>

        {/* 中间栏：会议室讨论现场 */}
        <section className="panel discussion-panel chat-panel">
          <div className="discussion-heading" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", minWidth: 0 }}>
            <div style={{ minWidth: 0, flex: 1, display: "flex", alignItems: "center", gap: "12px" }}>
              <h2 style={{ fontSize: "16px", fontWeight: "700", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", margin: 0, minWidth: 0, maxWidth: "45%" }}>
                {activeMeeting ? activeMeeting.name : "载入中..."}
              </h2>
              {activeMeeting && (
                <button className="ghost-button" style={{ width: "24px", height: "24px", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, borderRadius: "6px", color: "var(--muted)", flexShrink: 0, border: "none", background: "transparent", marginLeft: "-4px" }} onClick={openEditMeetingModal} title="编辑会议信息">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                </button>
              )}
              {activeMeeting?.description && (
                <>
                  <div style={{ width: "1px", height: "14px", background: "var(--line)", flexShrink: 0 }} />
                  <p style={{ margin: 0, fontSize: "13px", color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 }} title={activeMeeting.description}>
                    {activeMeeting.description}
                  </p>
                </>
              )}
            </div>
            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              {/* 点名模式下，如果专家发过言但还未总结，允许手动一键总结 */}
              {activeMeeting?.turnOrderMode === "manual" && !(activeMeetingId ? discussingMeetings[activeMeetingId] : false) && activeMeeting.messages.length > 0 && (
                <button
                  className="btn-small-action"
                  type="button"
                  onClick={handleManualSynthesize}
                  style={{ borderColor: "var(--amber)", color: "var(--amber)" }}
                >
                  📝 总结会议意见
                </button>
              )}
              
              {/* 导出按钮 */}
              {activeMeeting && activeMeeting.messages.length > 0 && (
                <button
                  className="icon-button"
                  type="button"
                  onClick={handleExportToHTML}
                  title="导出会议记录为 HTML"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* 真实模式下，若未配大模型引擎，展示全局警告条并引导 */}
          {showKeyWarning && (
            <div className="note-message" style={{ borderLeft: "4px solid var(--amber)", borderRadius: "4px", margin: "14px 18px 0", background: "var(--amber-soft)", color: "#684c08" }}>
              <strong>⚠️ 当前为【真枪实弹运行模式】</strong>：若您在本地的 `.env.local` 配置文件中配置了 `DASHSCOPE_API_KEY` 或 `OPENAI_API_KEY`，可直接选用【系统默认大模型】启动；若未配置，请点击右侧【自定义大模型服务】输入您的 API 密钥，否则圆桌会议发送提问时将会报错。
            </div>
          )}

          <section className="chat-thread" ref={chatThreadRef} onScroll={handleThreadScroll}>
            {activeMeeting && activeMeeting.messages.length > 0 ? (
              activeMeeting.messages.map((message) => {
                const isUser = message.role === "user";
                const isMod = message.role === "moderator";
                const isExp = message.role === "expert";

                return (
                  <article
                    className={`chat-message ${message.role}`}
                    key={message.id}
                  >
                    <div className="message-avatar">
                      {isUser ? "你" : isMod ? "主持" : message.senderName.slice(0, 2)}
                    </div>
                    <div className="message-body">
                      {(() => {
                        const safeContent = message.content || "";
                        const systemLoader = SYSTEM_LOADERS[safeContent as keyof typeof SYSTEM_LOADERS];

                        let displayContent = safeContent.replace(/[\s\n>]*$/, '');
                        if (systemLoader) {
                          displayContent = "";
                        }

                        let thinkingContent = "";
                        let isThinkingDone = false;
                        const thinkMatch = displayContent.match(/<think>([\s\S]*?)(?:<\/think>|$)/);
                        
                        if (thinkMatch) {
                          thinkingContent = thinkMatch[1].trim();
                          isThinkingDone = safeContent.includes("</think>");
                          displayContent = displayContent.replace(thinkMatch[0], "").trim();
                        } else {
                          isThinkingDone = true;
                        }

                        const isTTFB = speakingExpertIds[activeMeetingId] === message.senderId && safeContent.length === 0;
                        const isStartingThink = speakingExpertIds[activeMeetingId] === message.senderId && safeContent.startsWith("<") && !thinkMatch;

                        return (
                          <>
                            {(isExp || isMod || isUser) && (
                              <div style={{ 
                                display: "flex", 
                                alignItems: "flex-start", 
                                gap: "12px", 
                                marginBottom: "4px",
                                justifyContent: isUser ? "flex-end" : "flex-start"
                              }}>
                                <span style={{ 
                                  fontSize: "11px", 
                                  color: "var(--muted)", 
                                  marginTop: "2px",
                                  flexShrink: 0
                                }}>
                                  {(() => {
                                    if (isUser) {
                                      return <span>{userProfile.name} · {userProfile.title}</span>;
                                    }
                                    const isPseudoMod = isExp && (message.senderName === "主持人" || message.senderId === "moderator");
                                    if (isMod || isPseudoMod) {
                                      if (message.senderName === "系统提示" || message.senderName === "系统") {
                                        return <span>{message.senderName}</span>;
                                      }
                                      const name = systemPrompts?.moderatorName || message.senderName || "主持人";
                                      const title = systemPrompts?.moderatorTitle || message.senderTitle || "决策协调官";
                                      return <span>{name} · {title}</span>;
                                    }
                                    if (isExp) {
                                      const curExp = allExperts.find((e: any) => e.id === message.senderId);
                                      const isExt = curExp?.isExternalAgent;
                                      const name = curExp?.name || message.senderName;
                                      const title = curExp?.title || message.senderTitle || "总监";
                                      return (
                                        <span style={{ display: "inline-flex", alignItems: "center" }}>
                                          {name} · {title}
                                          {isExt && (
                                            <span style={{ 
                                              fontSize: "10px", 
                                              color: "var(--muted)", 
                                              padding: "1.5px 5px", 
                                              border: "1px solid var(--line)", 
                                              borderRadius: "4px", 
                                              fontWeight: "normal",
                                              display: "inline-block",
                                              marginLeft: "6px",
                                              lineHeight: 1
                                            }}>
                                              小龙虾
                                            </span>
                                          )}
                                        </span>
                                      );
                                    }
                                    return <span>{message.senderName || ""}</span>;
                                  })()}
                                </span>
                                
                                {thinkingContent && isThinkingDone && (
                                  <details style={{ flex: 1, textAlign: isUser ? "right" : "left" }}>
                                    <summary style={{ 
                                      fontSize: "11px", color: "var(--muted)", cursor: "pointer", userSelect: "none", 
                                      fontWeight: "500", display: "inline-block",
                                      background: "var(--surface-strong)", padding: "2px 8px", borderRadius: "999px",
                                      border: "1px solid var(--line)"
                                    }}>
                                      深度思考已折叠
                                    </summary>
                                    <div style={{ 
                                      fontSize: "13px", color: "var(--muted)", whiteSpace: "pre-wrap", 
                                      fontStyle: "italic", marginTop: "8px", padding: "10px 14px", 
                                      background: "rgba(0,0,0,0.02)", border: "1px dashed var(--line)", 
                                      borderRadius: "6px", textAlign: "left"
                                    }}>
                                      {thinkingContent}
                                    </div>
                                  </details>
                                )}
                              </div>
                            )}

                            {editingMessageId === message.id ? (
                              <div className="edit-message-container" style={{ marginTop: "4px", width: "100%", display: "flex", flexDirection: "column", alignItems: isUser ? "flex-end" : "flex-start" }}>
                                <textarea
                                  value={editingContent}
                                  onChange={(e) => setEditingContent(e.target.value)}
                                  autoFocus
                                  style={{
                                    width: "100%", maxWidth: "600px", minHeight: "80px", padding: "12px", borderRadius: "12px",
                                    border: "1px solid var(--line)", background: "var(--surface)",
                                    fontSize: "14px", fontFamily: "inherit", resize: "vertical",
                                    boxShadow: "0 2px 8px rgba(0,0,0,0.05)", outline: "none"
                                  }}
                                />
                                <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                                  <button
                                    onClick={() => setEditingMessageId(null)}
                                    style={{ padding: "6px 14px", borderRadius: "6px", border: "1px solid var(--line)", background: "var(--surface)", cursor: "pointer", fontSize: "13px", fontWeight: 500 }}
                                  >
                                    取消
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingMessageId(null);
                                      const msgIndex = activeMeeting!.messages.findIndex(m => m.id === message.id);
                                      const baseHistory = activeMeeting!.messages.slice(0, msgIndex);
                                      handleSubmitDiscussion(undefined, {
                                        targetMeetingId: activeMeetingId!,
                                        userQuestion: editingContent,
                                        baseHistory: baseHistory,
                                        baseSources: message.sources || []
                                      });
                                    }}
                                    style={{ padding: "6px 14px", borderRadius: "6px", border: "none", background: "var(--ink)", color: "var(--surface)", cursor: "pointer", fontSize: "13px", fontWeight: 500 }}
                                  >
                                    保存并重新生成
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                {systemLoader && (
                                  <div 
                                    className="thinking-card" 
                                    style={{ 
                                      borderStyle: "solid", 
                                      borderColor: (systemLoader as any).isError ? "var(--red)" : "var(--amber)", 
                                      borderRadius: "8px", 
                                      background: (systemLoader as any).isError ? "var(--red-soft)" : "transparent", 
                                      padding: "12px 14px", 
                                      marginBottom: "8px" 
                                    }}
                                  >
                                    <div className="thinking-loader" style={{ margin: 0 }}>
                                      <strong style={{ color: (systemLoader as any).isError ? "var(--red)" : "var(--amber)" }}>
                                        {message.senderName}
                                      </strong>{" "}
                                      <span style={{ color: (systemLoader as any).isError ? "var(--red)" : "inherit" }}>
                                        {systemLoader.title}
                                      </span>
                                      {!(systemLoader as any).isError && (
                                        <div className="dot-pulse" style={{ marginLeft: "6px" }}>
                                          <span />
                                          <span />
                                          <span />
                                        </div>
                                      )}
                                    </div>
                                    <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "4px" }}>
                                      {systemLoader.subtitle}
                                    </div>
                                  </div>
                                )}


                                {(!isThinkingDone && (isTTFB || isStartingThink || thinkingContent.length > 0)) && (
                                  <div className="thinking-card" style={{ marginBottom: "8px", background: "transparent", border: "none", padding: "0" }}>
                                    <div className="thinking-loader" style={{ margin: 0, opacity: 0.7 }}>
                                      <span>
                                        {isTTFB ? "正在审视议题" : "正在深度思考"}
                                      </span>
                                      <div className="dot-pulse" style={{ marginLeft: "4px" }}>
                                        <span /><span /><span />
                                      </div>
                                    </div>
                                    {isTTFB && (
                                      <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "4px" }}>
                                        正在结合个人对抗强度与会议历史多轮对话上下文编排论点...
                                      </div>
                                    )}
                                    {thinkingContent && (
                                      <div style={{ fontSize: "13px", color: "var(--muted)", whiteSpace: "pre-wrap", fontStyle: "italic", marginTop: "8px", paddingLeft: "12px", borderLeft: "2px solid var(--line)" }}>
                                        {thinkingContent}
                                      </div>
                                    )}
                                  </div>
                                )}

                                {displayContent && (
                                  <div className="message-hover-wrapper" style={{ display: "flex", alignItems: "flex-end", justifyContent: isUser ? "flex-end" : "flex-start", gap: "8px" }}>
                                    {isUser && (
                                      <button
                                        className="message-edit-btn"
                                        onClick={() => {
                                          setEditingMessageId(message.id);
                                          setEditingContent(message.content);
                                        }}
                                        title="重新编辑"
                                      >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                        </svg>
                                      </button>
                                    )}
                                    <div className="message-content markdown-body" style={{ fontSize: "14px", position: "relative", margin: 0 }}>
                                      <ReactMarkdown 
                                        remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]}
                                        rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
                                      >
                                        {displayContent}
                                      </ReactMarkdown>
                                    </div>
                                  </div>
                                )}
                              </>
                            )}
                          </>
                        );
                      })()}

                      {message.sources && message.sources.length > 0 && (
                        <div className="message-sources" style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px", justifyContent: isUser ? "flex-end" : "flex-start" }}>
                          {message.sources.map((source) => (
                            <div key={source.id} className="attachment-pill" style={{ background: "var(--surface)", border: "1px solid var(--line)", padding: "4px 8px", borderRadius: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
                              <span style={{ fontSize: "10px", fontWeight: "bold", color: "var(--muted)", background: "var(--surface-strong)", padding: "2px 4px", borderRadius: "4px" }}>
                                {source.kind.toUpperCase()}
                              </span>
                              <span style={{ fontSize: "13px", color: "var(--ink)", maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{source.name}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {message.expertStance && (
                        <div className="assistant-result" style={{ marginTop: "10px" }}>
                          <div className="result-card" style={{ borderLeft: "3px solid var(--amber)", borderRadius: "8px" }}>
                            <div className="result-grid">
                              <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}><strong style={{ flexShrink: 0 }}>立场观点：</strong><div style={{ flex: 1, minWidth: 0, margin: 0 }} className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}>{beautifyListFormatting(ensureString(message.expertStance.stance))}</ReactMarkdown></div></div>
                              <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}><strong style={{ flexShrink: 0 }}>关键风险：</strong><div style={{ flex: 1, minWidth: 0, margin: 0 }} className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}>{beautifyListFormatting(ensureString(message.expertStance.concern))}</ReactMarkdown></div></div>
                              <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}><strong style={{ flexShrink: 0 }}>实施建议：</strong><div style={{ flex: 1, minWidth: 0, margin: 0 }} className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}>{beautifyListFormatting(ensureString(message.expertStance.recommendation))}</ReactMarkdown></div></div>
                              <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}><strong style={{ flexShrink: 0 }}>方案取舍：</strong><div style={{ flex: 1, minWidth: 0, margin: 0 }} className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}>{beautifyListFormatting(ensureString(message.expertStance.tradeoff))}</ReactMarkdown></div></div>
                            </div>
                          </div>
                        </div>
                      )}

                      {message.moderatorSummary && (
                        <div className="assistant-result" style={{ marginTop: "10px" }}>
                          <div className="result-card" style={{ borderLeft: "3px solid var(--blue)", borderRadius: "8px", background: "rgba(2, 132, 199, 0.03)" }}>
                            <div className="result-grid">
                              <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}><strong style={{ flexShrink: 0, color: "var(--blue)" }}>总结共识：</strong><div style={{ flex: 1, minWidth: 0, margin: 0 }} className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}>{beautifyListFormatting(ensureString(message.moderatorSummary.consensus))}</ReactMarkdown></div></div>
                              <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}><strong style={{ flexShrink: 0, color: "var(--blue)" }}>主要分歧：</strong><div style={{ flex: 1, minWidth: 0, margin: 0 }} className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}>{beautifyListFormatting(ensureString(message.moderatorSummary.disagreements))}</ReactMarkdown></div></div>
                              <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}><strong style={{ flexShrink: 0, color: "var(--blue)" }}>最终决策：</strong><div style={{ flex: 1, minWidth: 0, margin: 0 }} className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}>{beautifyListFormatting(ensureString(message.moderatorSummary.decisions))}</ReactMarkdown></div></div>
                              <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}><strong style={{ flexShrink: 0, color: "var(--blue)" }}>下一步行动：</strong><div style={{ flex: 1, minWidth: 0, margin: 0 }} className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}>{beautifyListFormatting(ensureString(message.moderatorSummary.nextActions))}</ReactMarkdown></div></div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })
            ) : (
              <div style={{
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                height: "100%", padding: "60px 20px", textAlign: "center", userSelect: "none"
              }}>
                <div style={{
                  width: "80px", height: "80px", borderRadius: "50%", 
                  background: "linear-gradient(135deg, rgba(212, 175, 55, 0.05) 0%, rgba(212, 175, 55, 0.15) 100%)",
                  boxShadow: "0 8px 32px rgba(212, 175, 55, 0.1), inset 0 0 0 1px rgba(212, 175, 55, 0.2)",
                  display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "28px"
                }}>
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                    <circle cx="9" cy="7" r="4"></circle>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                  </svg>
                </div>
                <p style={{ fontSize: "12px", fontWeight: "700", letterSpacing: "1.5px", color: "var(--amber)", textTransform: "uppercase", marginBottom: "12px", opacity: 0.8 }}>
                  Agent Council AI
                </p>
                <h3 style={{ fontSize: "22px", fontWeight: "600", color: "var(--ink)", marginBottom: "16px", letterSpacing: "0.5px" }}>
                  开启一场专家圆桌会议
                </h3>
                <p style={{ fontSize: "14px", lineHeight: "1.7", maxWidth: "480px", margin: "0 auto", color: "var(--muted)", fontWeight: "400" }}>
                  在这里，多元视角的 AI 智囊团已就位。<br/>
                  请在下方抛出您的产品规划、技术方案或业务瓶颈，他们将从各自的专业切面出发，为您提供全方位的深度论证与灵感碰撞。
                </p>
              </div>
            )}



            {assigningNextSpeaker[activeMeetingId] && (
              <article className="chat-message moderator">
                <div className="message-avatar">主持</div>
                <div className="message-body">
                  <div className="thinking-card" style={{ borderStyle: "solid", borderColor: "var(--amber)", borderRadius: "8px" }}>
                    <div className="thinking-loader">
                      <strong style={{ color: "var(--amber)" }}>主持人</strong> 正在智能指派下一位发言专家
                      <div className="dot-pulse">
                        <span />
                        <span />
                        <span />
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            )}

            {synthesisPendingMeetings[activeMeetingId] && (
              <article className="chat-message moderator">
                <div className="message-avatar">主持</div>
                <div className="message-body">
                  <div className="thinking-card" style={{ borderStyle: "solid", borderColor: "var(--amber)", borderRadius: "8px" }}>
                    <div className="thinking-loader">
                      <strong style={{ color: "var(--amber)" }}>主持人</strong> 正在汇总本轮会议纪要
                      <div className="dot-pulse">
                        <span />
                        <span />
                        <span />
                      </div>
                    </div>
                    <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                      正在综合各个智能体的共识、分歧以及下一步建议动作...
                    </span>
                  </div>
                </div>
              </article>
            )}

            {/* 提炼/更新结论触发器已移至底栏胶囊控制台 */}

            {generatingConclusions[activeMeetingId] && (
              <div style={{ display: "flex", justifyContent: "center", padding: "20px 0 40px" }}>
                <div className="thinking-card" style={{ borderStyle: "solid", borderColor: "var(--amber)", borderRadius: "999px", display: "inline-flex", alignItems: "center", gap: "12px" }}>
                  <div className="thinking-loader" style={{ margin: 0 }}>
                    <strong style={{ color: "var(--amber)" }}>正在提炼最终结论</strong>
                    <div className="dot-pulse">
                      <span /><span /><span />
                    </div>
                  </div>
                  <button className="ghost-button" onClick={handleAbortConclusion} style={{ fontSize: "12px", padding: "2px 8px", minHeight: "24px", color: "var(--muted)", borderLeft: "1px solid var(--line)" }}>
                    ⏹️ 取消
                  </button>
                </div>
              </div>
            )}

            {/* 最终结论展示/编辑面板 (讨论解锁时不展示) */}
            {activeMeeting?.finalConclusion && !unlockedComposers[activeMeetingId] && (
              <div id="conclusion-panel" className="conclusion-panel" style={{ 
                margin: "32px 18px 0px", 
                padding: "24px 24px 8px 24px", 
                border: "2px solid var(--amber)", 
                borderRadius: "12px", 
                background: "var(--amber-soft)",
                position: "relative",
                scrollMarginTop: "32px"
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", borderBottom: "1px solid rgba(212,175,55,0.3)", paddingBottom: "12px" }}>
                  <h3 style={{ margin: 0, color: "#684c08", display: "flex", alignItems: "center", gap: "8px", fontSize: "16px" }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
                    会议最终结论
                  </h3>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button className="ghost-button export-hidden" onClick={() => { setConclusionDraft(activeMeeting.finalConclusion || ""); setIsEditingConclusion(true); }} style={{ fontSize: "12px", padding: "4px 12px", height: "auto", minHeight: "28px", display: "flex", alignItems: "center", gap: "6px" }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                      编辑
                    </button>
                  </div>
                </div>
                
                {isEditingConclusion ? (
                  <div>
                    <textarea 
                      value={conclusionDraft} 
                      onChange={e => setConclusionDraft(e.target.value)}
                      style={{ width: "100%", height: "200px", padding: "12px", borderRadius: "8px", border: "1px solid var(--line-strong)", resize: "vertical", fontFamily: "inherit", fontSize: "14px", lineHeight: 1.6 }}
                    />
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "12px" }}>
                      <button className="ghost-button" onClick={() => setIsEditingConclusion(false)}>取消</button>
                      <button className="primary-button" onClick={handleSaveConclusion}>保存结论</button>
                    </div>
                  </div>
                ) : (
                  <div className="markdown-body" style={{ fontSize: "14px", color: "var(--ink)" }}>
                    <ReactMarkdown 
                      remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]}
                      rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
                    >
                      {activeMeeting.finalConclusion}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            )}

            <div ref={chatEndRef} />
          </section>

          {/* 附件上传 */}
          <div
            className={`composer-shell ${isDraggingSources ? "is-dragging" : ""}`}
            style={{ position: "relative" }}
            onDragLeave={() => setIsDraggingSources(false)}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDraggingSources(true);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setIsDraggingSources(false);
              void addSourceFiles(e.dataTransfer.files);
            }}
          >
            {/* 结论锁定蒙版 */}
            {activeMeeting?.finalConclusion && !unlockedComposers[activeMeetingId] && (
              <div style={{
                position: "absolute",
                top: 0, left: 0, right: 0, bottom: 0,
                background: "rgba(255,254,250,0.85)",
                backdropFilter: "blur(4px)",
                zIndex: 20,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "12px",
                border: "1px solid var(--line)",
                gap: "12px"
              }}>
                <span style={{ fontSize: "15px", fontWeight: 600, color: "var(--ink)", display: "flex", alignItems: "center", gap: "8px" }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                  本场会议已得出最终结论，讨论已归档
                </span>
                <button className="ghost-button" onClick={handleUnlockComposer} style={{ background: "var(--surface-strong)", border: "1px solid var(--line-strong)", display: "flex", alignItems: "center", gap: "6px" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>
                  解除归档，继续讨论
                </button>
              </div>
            )}

            <div className="composer-drag-hint">
              <strong>松手添加附件</strong>
              <span>文本和图片将载入大模型上下文</span>
            </div>
            
            <input
              accept="image/*,.pdf,.doc,.docx,.md,.txt,.json,.csv"
              className="hidden-file-input"
              multiple
              ref={fileInputRef}
              type="file"
              onChange={handleSourceInputChange}
            />

            {sources.length > 0 && (
              <div className="composer-sources">
                {sources.map((source) => (
                  <span className="attachment-pill" key={source.id}>
                    <span className="attachment-thumb">
                      {source.kind.toUpperCase()}
                    </span>
                    <span className="attachment-name">{source.name}</span>
                    <button
                      aria-label={`移除 ${source.name}`}
                      type="button"
                      onClick={() => removeSource(source.id)}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="composer-row">
              <textarea
                className="composer-input"
                placeholder={generatingConclusions[activeMeetingId] ? "正在提炼最终结论，请稍候..." : "抛出全新议题，或上传相关资料..."}
                value={question}
                disabled={discussingMeetings[activeMeetingId] || generatingConclusions[activeMeetingId]}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <div className="composer-actions">
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button
                    aria-label="添加附件"
                    className="composer-add"
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    +
                  </button>

                  {/* 内嵌的会议设置项 (胶囊控制台方案) */}
                  {activeMeeting && (
                    <div style={{ display: "flex", gap: "8px", padding: "4px 8px", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "8px", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                        <span style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 600 }}>主持</span>
                        <select
                          className="toolbar-select"
                          value={activeMeeting.moderatorId}
                          onChange={(e) => void updateActiveMeeting({ moderatorId: e.target.value })}
                          title="主持风格"
                          style={{ background: "transparent", border: "none", padding: "0 4px", fontSize: "12px", outline: "none", cursor: "pointer", color: "var(--ink-soft)" }}
                        >
                          {moderatorModes.map(m => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                          ))}
                        </select>
                      </div>

                      <div style={{ width: "1px", height: "12px", background: "var(--line)" }} />

                      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                        <span style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 600 }}>机制</span>
                        <select 
                          className="toolbar-select"
                          value={activeMeeting.turnOrderMode}
                          onChange={(e) => void updateActiveMeeting({ turnOrderMode: e.target.value as any })}
                          title="发言顺序"
                          style={{ background: "transparent", border: "none", padding: "0 4px", fontSize: "12px", outline: "none", cursor: "pointer", color: "var(--ink-soft)" }}
                        >
                          <option value="sequential">顺序发言</option>
                          <option value="relevance">动态指派</option>
                          <option value="manual">手动点名</option>
                        </select>
                      </div>

                      <div style={{ width: "1px", height: "12px", background: "var(--line)" }} />

                      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                        <span style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 600 }}>火力</span>
                        <select
                          className="toolbar-select"
                          value={activeMeeting.globalDebateIntensity}
                          onChange={(e) => void updateActiveMeeting({ globalDebateIntensity: Number(e.target.value) })}
                          title="对抗强度"
                          style={{ background: "transparent", border: "none", padding: "0 4px", fontSize: "12px", outline: "none", cursor: "pointer", color: "var(--ink-soft)" }}
                        >
                          <option value="1">1 (温和)</option>
                          <option value="2">2 (建设)</option>
                          <option value="3">3 (客观)</option>
                          <option value="4">4 (尖锐)</option>
                          <option value="5">5 (极限)</option>
                        </select>
                      </div>

                      <div style={{ width: "1px", height: "12px", background: "var(--line)" }} />
                      
                      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                        <span style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 600 }}>引擎</span>
                        <select 
                          className="toolbar-select" 
                          value={activeEngineId} 
                          onChange={(e) => void handleSelectEngine(e.target.value)}
                          title="选择模型引擎"
                          style={{ background: "transparent", border: "none", padding: "0 4px", fontSize: "12px", outline: "none", cursor: "pointer", color: "var(--ink-soft)" }}
                        >
                          <option value="system-env">系统内置</option>
                          {engineConfigs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </div>

                      {/* 结论触发按钮（集成在控制台最右侧） */}
                      {activeMeeting && activeMeeting.messages.length > 2 && (!activeMeeting.finalConclusion || unlockedComposers[activeMeetingId]) && (
                        <>
                          <div style={{ width: "1px", height: "12px", background: "var(--line)", marginLeft: "4px" }} />
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={handleGenerateConclusion}
                            disabled={generatingConclusions[activeMeetingId]}
                            style={{ 
                              fontSize: "12px", 
                              padding: "2px 8px", 
                              height: "auto", 
                              minHeight: "24px", 
                              color: "var(--amber)", 
                              fontWeight: 600, 
                              display: "flex", 
                              alignItems: "center", 
                              gap: "4px",
                              opacity: generatingConclusions[activeMeetingId] ? 0.5 : 1
                            }}
                            title={activeMeeting.finalConclusion ? "更新最终结论" : "提炼最终结论"}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                            {generatingConclusions[activeMeetingId] ? "提炼中..." : (activeMeeting.finalConclusion ? "更新结论" : "提炼结论")}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {(activeMeetingId && (discussingMeetings[activeMeetingId] || generatingConclusions[activeMeetingId])) ? (
                  <button
                    aria-label="叫停"
                    className="btn-abort"
                    type="button"
                    onClick={() => {
                      if (activeMeetingId && discussingMeetings[activeMeetingId]) handleAbort();
                      if (activeMeetingId && generatingConclusions[activeMeetingId]) handleAbortConclusion();
                    }}
                  >
                    <span style={{ fontSize: "14px" }}>■</span>
                  </button>
                ) : (
                  <button
                    aria-label="召开圆桌"
                    className="composer-send"
                    disabled={!question.trim() || !activeMeeting || activeMeeting.expertIds.length === 0}
                    type="submit"
                  >
                    <span style={{ fontSize: "18px" }}>↑</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>


      </form>

        {/* 弹窗：新建自定义智能体 (已抽取为独立组件) */}
        <ExpertModal 
          isOpen={isCustomModalOpen}
          mode={customModalMode}
          onClose={() => setIsCustomModalOpen(false)}
          onSave={handleSaveCustomExpert}
          initialData={customModalDraft}
          meetingContext={activeMeeting ? { name: activeMeeting.name, description: activeMeeting.description } : undefined}
        />

        {/* 新建/编辑会议 Modal */}
        {isMeetingModalOpen && (
          <div className="modal-backdrop" onClick={() => setIsMeetingModalOpen(false)}>
            <section className="modal-card" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div>
                  <p className="eyebrow">{meetingModalMode === "create" ? "New Meeting" : "Edit Meeting"}</p>
                  <h2>{meetingModalMode === "create" ? "新建专家评审圆桌" : "编辑会议信息"}</h2>
                </div>
                <button className="icon-button" type="button" onClick={() => setIsMeetingModalOpen(false)}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
              <form onSubmit={handleConfirmCreateMeeting} style={{ padding: "0 24px" }}>
                <label className="compact-field">
                  <span>会议名称</span>
                  <input required value={newMeetingDraft.name || ""} onChange={e => setNewMeetingDraft({...newMeetingDraft, name: e.target.value})} />
                </label>
                <label className="compact-field">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                    <span style={{ marginBottom: 0 }}>会议描述 (核心议题上下文)</span>
                    <button
                      type="button"
                      onClick={handleGenerateMeetingDesc}
                      disabled={isGeneratingMeetingDesc || !newMeetingDraft.name}
                      style={{
                        background: "none", border: "none", color: "var(--amber)", fontSize: "12px",
                        cursor: (isGeneratingMeetingDesc || !newMeetingDraft.name) ? "not-allowed" : "pointer",
                        opacity: (isGeneratingMeetingDesc || !newMeetingDraft.name) ? 0.5 : 1,
                        display: "flex", alignItems: "center", gap: "4px"
                      }}
                    >
                      ✨ {isGeneratingMeetingDesc ? "生成中..." : "AI 自动完善"}
                    </button>
                  </div>
                  <textarea style={{ minHeight: "80px" }} required value={newMeetingDraft.description || ""} onChange={e => setNewMeetingDraft({...newMeetingDraft, description: e.target.value})} />
                </label>
                <label className="compact-field">
                  <span>全局辩论强度 (1-5)</span>
                  <input type="number" min="1" max="5" required value={newMeetingDraft.globalDebateIntensity || 3} onChange={e => setNewMeetingDraft({...newMeetingDraft, globalDebateIntensity: parseInt(e.target.value)})} />
                </label>
                <label className="compact-field">
                  <span>流转模式</span>
                  <select required value={newMeetingDraft.turnOrderMode || "sequential"} onChange={e => setNewMeetingDraft({...newMeetingDraft, turnOrderMode: e.target.value as any})}>
                    <option value="sequential">顺序发言</option>
                    <option value="relevance">智能相关度派单</option>
                    <option value="manual">手动点名</option>
                  </select>
                </label>
                <div className="modal-actions" style={{ padding: "24px 0", marginTop: "8px" }}>
                  <button type="button" className="ghost-button" onClick={() => setIsMeetingModalOpen(false)}>取消</button>
                  <button type="submit" className="primary-button">{meetingModalMode === "create" ? "创建会议" : "保存修改"}</button>
                </div>
              </form>
            </section>
          </div>
        )}

        {/* 弹窗：管理新增组织大模型引擎 */}
        {isEngineModalOpen && (
          <div className="modal-backdrop">
            <section className="modal-card">
              <div className="modal-header">
                <div>
                  <p className="eyebrow">Organization Engine</p>
                  <h2>配置组织自定义大模型引擎</h2>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => setIsEngineModalOpen(false)}
                >
                  ×
                </button>
              </div>

              <label className="compact-field">
                <span>引擎配置名称</span>
                <input
                  placeholder="如：通义千问 Qwen-Plus 共享"
                  value={engineDraft.name}
                  onChange={(e) => setEngineDraft({ ...engineDraft, name: e.target.value })}
                />
              </label>

              <label className="compact-field">
                <span>API 接口基地址 (Base URL)</span>
                <input
                  placeholder="兼容 OpenAI 格式的地址，如 https://api.deepseek.com/v1"
                  value={engineDraft.baseUrl}
                  onChange={(e) => setEngineDraft({ ...engineDraft, baseUrl: e.target.value })}
                />
              </label>

              <label className="compact-field">
                <span>接口凭证 (API Key)</span>
                <input
                  type="password"
                  placeholder="填写可在组织共享的 API Key"
                  value={engineDraft.apiKey}
                  onChange={(e) => setEngineDraft({ ...engineDraft, apiKey: e.target.value })}
                />
              </label>

              <label className="compact-field">
                <span>部署模型名称 (Model)</span>
                <input
                  placeholder="如 deepseek-chat, qwen-plus, gpt-4o 等"
                  value={engineDraft.model}
                  onChange={(e) => setEngineDraft({ ...engineDraft, model: e.target.value })}
                />
              </label>

              {engineError && <p className="custom-error">{engineError}</p>}

              <div className="modal-actions">
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => setIsEngineModalOpen(false)}
                >
                  取消
                </button>
                <button
                  className="primary-button"
                  type="button"
                  onClick={handleAddEngineConfig}
                >
                  保存引擎
                </button>
              </div>
            </section>
          </div>
        )}

        {/* 弹窗：确认删除自定义角色 */}
        {deleteCandidate && (
          <div className="modal-backdrop">
            <section className="modal-card confirm-card">
              <div className="modal-header">
                <div>
                  <p className="eyebrow danger-eyebrow">Delete Agent</p>
                  <h2>确定删除该组织智能体吗？</h2>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => setDeleteCandidate(null)}
                >
                  ×
                </button>
              </div>
              <p className="confirm-copy">
                “{deleteCandidate.name}” 将从组织中删除。正在参会的会议也将不再勾选此角色。
              </p>
              <div className="modal-actions">
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => setDeleteCandidate(null)}
                >
                  取消
                </button>
                <button
                  className="danger-button"
                  type="button"
                  onClick={confirmDeleteCustomExpert}
                >
                  确认删除
                </button>
              </div>
            </section>
          </div>
        )}
      </main>
    </main>
  );
}
