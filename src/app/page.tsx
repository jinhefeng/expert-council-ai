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
import ChatMessageCard from "@/components/ChatMessageCard";
import { ThinkingBlock } from "@/components/ThinkingBlock";
import { LocalStorageService } from "@/lib/storage-service";
import { extractAndCleanJson, cleanStreamingJson, cleanAndParseJson, beautifyListFormatting, extractInquiryPrompt, extractAndCleanModeratorJson, parseThinkingContent } from "@/lib/content-parser";
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
    onChunk?: (text: string, isExtracting?: boolean) => void;
    resolve: (res: { content: string; expertStance: any }) => void;
    reject: (err: Error) => void;
  }>>({});
  
  const [llmParams, setLlmParams] = useState<LLMParamsConfig | null>(null);
  const [systemPrompts, setSystemPrompts] = useState<SystemPromptsConfig | null>(null);
  const [businessDefaults, setBusinessDefaults] = useState<BusinessDefaultsConfig | null>(null);
  
  // 活动的模型引擎 ID
  const [activeEngineId, setActiveEngineId] = useState<string>("");

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

  // --- 人类决策协调与反馈环挂起控制状态 ---
  const [steeringConsoleMeetingId, setSteeringConsoleMeetingId] = useState<string | null>(null);
  const [inquiryConsoleMeetingId, setInquiryConsoleMeetingId] = useState<string | null>(null);
  const [inquiryPromptText, setInquiryPromptText] = useState<string>("");
  const [steeringPendingMeetings, setSteeringPendingMeetings] = useState<Record<string, boolean>>({});
  const [inquiryPendingMeetings, setInquiryPendingMeetings] = useState<Record<string, boolean>>({});
  const [steeringInput, setSteeringInput] = useState("");
  const [inquiryInput, setInquiryInput] = useState("");
  
  // 决策方向性意见状态
  const [meetingDecisionOptions, setMeetingDecisionOptions] = useState<Record<string, string[]>>({});
  const [generatingDecisionOptions, setGeneratingDecisionOptions] = useState<Record<string, boolean>>({});
  const [selectedDecisionOption, setSelectedDecisionOption] = useState<string>("");
  const [steeringCountdown, setSteeringCountdown] = useState<number | null>(null);
  const countdownTimerRef = useRef<any>(null);

  const handleCancelSteeringCountdown = () => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
      setSteeringCountdown(null);
    }
  };

  const facilitativeResolverRef = useRef<{
    resolve: (action: { type: "choose" | "finish"; opinion?: string }) => void;
    reject: (err: any) => void;
  } | null>(null);

  const inquiryResolverRef = useRef<{
    resolve: (action: { type: "skip" | "submit"; content?: string }) => void;
    reject: (err: any) => void;
  } | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);



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

  const scrollToConclusion = (behavior: ScrollBehavior = "smooth") => {
    const conclusionEl = document.getElementById("conclusion-panel");
    if (conclusionEl) {
      conclusionEl.scrollIntoView({ behavior, block: "start" });
      isAutoScrollEnabled.current = false;
    }
  };

  const meetingsRef = useRef<Meeting[]>([]);
  const lastScrollTimeRef = useRef<number>(0);
  useEffect(() => {
    meetingsRef.current = meetings;
  }, [meetings]);

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
      const activeConfig = loadedConfigs.find(c => c.isActive) || loadedConfigs[0];
      if (activeConfig) {
        setActiveEngineId(activeConfig.id);
      } else {
        setActiveEngineId("");
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
          moderatorAutonomy: "facilitative",
          enableInquiryLoop: true,
          decisionState: "pending",
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
    // 防御性排重：当自定义专家ID与内置专家重复时以内置（含覆写）专家为准，防止 React Key 重复警告
    const systemIds = new Set(systemExperts.map(e => e.id));
    const uniqueCustom = availableCustom.filter(e => !systemIds.has(e.id));
    return [...systemExperts, ...uniqueCustom];
  }, [systemExperts, customExperts, activeMeetingId]);

  const activeMeeting = useMemo(() => {
    return meetings.find(m => m.id === activeMeetingId);
  }, [meetings, activeMeetingId]);

  const isSessionActive = activeMeetingId ? (!!discussingMeetings[activeMeetingId] || !!generatingConclusions[activeMeetingId]) : false;
  const isSessionPaused = activeMeetingId ? (inquiryConsoleMeetingId === activeMeetingId || steeringConsoleMeetingId === activeMeetingId) : false;
  const isControlsDisabled = isSessionActive && !isSessionPaused;

  // 自主决策倒计时定时器管理
  useEffect(() => {
    if (steeringConsoleMeetingId && activeMeeting && activeMeeting.moderatorAutonomy === "autonomous") {
      const defaultSecs = llmParams?.autonomousCountdownSeconds ?? 10;
      setSteeringCountdown(defaultSecs);

      let currentSecs = defaultSecs;
      countdownTimerRef.current = setInterval(() => {
        currentSecs--;
        if (currentSecs <= 0) {
          if (countdownTimerRef.current) {
            clearInterval(countdownTimerRef.current);
            countdownTimerRef.current = null;
          }
          setSteeringCountdown(null);

          // 自动选择第一个选项并推进
          const options = meetingDecisionOptions[activeMeeting.id] || [];
          const autoOpinion = options[0] || "方向一：维持现状，进一步观测和评估指标细节";
          
          facilitativeResolverRef.current?.resolve({
            type: "choose",
            opinion: autoOpinion
          });
        } else {
          setSteeringCountdown(currentSecs);
        }
      }, 1000);
    } else {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
      setSteeringCountdown(null);
    }

    return () => {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
    };
  }, [steeringConsoleMeetingId, activeMeeting?.id, activeMeeting?.moderatorAutonomy, meetingDecisionOptions, llmParams?.autonomousCountdownSeconds]);

  // 决策面板滚动对齐：面板渲染后自动滚到可视区顶部
  useEffect(() => {
    if (steeringConsoleMeetingId && activeMeeting && steeringConsoleMeetingId === activeMeeting.id) {
      const timer = setTimeout(() => {
        document.getElementById("steering-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [steeringConsoleMeetingId, activeMeeting?.id]);


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
                    resolver.onChunk(resolver.text, false);
                  } else {
                    const cleaned = cleanStreamingJson(resolver.text);
                    const isExtracting = (resolver.text.includes("<think>") && !resolver.text.includes("</think>"))
                      ? false
                      : cleaned.length < resolver.text.trim().length;
                    resolver.onChunk(cleaned, isExtracting);
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
    const thread = chatThreadRef.current;
    
    // 智能防抖/节流滚动：限制 60ms 周期，并采用 rAF 二次纠偏抵消公式和文本的高度抖动，减少 Forced Reflow
    const scrollToBottom = () => {
      if (!thread || !isAutoScrollEnabled.current) return;
      const now = Date.now();
      if (now - lastScrollTimeRef.current < 60) {
        return;
      }
      lastScrollTimeRef.current = now;
      chatEndRef.current?.scrollIntoView({ behavior: "auto" });
      requestAnimationFrame(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "auto" });
      });
    };

    if (activeMeetingId !== prevMeetingIdRef.current) {
      // 切换了会议，尝试恢复保存的滚动位置
      if (thread && activeMeetingId) {
        // 使用 setTimeout 确保 DOM 渲染完成
        setTimeout(() => {
          const savedScroll = scrollPositions.current[activeMeetingId];
          if (savedScroll !== undefined) {
            thread.scrollTop = savedScroll;
            const { scrollTop, scrollHeight, clientHeight } = thread;
            isAutoScrollEnabled.current = scrollHeight - scrollTop - clientHeight < 150;
          } else {
            if (activeMeeting?.finalConclusion && !unlockedComposers[activeMeetingId]) {
              scrollToConclusion("auto");
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
        scrollToBottom();
      }
    }
    prevMeetingIdRef.current = activeMeetingId || null;
  }, [
    activeMeetingId,
    activeMeeting?.messages,
    activeMeetingId ? speakingExpertIds[activeMeetingId] : null,
    activeMeetingId ? synthesisPendingMeetings[activeMeetingId] : false,
    activeMeetingId ? inquiryPendingMeetings[activeMeetingId] : false,
    activeMeetingId ? generatingDecisionOptions[activeMeetingId] : false
  ]);

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
    return engineConfigs.length === 0;
  }, [engineConfigs]);

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
      description: businessDefaults?.defaultMeetingDesc || "关于复杂议题论证 of 专家圆桌会议",
      globalDebateIntensity: businessDefaults?.defaultDebateIntensity || 3,
      turnOrderMode: businessDefaults?.defaultTurnOrderMode || "sequential",
      moderatorAutonomy: "facilitative",
      enableInquiryLoop: true,
      decisionState: "pending",
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
      moderatorAutonomy: activeMeeting.moderatorAutonomy || "passive",
      enableInquiryLoop: activeMeeting.enableInquiryLoop !== false,
      decisionState: activeMeeting.decisionState || "pending",
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
        moderatorAutonomy: newMeetingDraft.moderatorAutonomy || "facilitative",
        enableInquiryLoop: newMeetingDraft.enableInquiryLoop !== false,
        decisionState: newMeetingDraft.decisionState || "pending",
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
          moderatorAutonomy: newMeetingDraft.moderatorAutonomy || "facilitative",
          enableInquiryLoop: newMeetingDraft.enableInquiryLoop !== false,
          decisionState: newMeetingDraft.decisionState || "pending",
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
      setActiveEngineId(nextConfigs[0]?.id || "");
    }
  }

  function handleExportEngineConfigs() {
    if (engineConfigs.length === 0) {
      alert("没有可导出的自定义模型配置。");
      return;
    }
    const exportData = JSON.stringify(engineConfigs.filter(c => !c.isSystem), null, 2);
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
          // 防御：禁止导入系统预设只读大模型
          if (item.isSystem || item.id.startsWith("system-")) {
            continue;
          }
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
    onChunk?: (text: string, isExtracting: boolean) => void
  ): Promise<{ content: string; expertStance: any }> {
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
          const streamTimeoutSeconds = llmParams?.expertStreamTimeoutSeconds ?? 45;
          timeoutId = setTimeout(() => {
            cleanupTimeout();
            delete wsResolversRef.current[expert.id];
            signal.removeEventListener("abort", onAbort);
            reject(new Error(`外部智能体 [${expert.name}] 发言断流超时：已超过 ${streamTimeoutSeconds} 秒未收到后续文本，流程自动跳过。`));
          }, streamTimeoutSeconds * 1000);
        };

        const wrappedOnChunk = (text: string, isExtracting?: boolean) => {
          if (!hasReceivedFirstChar) {
            hasReceivedFirstChar = true;
            cleanupTimeout(); // 清除 90 秒首字超时
          }
          resetKeepAliveTimeout(); // 刷新 45 秒断流超时
          if (onChunk) {
            onChunk(text, isExtracting || false);
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
          // 启动外部智能体首字无响应超时定时器
          const firstCharTimeoutSeconds = llmParams?.expertFirstCharTimeoutSeconds ?? 90;
          timeoutId = setTimeout(() => {
            cleanupTimeout();
            delete wsResolversRef.current[expert.id];
            signal.removeEventListener("abort", onAbort);
            reject(new Error(`外部智能体 [${expert.name}] 响应超时：已超过 ${firstCharTimeoutSeconds} 秒无任何吐字回应，流程自动跳过。`));
          }, firstCharTimeoutSeconds * 1000);

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
            meetingName: meeting.name,
            meetingDesc: meeting.description,
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


    // 确定会议室默认引擎配置
    const meetingEngineConfig = activeEngineConfig;

    // 动态路由专家的大模型配置
    let targetEngineConfig = meetingEngineConfig;
    if (expert.modelMode === "custom" && expert.modelId) {
      const matched = engineConfigs.find(c => c.id === expert.modelId);
      if (matched) {
        targetEngineConfig = matched;
      } else {
        console.warn(`[ModelRouter] 专家 [${expert.name}] 指定的大模型配置 ID "${expert.modelId}" 不存在。已自动退回到会议室默认模型 [${activeEngineConfig?.name || "未配置模型"}].`);
      }
    }

    const body = {
      question: userQuestion,
      projectContext: contextStr,
      expert,
      previousTurns,
      globalDebateIntensity: meeting.globalDebateIntensity,
      engineConfig: targetEngineConfig,
      conversationHistory: history,
      llmParams,
      systemPrompts,
      userProfile,
      meetingName: meeting.name,
      meetingDesc: meeting.description,
    };

    const fullContent = await requestStreamingTurn({
      endpoint: "/api/discussions/expert-turn",
      body,
      signal,
      streamInactiveTimeoutSeconds: llmParams?.streamInactiveTimeoutSeconds ?? 30,
      onChunk,
      errorMsgFallback: "大模型在生成智能体观点时失败。"
    });

    return extractAndCleanJson(fullContent, expert.name, expert.title);
  }
  // 智能相关度下一发言人决策
  async function requestNextSpeakerId(
    userQuestion: string,
    previousTurns: { expertName: string; expertTitle?: string; content: string }[],
    candidateExperts: Expert[],
    history: ChatMessage[],
    signal: AbortSignal
  ): Promise<string> {
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), 6000); // 6秒超时

    try {
      const response = await fetch("/api/discussions/next-speaker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: userQuestion,
          previousTurns,
          candidateExperts,
          engineConfig: activeEngineConfig,
          conversationHistory: history,
          llmParams,
          systemPrompts,
        }),
        signal: timeoutController.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        return candidateExperts[0].id;
      }

      const payload = await response.json();
      return payload.nextSpeakerId || candidateExperts[0].id;
    } catch (e) {
      clearTimeout(timeoutId);
      console.warn("[ModelRouter] 智能指派接口异常或已超时(6s)，自动降级为首个专家顺序指派:", e);
      return candidateExperts[0].id;
    }
  }

  // 主持人决策总结
  async function requestSynthesis(
    meeting: Meeting,
    userQuestion: string,
    expertRounds: { expertName: string; expertTitle?: string; content: string }[],
    contextStr: string,
    history: ChatMessage[],
    signal: AbortSignal,
    onChunk?: (text: string, isExtracting: boolean) => void
  ) {
    const activeEngine = activeEngineConfig;
    const body = {
      question: userQuestion,
      projectContext: contextStr,
      expertRounds,
      moderatorId: meeting.moderatorId || "balanced",
      engineConfig: activeEngine,
      conversationHistory: history,
      llmParams,
      systemPrompts,
      userProfile,
    };

    const fullContent = await requestStreamingTurn({
      endpoint: "/api/discussions/synthesis",
      body,
      signal,
      streamInactiveTimeoutSeconds: llmParams?.streamInactiveTimeoutSeconds ?? 30,
      onChunk,
      errorMsgFallback: "主持人提炼纪要时失败。"
    });

    try {
      const parsedRes = extractAndCleanModeratorJson(fullContent);
      return {
        summary: parsedRes.content,
        consensus: parsedRes.moderatorSummary.consensus,
        disagreements: parsedRes.moderatorSummary.disagreements,
        decisions: parsedRes.moderatorSummary.decisions,
        nextActions: parsedRes.moderatorSummary.nextActions,
      };
    } catch (e) {
      console.error("Failed to parse streaming synthesis JSON", fullContent, e);
    }

    return {
      summary: fullContent,
      consensus: ["已记录在总结中"],
      disagreements: ["参见上述文本"],
      decisions: ["见总结详情"],
      nextActions: ["立即推进相关决策评估"],
    };
  }
  // 调用 AI 判定是否需要追问补充信息
  async function requestInquiryCheck(
    meetingId: string,
    userQuestion: string,
    contextStr: string,
    history: ChatMessage[],
    signal: AbortSignal
  ): Promise<{ result: string }> {
    const response = await fetch("/api/discussions/inquiry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: userQuestion,
        projectContext: contextStr,
        conversationHistory: history,
        engineConfig: activeEngineConfig,
        llmParams,
        systemPrompts,
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(`Inquiry check HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  // 调用 AI 生成决策备选可选项
  async function requestDecisionOptions(
    meetingId: string,
    userQuestion: string,
    contextStr: string,
    history: ChatMessage[],
    synthesisSummary: string,
    signal: AbortSignal
  ): Promise<{ options: string[] }> {
    // 防御性校验：若 llmParams / systemPrompts 还未加载，使用后端默认值
    const safeLlmParams = llmParams ?? undefined;
    const safeSystemPrompts = systemPrompts ?? undefined;

    const response = await fetch("/api/discussions/decision-options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: userQuestion,
        projectContext: contextStr,
        conversationHistory: history,
        synthesisSummary,
        engineConfig: activeEngineConfig,
        llmParams: safeLlmParams,
        systemPrompts: safeSystemPrompts,
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(`Decision options HTTP error! status: ${response.status}`);
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

      if (facilitativeResolverRef.current) {
        facilitativeResolverRef.current.reject(new DOMException("Aborted", "AbortError"));
        facilitativeResolverRef.current = null;
      }
      if (inquiryResolverRef.current) {
        inquiryResolverRef.current.reject(new DOMException("Aborted", "AbortError"));
        inquiryResolverRef.current = null;
      }
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
  // 圆桌讨论主提交入口
  async function handleSubmitDiscussion(
    event?: FormEvent<HTMLFormElement>,
    editParams?: { targetMeetingId: string; userQuestion: string; baseHistory: ChatMessage[]; baseSources: any[]; messageId?: string }
  ) {
    if (event) event.preventDefault();
    
    const targetMeetingId = editParams ? editParams.targetMeetingId : activeMeeting?.id;
    const targetMeeting = meetings.find(m => m.id === targetMeetingId);
    if (!targetMeetingId || !targetMeeting || discussingMeetings[targetMeetingId] || generatingConclusions[targetMeetingId]) return;

    const userQuestion = editParams ? editParams.userQuestion.trim() : question.trim();
    if (!userQuestion) return;

    setDiscussingMeetings(prev => ({ ...prev, [targetMeetingId]: true }));
    if (!activeEngineConfig) {
      alert("⚠️ 当前系统未配置或激活任何大模型引擎，请前往“后台管理 · 模型管理”添加并激活您的大模型配置以启动圆桌讨论！");
      setDiscussingMeetings(prev => ({ ...prev, [targetMeetingId]: false }));
      return;
    }

    if (!editParams) {
      setQuestion("");
      setSources([]);
    }

    // 缓存这轮提问发生前的整场历史对话列表
    let conversationHistory = editParams ? editParams.baseHistory : targetMeeting.messages;
    if (editParams && editParams.messageId) {
      const msgIndex = targetMeeting.messages.findIndex(m => m.id === editParams.messageId);
      if (msgIndex >= 0) {
        // 保留被编辑的消息之前的所有历史消息，丢弃它本身及之后的所有过气气泡
        conversationHistory = targetMeeting.messages.slice(0, msgIndex);
      }
    }

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
    const getSelectedExperts = () => {
      const latestM = meetingsRef.current.find(m => m.id === targetMeetingId) || currentMeeting;
      return allExpertsRef.current.filter(e => latestM.expertIds.includes(e.id));
    };
    const meetingContextStr = `会议名称：${targetMeeting.name}\n会议背景与描述：${targetMeeting.description}`;
    const contextStr = [meetingContextStr, projectContext, buildSourceContext()].filter(Boolean).join("\n\n");

    // 本轮发言缓冲
    const previousTurns: { expertName: string; expertTitle?: string; content: string }[] = [];
    let currentMeeting = nextMeetingState;
    let shouldAutoConclude = false;

    // 统一步骤消息与最新配置项同步存盘，彻底防御回写过期配置导致的状态倒退
    const saveCurrentMeetingState = async (nextMeeting: Meeting) => {
      const latestM = meetingsRef.current.find(m => m.id === targetMeetingId) || nextMeeting;
      const updatedMeeting = {
        ...nextMeeting,
        expertIds: latestM.expertIds,
        moderatorId: latestM.moderatorId,
        turnOrderMode: latestM.turnOrderMode,
        globalDebateIntensity: latestM.globalDebateIntensity,
        moderatorAutonomy: latestM.moderatorAutonomy,
        enableInquiryLoop: latestM.enableInquiryLoop,
      };
      currentMeeting = updatedMeeting;
      setMeetings(prev => prev.map(m => m.id === targetMeetingId ? updatedMeeting : m));
      await storage.saveMeeting(TENANT_ID, updatedMeeting);
      return updatedMeeting;
    };

    try {
      // 如果没有勾选任何参会专家，直接跑主持人总结
      if (getSelectedExperts().length === 0) {
        setSynthesisPendingMeetings(prev => ({ ...prev, [targetMeetingId]: true }));
        
        const modMessageId = `msg-${Date.now()}-mod`;
        const currentModMode = moderatorModes.find(m => m.id === currentMeeting.moderatorId) || moderatorModes[0];
        let modMessage: ChatMessage = {
          id: modMessageId,
          meetingId: targetMeetingId,
          tenantId: TENANT_ID,
          role: "moderator",
          senderName: systemPrompts?.moderatorName || currentModMode.name || "主持人",
          senderTitle: systemPrompts?.moderatorTitle || "决策协调官",
          content: "",
          createdAt: Date.now(),
        };
        
        let nextMsgs = [...currentMeeting.messages, modMessage];
        currentMeeting = { ...currentMeeting, messages: nextMsgs };
        setMeetings(prev => prev.map(m => m.id === targetMeetingId ? currentMeeting : m));

        const synth = await requestSynthesis(
          currentMeeting, 
          userQuestion, 
          [], 
          contextStr, 
          conversationHistory, 
          signal,
          (text, isExtracting) => {
            modMessage = { 
              ...modMessage, 
              content: text,
              isStanceExtracting: isExtracting || false
            };
            setMeetings((prev) =>
              prev.map((m) => {
                if (m.id !== targetMeetingId) return m;
                const updatedMessages = m.messages.map((msg) =>
                  msg.id === modMessageId ? modMessage : msg
                );
                return { ...m, messages: updatedMessages };
              })
            );
          }
        );
        
        // 流式读取完成，大模型开始 done。为了给用户提供提炼 Loading 的平滑过渡视觉，我们先保持 Loading 状态
        modMessage = {
          ...modMessage,
          content: synth.summary,
          isStanceExtracting: true,
        };
        setMeetings((prev) =>
          prev.map((m) => {
            if (m.id !== targetMeetingId) return m;
            const updatedMessages = m.messages.map((msg) =>
              msg.id === modMessageId ? modMessage : msg
            );
            return { ...m, messages: updatedMessages };
          })
        );

        setTimeout(async () => {
          modMessage = {
            ...modMessage,
            moderatorSummary: {
              consensus: synth.consensus || [],
              disagreements: synth.disagreements || [],
              decisions: synth.decisions || [],
              nextActions: synth.nextActions || [],
            },
            isStanceExtracting: false, // 提炼结束，展示卡片
          };

          const finalMessages = currentMeeting.messages.map(msg => msg.id === modMessageId ? modMessage : msg);
          const updatedMeeting = { ...currentMeeting, messages: finalMessages };
          
          setMeetings(prev => prev.map(m => m.id === targetMeetingId ? updatedMeeting : m));
          await saveCurrentMeetingState(updatedMeeting);
          
          setSynthesisPendingMeetings(prev => ({ ...prev, [targetMeetingId]: false }));
          setDiscussingMeetings(prev => ({ ...prev, [targetMeetingId]: false }));
        }, 800);
      }

      // 如果是“手动点名”模式，只生成一个占位消息，提示用户点名，不自动流转队列
      if (currentMeeting.turnOrderMode === "manual") {
        setDiscussingMeetings(prev => ({ ...prev, [targetMeetingId]: false }));
        return;
      }

      // 初始化大循环状态
      let currentRound = 1;
      const maxAutonomousRounds = 3;
      let activeQuestion = userQuestion;
      let activeContext = contextStr;
      const discussionDecisions: string[] = [];

      // 自动排除处于离线状态的外部智能体
      let initialCandidates = getSelectedExperts().filter(e => {
        if (e.isExternalAgent) {
          return botStatuses[e.id] === "online";
        }
        return true;
      });

      let nextRoundCandidates: Expert[] | null = null;

      // ================= 反馈大循环状态机 =================
      meetingLoop: while (true) {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");

        // 每次迭代前同步获取最新的侧边栏各项控制胶囊及专家席位设置，防止在大循环运行时修改无效
        const latestLoopM = meetingsRef.current.find(m => m.id === targetMeetingId) || currentMeeting;
        currentMeeting.expertIds = latestLoopM.expertIds;
        currentMeeting.moderatorId = latestLoopM.moderatorId;
        currentMeeting.turnOrderMode = latestLoopM.turnOrderMode;
        currentMeeting.moderatorAutonomy = latestLoopM.moderatorAutonomy;
        currentMeeting.enableInquiryLoop = latestLoopM.enableInquiryLoop;
        currentMeeting.globalDebateIntensity = latestLoopM.globalDebateIntensity;

        // ================= 前置：信息澄清与追问判断流程 (Step 1 to Step 5) =================
        if (currentMeeting.enableInquiryLoop) {
          let currentInquiryInput = activeQuestion;
          let accumulatedQuestion = activeQuestion;
          inquiryLoop: while (true) {
            if (signal.aborted) throw new DOMException("Aborted", "AbortError");

            // 1. 检查是否需要追问 (调用后端 API)
            setInquiryPendingMeetings(prev => ({ ...prev, [targetMeetingId]: true }));
            
            let inquiryResText = "";
            try {
              const res = await requestInquiryCheck(
                targetMeetingId,
                currentInquiryInput,
                activeContext,
                currentMeeting.messages,
                signal
              );
              inquiryResText = res.result || "";
            } catch (err: any) {
              console.error("信息追问判定失败:", err);
              if (err.name === "AbortError" || signal.aborted) throw err;
              // 失败则直接跳过，推进会议
              break inquiryLoop;
            } finally {
              setInquiryPendingMeetings(prev => ({ ...prev, [targetMeetingId]: false }));
            }

            const inquiryPrompt = extractInquiryPrompt(inquiryResText);
            if (inquiryPrompt && inquiryPrompt !== "NO_INQUIRY") {
              // 展示信息补充面板，并将流程挂起
              setInquiryPromptText(inquiryPrompt);
                setInquiryConsoleMeetingId(targetMeetingId);

                // 挂起 Promise 等待用户在环操作
                const userAction = await new Promise<{ type: "skip" | "submit"; content?: string }>((resolve, reject) => {
                  inquiryResolverRef.current = { resolve, reject };
                });

                setInquiryConsoleMeetingId(null);

                if (userAction.type === "skip") {
                  // 用户选择跳过，讨论正常推进
                  break inquiryLoop;
                } else if (userAction.type === "submit" && userAction.content) {
                  // 用户补充了信息，直接追加到原用户消息气泡尾部
                  const contentText = userAction.content.trim();
                  accumulatedQuestion = `${accumulatedQuestion}\n\n**[补充澄清]**\n**问**：${inquiryPrompt}\n**答**：${contentText}`;

                  // 1. 同步更新前端页面中该用户消息气泡的 React 状态
                  setMeetings((prev) =>
                    prev.map((m) => {
                      if (m.id !== targetMeetingId) return m;
                      const nextMessages = m.messages.map((msg) => {
                        if (msg.id === userMessage.id) {
                          return { ...msg, content: accumulatedQuestion };
                        }
                        return msg;
                      });
                      return { ...m, messages: nextMessages };
                    })
                  );

                  // 2. 更新内存数据并存盘
                  const nextMessages = currentMeeting.messages.map((msg) => {
                    if (msg.id === userMessage.id) {
                      return { ...msg, content: accumulatedQuestion };
                    }
                    return msg;
                  });
                  currentMeeting = { ...currentMeeting, messages: nextMessages };
                  await saveCurrentMeetingState(currentMeeting);

                  // 重新回到 step 1 进行判定 (澄清内容已保存在 accumulatedQuestion 中，避免在上下文中重复拼接)
                  currentInquiryInput = accumulatedQuestion;
                  continue inquiryLoop;
                }
              }
            break inquiryLoop;
          }
          activeQuestion = accumulatedQuestion;
        }

        let remainCandidates = nextRoundCandidates !== null ? nextRoundCandidates : [...initialCandidates];
        nextRoundCandidates = null; // 重置本轮定制候选

        if (remainCandidates.length === 0) {
          break meetingLoop;
        }

        while (remainCandidates.length > 0) {
          if (signal.aborted) throw new DOMException("Aborted", "AbortError");

          // 1. 确定下一个发言人
          let currentExpert: Expert;
          if (currentMeeting.turnOrderMode === "relevance" && remainCandidates.length > 1) {
            setAssigningNextSpeaker(prev => ({ ...prev, [targetMeetingId]: true }));
            const nextId = await requestNextSpeakerId(activeQuestion, previousTurns, remainCandidates, conversationHistory, signal);
            setAssigningNextSpeaker(prev => ({ ...prev, [targetMeetingId]: false }));
            currentExpert = remainCandidates.find(e => e.id === nextId) || remainCandidates[0];
          } else {
            currentExpert = remainCandidates[0];
          }

          remainCandidates = remainCandidates.filter(e => e.id !== currentExpert.id);
          setSpeakingExpertIds(prev => ({ ...prev, [targetMeetingId]: currentExpert.id }));

          // 2. 先创建一条空的专家发言
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
            let guidedQuestion = activeQuestion;
            if (discussionDecisions.length > 0) {
              guidedQuestion = `【此前评审已达成的决议与共识】：\n${discussionDecisions.map((d, i) => `${i + 1}. ${d}`).join("\n")}\n\n【本轮针对性研讨议题】：${activeQuestion}`;
            }

            const turnResult = await requestExpertTurn(
              currentMeeting,
              currentExpert,
              previousTurns,
              guidedQuestion,
              activeContext,
              conversationHistory,
              signal,
              (text, isExtracting) => {
                expertMessage = { 
                  ...expertMessage, 
                  content: text,
                  isStanceExtracting: isExtracting || false
                };
                setMeetings((prev) =>
                  prev.map((m) => {
                    if (m.id !== targetMeetingId) return m;
                    const updatedMessages = m.messages.map((msg) =>
                      msg.id === expertMessageId ? expertMessage : msg
                    );
                    return { ...m, messages: updatedMessages };
                  })
                );
              }
            );
            
            finalTurnContent = turnResult.content;
            finalExpertStance = turnResult.expertStance;
          } catch (error: any) {
            console.error(`专家 [${currentExpert.name}] 发言异常:`, error);
            if (error.name === "AbortError" || signal.aborted) throw error;
            const errMsg = (error.message || "").toLowerCase();
            const isTimeout = errMsg.includes("超时") || errMsg.includes("timeout") || errMsg.includes("limit");
            finalTurnContent = isTimeout ? "__TIMEOUT__" : "__ERROR__";
            finalExpertStance = undefined;
          }

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
          await saveCurrentMeetingState(currentMeeting);

          const previousTurnContent = (finalTurnContent === "__TIMEOUT__" || finalTurnContent === "__ERROR__")
            ? `[该专家发言由于${finalTurnContent === "__TIMEOUT__" ? "响应超时" : "网关连接异常"}被系统跳过]`
            : finalTurnContent;

          previousTurns.push({
            expertName: currentExpert.name,
            expertTitle: currentExpert.title,
            content: previousTurnContent,
          });
        }

        // 3. 调用主持人综合总结
        setSpeakingExpertIds(prev => ({ ...prev, [targetMeetingId]: null }));
        setSynthesisPendingMeetings(prev => ({ ...prev, [targetMeetingId]: true }));

        const modMessageId = `msg-${Date.now()}-mod`;
        const currentModMode = moderatorModes.find(m => m.id === currentMeeting.moderatorId) || moderatorModes[0];
        let modMessage: ChatMessage = {
          id: modMessageId,
          meetingId: currentMeeting.id,
          tenantId: TENANT_ID,
          role: "moderator",
          senderName: systemPrompts?.moderatorName || currentModMode.name || "主持人",
          senderTitle: systemPrompts?.moderatorTitle || "决策协调官",
          content: "",
          createdAt: Date.now(),
        };

        let nextMsgs = [...currentMeeting.messages, modMessage];
        currentMeeting = { ...currentMeeting, messages: nextMsgs };
        setMeetings(prev => prev.map(m => m.id === targetMeetingId ? currentMeeting : m));

        const synth = await requestSynthesis(
          currentMeeting,
          activeQuestion,
          previousTurns,
          activeContext,
          conversationHistory,
          signal,
          (text, isExtracting) => {
            modMessage = { 
              ...modMessage, 
              content: text,
              isStanceExtracting: isExtracting || false
            };
            setMeetings((prev) =>
              prev.map((m) => {
                if (m.id !== targetMeetingId) return m;
                const updatedMessages = m.messages.map((msg) =>
                  msg.id === modMessageId ? modMessage : msg
                );
                return { ...m, messages: updatedMessages };
              })
            );
          }
        );

        // 流式读取完成，大模型开始 done。为了给用户提供提炼 Loading 的平滑过渡视觉，我们先保持 Loading 状态
        modMessage = {
          ...modMessage,
          content: synth.summary,
          isStanceExtracting: true,
        };
        setMeetings((prev) =>
          prev.map((m) => {
            if (m.id !== targetMeetingId) return m;
            const updatedMessages = m.messages.map((msg) =>
              msg.id === modMessageId ? modMessage : msg
            );
            return { ...m, messages: updatedMessages };
          })
        );

        setTimeout(async () => {
          modMessage = {
            ...modMessage,
            moderatorSummary: {
              consensus: synth.consensus || [],
              disagreements: synth.disagreements || [],
              decisions: synth.decisions || [],
              nextActions: synth.nextActions || [],
            },
            isStanceExtracting: false, // 提炼结束，展示卡片
          };

          if (synth.decisions && Array.isArray(synth.decisions)) {
            synth.decisions.forEach((d) => {
              if (d && !discussionDecisions.includes(d)) {
                discussionDecisions.push(d);
              }
            });
          }

          let finalMessages = currentMeeting.messages.map(msg => 
            msg.id === modMessageId ? modMessage : msg
          );
          const updatedMeeting = { ...currentMeeting, messages: finalMessages };
          
          setMeetings(prev => prev.map(m => m.id === targetMeetingId ? updatedMeeting : m));
          await saveCurrentMeetingState(updatedMeeting);

          setSynthesisPendingMeetings(prev => ({ ...prev, [targetMeetingId]: false }));
        }, 800);
        // 同步最新的配置属性
        const latestPostM = meetingsRef.current.find(m => m.id === targetMeetingId) || currentMeeting;
        currentMeeting.moderatorAutonomy = latestPostM.moderatorAutonomy;
        currentMeeting.enableInquiryLoop = latestPostM.enableInquiryLoop;

        const autonomy = currentMeeting.moderatorAutonomy || "passive";

        // 连锁限制：当为自主决策模式时，强制关闭信息追问环
        if (autonomy === "autonomous") {
          currentMeeting.enableInquiryLoop = false;
        }

        // 前置轮次上限研判
        const maxAutoRounds = llmParams?.maxAutonomousRounds ?? 3;
        if (autonomy === "autonomous" && currentRound >= maxAutoRounds) {
          const endMsg: ChatMessage = {
            id: `msg-auto-end-${Date.now()}`,
            meetingId: targetMeetingId,
            tenantId: TENANT_ID,
            role: "moderator",
            senderName: "系统提示",
            content: `💡 会议已达到自主决策的最大迭代轮次上限 (${maxAutoRounds}轮)，讨论已自动收敛结束。`,
            createdAt: Date.now(),
          };
          await saveCurrentMeetingState({ ...currentMeeting, messages: [...currentMeeting.messages, endMsg] });

          shouldAutoConclude = false; // 自主模式超限不自动提炼结论！
          break meetingLoop;
        }

        if (autonomy === "passive") {
          // 被动传统模式，直接退出，会议结案并由用户手动决定提炼结论
          break meetingLoop;
        }

        // 1. 调用后端接口为本次讨论生成方向性备选决策选项
        setGeneratingDecisionOptions(prev => ({ ...prev, [targetMeetingId]: true }));
        let generatedOptions: string[] = [];
        try {
          const optRes = await requestDecisionOptions(
            targetMeetingId,
            activeQuestion,
            activeContext,
            currentMeeting.messages,
            modMessage.content || "",
            signal
          );
          generatedOptions = optRes.options || [];
        } catch (e: any) {
          console.error("生成决策意见选项失败:", e);
          generatedOptions = [
            "方向一：维持现状，进一步观测和评估指标细节",
            "方向二：折中改进，在局部实施优化以规避最严重风险",
            "方向三：全面重构，按专家的最高标准建议执行"
          ];
        } finally {
          setGeneratingDecisionOptions(prev => ({ ...prev, [targetMeetingId]: false }));
        }

        // 保存到状态中供 UI 渲染
        setMeetingDecisionOptions(prev => ({ ...prev, [targetMeetingId]: generatedOptions }));
        // 默认预选第一项（推荐选项），方便用户快速决策 & 自主模式展示主持人的选择
        if (generatedOptions.length > 0) {
          setSelectedDecisionOption(generatedOptions[0]);
        }

        // 2. 分模式挂起或自动推进
        // 2. 分模式挂起并等待抉择（促进与自主均展示面板以提供倒计时 and 鼠标移入干预）
        if (autonomy === "facilitative" || autonomy === "autonomous") {
          setSteeringConsoleMeetingId(targetMeetingId);
          setSteeringPendingMeetings(prev => ({ ...prev, [targetMeetingId]: true }));
          // scrollIntoView 由 useEffect 中的监听器负责（更可靠）

          try {
            const action = await new Promise<{
              type: "choose" | "finish";
              opinion?: string;
              isAuto?: boolean;
            }>((resolve, reject) => {
              facilitativeResolverRef.current = { resolve, reject };
            });

            setSteeringConsoleMeetingId(null);
            setSteeringPendingMeetings(prev => ({ ...prev, [targetMeetingId]: false }));

            if (action.type === "finish") {
              shouldAutoConclude = true; // 仅在人类明确结案陈词时才自动提炼结论并归档！
              break meetingLoop;
            }

            if (action.type === "choose" && action.opinion) {
              const selectedOpinion = action.opinion.trim();

              const isAuto = !!action.isAuto;
              const currentModMode = moderatorModes.find(m => m.id === currentMeeting.moderatorId) || moderatorModes[0];
              const decisionChoiceMsg: ChatMessage = {
                id: `msg-${Date.now()}-decision-choice`,
                meetingId: targetMeetingId,
                tenantId: TENANT_ID,
                role: "user",
                senderName: isAuto ? (systemPrompts?.moderatorName || currentModMode.name || "主持人") : userProfile.name,
                senderTitle: isAuto ? (systemPrompts?.moderatorTitle || "决策协调官") : `${userProfile.title}(决议选择)`,
                content: isAuto
                  ? `💡 【主持人自主选定了下一步论证方向】：\n> **${selectedOpinion}**`
                  : `【已决定下一步的论证方向】：\n${selectedOpinion}`,
                createdAt: Date.now(),
              };

              await saveCurrentMeetingState({ ...currentMeeting, messages: [...currentMeeting.messages, decisionChoiceMsg] });

              // 开启新一轮论证
              activeQuestion = selectedOpinion;
              currentRound++;
              previousTurns.length = 0;
              nextRoundCandidates = getSelectedExperts().filter(e => {
                if (e.isExternalAgent) return botStatuses[e.id] === "online";
                return true;
              });

              continue meetingLoop;
            }
          } catch (err) {
            setSteeringConsoleMeetingId(null);
            setSteeringPendingMeetings(prev => ({ ...prev, [targetMeetingId]: false }));
            throw err;
          }
        }
      }

      // 讨论正常收敛结束，自动触发结论生成提炼 (如果 shouldAutoConclude 为 true)
      if (shouldAutoConclude) {
        setTimeout(() => {
          void handleGenerateConclusion(currentMeeting);
        }, 100);
      }

    } catch (e: any) {
      const isAbort = e.name === "AbortError" || signal.aborted || e.message?.toLowerCase().includes("abort");
      if (isAbort) {
        // 叫停处理
        setInquiryConsoleMeetingId(null);
        setInquiryPendingMeetings(prev => ({ ...prev, [targetMeetingId]: false }));
        
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
      setAssigningNextSpeaker(prev => ({ ...prev, [targetMeetingId]: false }));
      delete discussAbortControllersRef.current[targetMeetingId];
    }
  }

  // 主持人点名手动触发特定专家发言
  async function handleCallExpertDirectly(expert: Expert) {
    if (!activeMeeting || discussingMeetings[activeMeetingId] || generatingConclusions[activeMeetingId]) return;
    
    if (!activeEngineConfig) {
      alert("⚠️ 当前系统未配置或激活任何大模型引擎，请前往“后台管理 · 模型管理”添加并激活您的大模型配置以手动点名发言！");
      return;
    }

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
        (text, isExtracting) => {
          expertMessage = { 
            ...expertMessage, 
            content: text,
            isStanceExtracting: isExtracting || false
          };
          setMeetings((prev) =>
            prev.map((m) => {
              if (m.id !== targetMeetingId) return m;
              const updatedMessages = m.messages.map((msg) =>
                msg.id === expertMessageId ? expertMessage : msg
              );
              return { ...m, messages: updatedMessages };
            })
          );
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
  async function handleGenerateConclusion(customMeeting?: Meeting) {
    // 强防 React onClick 鼠标事件误传入，提供自动回退
    const hasMessages = customMeeting && Array.isArray(customMeeting.messages);
    const targetMeeting = hasMessages ? customMeeting : activeMeeting;
    
    if (!targetMeeting || !Array.isArray(targetMeeting.messages) || targetMeeting.messages.length === 0 || generatingConclusions[targetMeeting.id]) return;
    
    const targetMeetingId = targetMeeting.id;
    if (!activeEngineConfig) {
      alert("⚠️ 当前系统未配置或激活任何大模型引擎，请前往“后台管理 · 模型管理”添加并激活您的大模型配置以提炼最终结论！");
      setGeneratingConclusions(prev => ({ ...prev, [targetMeetingId]: false }));
      return;
    }
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
          projectContext: `会议名称：${targetMeeting.name}\n会议背景与描述：${targetMeeting.description}`,
          conversationHistory: targetMeeting.messages,
          engineConfig: activeConfig,
          llmParams,
          systemPrompts,
        }),
        signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      
      const nextMeeting = { ...targetMeeting, finalConclusion: data.conclusion };
      setMeetings(prev => prev.map(m => m.id === targetMeetingId ? nextMeeting : m));
      await storage.saveMeeting(TENANT_ID, nextMeeting);
      
      setUnlockedComposers(prev => ({ ...prev, [targetMeetingId]: false }));
      
      setTimeout(() => {
        scrollToConclusion("smooth");
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
              {activeEngineConfig?.name || "未配置大模型"}
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
                title={!activeMeetingId ? "请先选择或创建会议" : (isControlsDisabled ? "发言进行中，无法新建智能体" : "新建会议专属智能体")}
                disabled={!activeMeetingId || isControlsDisabled}
                style={{ opacity: (!activeMeetingId || isControlsDisabled) ? 0.5 : 1, cursor: (!activeMeetingId || isControlsDisabled) ? "not-allowed" : "pointer" }}
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
                      className={`role-card ${isSelected ? "is-selected" : ""} ${isSpeaking ? "is-speaking" : ""} ${expert.isExternalAgent ? "is-external-agent" : ""} ${isControlsDisabled ? "is-disabled" : ""}`}
                      style={{ opacity: isControlsDisabled ? 0.6 : 1, transition: "opacity 0.2s" }}
                    >
                      <div className="role-toggle">
                        <div 
                          className="role-topline" 
                          style={{ cursor: isControlsDisabled ? "not-allowed" : "pointer" }}
                          onClick={() => {
                            if (isControlsDisabled) return;
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
                              disabled={isControlsDisabled}
                              style={{ cursor: isControlsDisabled ? "not-allowed" : "auto" }}
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
                          {!expert.isExternalAgent && expert.modelMode === "custom" && expert.modelId && (() => {
                            const matched = engineConfigs.find(c => c.id === expert.modelId);
                            const modelName = matched ? matched.name : "未知模型 (已删除)";
                            return (
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "6px", fontSize: "11px" }}>
                                <span style={{ color: "var(--muted)" }}>模型引擎</span>
                                <span style={{ 
                                  fontWeight: 500, 
                                  color: "var(--amber)",
                                  background: "rgba(245, 158, 11, 0.05)",
                                  padding: "2px 6px",
                                  borderRadius: "4px",
                                  border: "1px solid var(--amber-soft)",
                                  fontSize: "10px",
                                  lineHeight: 1
                                }}>
                                  {modelName}
                                </span>
                              </div>
                            );
                          })()}
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
                            onClick={() => !isControlsDisabled && openEditCustomModal(expert)}
                            disabled={isControlsDisabled}
                            style={{ 
                              color: isControlsDisabled ? "var(--muted)" : "var(--amber)", 
                              cursor: isControlsDisabled ? "not-allowed" : "pointer",
                              opacity: isControlsDisabled ? 0.5 : 1
                            }}
                          >
                            编辑
                          </button>
                          <button
                            className="text-button"
                            type="button"
                            onClick={() => !isControlsDisabled && setDeleteCandidate(expert)}
                            disabled={isControlsDisabled}
                            style={{ 
                              color: isControlsDisabled ? "var(--muted)" : "inherit", 
                              cursor: isControlsDisabled ? "not-allowed" : "pointer",
                              opacity: isControlsDisabled ? 0.5 : 1
                            }}
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
              <strong>⚠️ 尚未配置任何大模型引擎</strong>：请前往“后台管理 · 模型管理”添加并激活您的 API 大模型引擎配置，否则圆桌会议将无法正常发起对话。
            </div>
          )}

          <section className="chat-thread" ref={chatThreadRef} onScroll={handleThreadScroll}>
            {activeMeeting && activeMeeting.messages.length > 0 ? (
              activeMeeting.messages.map((message) => {
                const isUser = message.role === "user";
                const isMod = message.role === "moderator";
                const isExp = message.role === "expert";

                return (
                  <ChatMessageCard
                    key={message.id}
                    message={message}
                    isUser={isUser}
                    isMod={isMod}
                    isExp={isExp}
                    activeMeetingId={activeMeetingId}
                    isSessionActive={isSessionActive}
                    userProfile={userProfile}
                    systemPrompts={systemPrompts}
                    allExperts={allExperts}
                    speakingExpertId={speakingExpertIds[activeMeetingId] || null}
                    isSynthesisPending={!!synthesisPendingMeetings[activeMeetingId]}
                    editingMessageId={editingMessageId}
                    editingContent={editingContent}
                    setEditingMessageId={setEditingMessageId}
                    setEditingContent={setEditingContent}
                    handleSubmitDiscussion={handleSubmitDiscussion}
                  />
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



            {discussingMeetings[activeMeetingId] && assigningNextSpeaker[activeMeetingId] && (
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


            {discussingMeetings[activeMeetingId] && inquiryPendingMeetings[activeMeetingId] && (
              <article className="chat-message moderator">
                <div className="message-avatar">主持</div>
                <div className="message-body">
                  <div className="thinking-card" style={{ borderStyle: "solid", borderColor: "var(--amber)", borderRadius: "8px" }}>
                    <div className="thinking-loader">
                      <strong style={{ color: "var(--amber)" }}>主持人</strong> 正在研判信息是否足够
                      <div className="dot-pulse">
                        <span />
                        <span />
                        <span />
                      </div>
                    </div>
                    <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                      正在评估输入信息是否充分，分析是否需要请求追问补充...
                    </span>
                  </div>
                </div>
              </article>
            )}

            {discussingMeetings[activeMeetingId] && generatingDecisionOptions[activeMeetingId] && (
              <article className="chat-message moderator">
                <div className="message-avatar">主持</div>
                <div className="message-body">
                  <div className="thinking-card" style={{ borderStyle: "solid", borderColor: "var(--amber)", borderRadius: "8px" }}>
                    <div className="thinking-loader">
                      <strong style={{ color: "var(--amber)" }}>主持人</strong> 正在提炼下一步备选方向
                      <div className="dot-pulse">
                        <span />
                        <span />
                        <span />
                      </div>
                    </div>
                    <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                      正在归纳总结当前讨论焦点，为协调进一步讨论提供方向建议...
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

            {/* 人类引导决策控制台 (Human Steering Console) */}
            {activeMeeting && steeringConsoleMeetingId === activeMeeting.id && (
              <div
                id="steering-panel"
                className="steering-console-card"
                onMouseEnter={handleCancelSteeringCountdown}
                style={{
                  margin: "20px 18px",
                  padding: "24px",
                  borderRadius: "16px",
                  border: "1px dashed var(--amber)",
                  background: "rgba(251, 191, 36, 0.05)",
                  backdropFilter: "blur(20px)",
                  boxShadow: "0 8px 32px rgba(25, 23, 20, 0.04)",
                  scrollMarginTop: "24px"
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                  <span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "50%", background: "var(--amber)", boxShadow: "0 0 10px var(--amber)" }} />
                  <h4 style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "var(--ink)" }}>
                    决策协调看板：请选择或输入下一步决议方向
                  </h4>
                </div>

                {generatingDecisionOptions[activeMeeting.id] ? (
                  <div style={{ padding: "20px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
                    <div className="dot-pulse" style={{ display: "inline-flex" }}>
                      <span /><span /><span />
                    </div>
                    <span style={{ fontSize: "13px", color: "var(--muted)", fontWeight: 500 }}>
                      AI 主持人正在深度分析专家意见，归纳提炼方向性决议选项...
                    </span>
                  </div>
                ) : (
                  <>
                    {activeMeeting.moderatorAutonomy === "autonomous" ? (
                      steeringCountdown !== null ? (
                        <div style={{
                          padding: "10px 14px",
                          borderRadius: "8px",
                          background: "rgba(245, 158, 11, 0.08)",
                          border: "1px solid rgba(245, 158, 11, 0.2)",
                          color: "#d97706",
                          fontSize: "12.5px",
                          fontWeight: 500,
                          lineHeight: "1.6",
                          marginBottom: "16px",
                          display: "flex",
                          alignItems: "center",
                          gap: "8px"
                        }}>
                          <span style={{ fontSize: "14px" }}>⏱️</span>
                          <span>
                            自主决策推进中：AI 主持人将在 <strong>{steeringCountdown} 秒</strong> 后自动选择首选方案并流转。
                            <span style={{ textDecoration: "underline", marginLeft: "6px", cursor: "default" }}>
                              将鼠标移入此区域可立即叫停倒计时并进行人工干预
                            </span>
                          </span>
                        </div>
                      ) : (
                        <div style={{
                          padding: "10px 14px",
                          borderRadius: "8px",
                          background: "rgba(16, 185, 129, 0.08)",
                          border: "1px solid rgba(16, 185, 129, 0.2)",
                          color: "#059669",
                          fontSize: "12.5px",
                          fontWeight: 500,
                          lineHeight: "1.6",
                          marginBottom: "16px",
                          display: "flex",
                          alignItems: "center",
                          gap: "8px"
                        }}>
                          <span style={{ fontSize: "14px" }}>💡</span>
                          <span>自动决策倒计时已被人类打断。会议流转已挂起，请人类决策者手动选择意见卡片或在下方输入指令进行引导。</span>
                        </div>
                      )
                    ) : (
                      <p style={{ fontSize: "12.5px", color: "var(--muted)", marginBottom: "16px", lineHeight: "1.6" }}>
                        本轮专家评审与总结已提炼完成。AI 主持人根据刚才的讨论，为您归纳了以下方向性的备选决策方案。请您做最终的裁决：
                      </p>
                    )}

                    {/* 方向性决策选项单选卡片列表 */}
                    {(() => {
                      const isCustomInputActive = steeringInput.trim().length > 0;
                      return (
                        <>
                          <div style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "10px",
                            marginBottom: "20px",
                            opacity: isCustomInputActive ? 0.4 : 1,
                            pointerEvents: isCustomInputActive ? "none" : "auto",
                            transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
                          }}>
                            {(meetingDecisionOptions[activeMeeting.id] || []).map((option, idx) => {
                              const isSelected = selectedDecisionOption === option;
                              return (
                                <div
                                  key={idx}
                                  onClick={() => {
                                    setSelectedDecisionOption(isSelected ? "" : option);
                                  }}
                                  style={{
                                    padding: "14px 18px",
                                    borderRadius: "10px",
                                    border: `1.5px solid ${isSelected ? "var(--amber)" : "var(--line)"}`,
                                    background: isSelected ? "var(--amber-soft)" : "rgba(255, 255, 255, 0.4)",
                                    boxShadow: isSelected ? "0 4px 16px rgba(180, 110, 10, 0.08)" : "none",
                                    color: isSelected ? "#854d0e" : "var(--ink)",
                                    fontSize: "13.5px",
                                    fontWeight: isSelected ? 600 : 500,
                                    lineHeight: "1.5",
                                    cursor: "pointer",
                                    transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)"
                                  }}
                                >
                                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                    <span style={{
                                      width: "16px",
                                      height: "16px",
                                      borderRadius: "50%",
                                      border: "1px solid var(--muted-light)",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      background: "var(--surface)",
                                      flexShrink: 0
                                    }}>
                                      {isSelected && <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--amber)" }} />}
                                    </span>
                                    <span>{option}</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {selectedDecisionOption && !isCustomInputActive && (
                            <div style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              padding: "8px 12px",
                              borderRadius: "8px",
                              background: "var(--amber-soft)",
                              border: "1px dashed rgba(245, 158, 11, 0.3)",
                              marginBottom: "10px",
                              fontSize: "12px",
                              color: "#854d0e",
                              animation: "fadeIn 0.2s ease-out"
                            }}>
                              <span>💡 想要在此方向上微调？</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setSteeringInput(selectedDecisionOption);
                                  setSelectedDecisionOption("");
                                  textareaRef.current?.focus();
                                }}
                                style={{
                                  padding: "3px 8px",
                                  borderRadius: "4px",
                                  background: "var(--amber)",
                                  color: "#fff",
                                  border: "none",
                                  fontSize: "11px",
                                  fontWeight: 600,
                                  cursor: "pointer",
                                  transition: "background 0.2s"
                                }}
                              >
                                ✍️ 导入下方编辑
                              </button>
                            </div>
                          )}

                          <div className="compact-field" style={{ marginBottom: "16px" }}>
                            <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: "8px" }}>
                              ✍️ 补充额外决策指令或修正说明：
                            </span>
                            <textarea
                              ref={textareaRef}
                              placeholder="在此手写您希望专家下一轮论证的补充背景、方案修改、或新决策意见..."
                              value={steeringInput}
                              onChange={e => {
                                setSteeringInput(e.target.value);
                                if (e.target.value.trim().length > 0) {
                                  setSelectedDecisionOption("");
                                }
                              }}
                              style={{
                                width: "100%",
                                minHeight: "80px",
                                padding: "12px",
                                borderRadius: "10px",
                                border: "1px solid var(--line-strong)",
                                background: "var(--surface)",
                                fontSize: "13px",
                                lineHeight: "1.5",
                                outline: "none"
                              }}
                            />
                          </div>

                          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                            <button
                              type="button"
                              className="ghost-button"
                              onClick={() => {
                                if (window.confirm("确定要取消并终止本轮讨论吗？这将结束当前的专家圆桌会议，已有的讨论观点将被保留。")) {
                                  handleAbort();
                                  setSteeringInput("");
                                  setSelectedDecisionOption("");
                                }
                              }}
                              style={{
                                fontSize: "12.5px",
                                padding: "8px 16px",
                                borderColor: "var(--red)",
                                color: "var(--red)",
                                background: "rgba(239, 68, 68, 0.05)"
                              }}
                            >
                              ❌ 取消并终止讨论
                            </button>
                            <button
                              type="button"
                              className="ghost-button"
                              onClick={() => {
                                facilitativeResolverRef.current?.resolve({ type: "finish" });
                                setSteeringInput("");
                                setSelectedDecisionOption("");
                              }}
                              style={{ fontSize: "12.5px", padding: "8px 16px" }}
                            >
                              🏁 达成共识，结案陈词
                            </button>
                            <button
                              type="button"
                              className="primary-button"
                              disabled={!selectedDecisionOption && !steeringInput.trim()}
                              onClick={() => {
                                const finalOpinion = steeringInput.trim() || selectedDecisionOption;
                                facilitativeResolverRef.current?.resolve({
                                  type: "choose",
                                  opinion: finalOpinion
                                });
                                setSteeringInput("");
                                setSelectedDecisionOption("");
                              }}
                              style={{
                                fontSize: "12.5px",
                                padding: "8px 20px",
                                background: "var(--amber)",
                                borderColor: "var(--amber)"
                              }}
                            >
                              🚀 提交并进入下一轮讨论
                            </button>
                          </div>
                        </>
                      );
                    })()}
                  </>
                )}
              </div>
            )}

            {/* 信息索取追问控制台 (Inquiry Console) */}
            {activeMeeting && inquiryConsoleMeetingId === activeMeeting.id && (
              <div className="steering-console-card" style={{
                margin: "20px 18px",
                padding: "24px",
                borderRadius: "16px",
                border: "1px dashed var(--amber)",
                background: "rgba(251, 191, 36, 0.05)",
                backdropFilter: "blur(20px)",
                boxShadow: "0 8px 32px rgba(25, 23, 20, 0.04)"
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                  <span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "50%", background: "var(--amber)", boxShadow: "0 0 10px var(--amber)" }} />
                  <h4 style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "var(--ink)" }}>
                    信息澄清控制台：启动前置信息补充校验
                  </h4>
                </div>
                <p style={{ fontSize: "12.5px", color: "var(--muted)", marginBottom: "12px", lineHeight: "1.6" }}>
                  主持人对您刚刚输入的信息进行了智能判定，为了便于各位参会专家做出精准、切合客观场景的方案评估，请您补充或校准以下关键背景数据：
                </p>
                <div style={{
                  padding: "12px 16px",
                  borderRadius: "10px",
                  background: "var(--surface-strong)",
                  border: "1px solid var(--line-strong)",
                  fontSize: "13.5px",
                  color: "var(--ink-soft)",
                  lineHeight: "1.6",
                  marginBottom: "16px"
                }}>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <span style={{ flexShrink: 0 }}>💡 <strong>问询问题：</strong></span>
                    <div style={{ flex: 1, minWidth: 0 }} className="markdown-body">
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}>
                        {inquiryPromptText}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>

                <textarea
                  placeholder="在此输入需要补充的数据事实、架构参数、或环境限制说明..."
                  value={inquiryInput}
                  onChange={e => setInquiryInput(e.target.value)}
                  style={{
                    width: "100%",
                    minHeight: "80px",
                    padding: "12px",
                    borderRadius: "10px",
                    border: "1px solid var(--line-strong)",
                    background: "var(--surface)",
                    fontSize: "13px",
                    lineHeight: "1.5",
                    marginBottom: "16px",
                    outline: "none"
                  }}
                />

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      inquiryResolverRef.current?.resolve({ type: "skip" });
                      setInquiryInput("");
                    }}
                    style={{ fontSize: "12.5px", padding: "8px 16px" }}
                  >
                    跳过追问，正常推进
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={!inquiryInput.trim()}
                    onClick={() => {
                      inquiryResolverRef.current?.resolve({ type: "submit", content: inquiryInput.trim() });
                      setInquiryInput("");
                    }}
                    style={{
                      fontSize: "12.5px",
                      padding: "8px 20px",
                      background: "var(--amber)",
                      borderColor: "var(--amber)"
                    }}
                  >
                    提交数据并继续判定
                  </button>
                </div>
              </div>
            )}

            {/* 最终结论展示/编辑面板 (讨论解锁及提炼生成时不展示) */}
            {activeMeeting?.finalConclusion && !unlockedComposers[activeMeetingId] && !generatingConclusions[activeMeetingId] && (() => {
              const { displayContent } = parseThinkingContent(activeMeeting?.finalConclusion || "");

              return (
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
                    <div style={{ display: "flex", alignItems: "center", gap: "16px", flex: 1 }}>
                      <h3 style={{ margin: 0, color: "#684c08", display: "flex", alignItems: "center", gap: "8px", fontSize: "16px" }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
                        会议最终结论
                      </h3>
                    </div>
                    
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button className="ghost-button export-hidden" onClick={() => { 
                        const { displayContent: editContent } = parseThinkingContent(activeMeeting?.finalConclusion || "");
                        setConclusionDraft(editContent); 
                        setIsEditingConclusion(true); 
                      }} style={{ fontSize: "12px", padding: "4px 12px", height: "auto", minHeight: "28px", display: "flex", alignItems: "center", gap: "6px" }}>
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
                        {displayContent}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              );
            })()}

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
                    <div style={{ display: "flex", gap: "6px", padding: "4px 8px", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "8px", alignItems: "center", flexWrap: "wrap" }}>
                      {/* 主持 + 风格/机制/模式 三联下拉 */}
                      <span style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 600 }}>主持</span>
                      <select
                        className="toolbar-select select-moderator"
                        value={activeMeeting.moderatorId}
                        onChange={(e) => void updateActiveMeeting({ moderatorId: e.target.value })}
                        disabled={isControlsDisabled}
                        title="主持风格"
                        style={{ cursor: isControlsDisabled ? "not-allowed" : "pointer", opacity: isControlsDisabled ? 0.5 : 1 }}
                      >
                        {moderatorModes.map(m => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </select>
                      <select 
                        className="toolbar-select select-moderator"
                        value={activeMeeting.turnOrderMode}
                        onChange={(e) => void updateActiveMeeting({ turnOrderMode: e.target.value as any })}
                        disabled={isControlsDisabled}
                        title="发言机制"
                        style={{ cursor: isControlsDisabled ? "not-allowed" : "pointer", opacity: isControlsDisabled ? 0.5 : 1 }}
                      >
                        <option value="sequential">顺序发言</option>
                        <option value="relevance">动态指派</option>
                        <option value="manual">点名发言</option>
                      </select>
                      <select 
                        className="toolbar-select select-moderator"
                        value={activeMeeting.moderatorAutonomy || "facilitative"}
                        onChange={(e) => {
                          const nextAutonomy = e.target.value as any;
                          const updates: Partial<Meeting> = { moderatorAutonomy: nextAutonomy };
                          if (nextAutonomy === "autonomous") {
                            updates.enableInquiryLoop = false;
                          }
                          void updateActiveMeeting(updates);
                        }}
                        disabled={isControlsDisabled}
                        title="主持模式"
                        style={{ cursor: isControlsDisabled ? "not-allowed" : "pointer", opacity: isControlsDisabled ? 0.5 : 1 }}
                      >
                        <option value="passive">被动传统</option>
                        <option value="facilitative">协调引导</option>
                        <option value="autonomous">自主决策</option>
                      </select>

                      <div style={{ width: "1px", height: "12px", background: "var(--line)" }} />

                      {/* 追问 */}
                      <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                        <span style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 600 }}>追问</span>
                        <select 
                          className="toolbar-select select-inquiry"
                          value={activeMeeting.moderatorAutonomy === "autonomous" ? "false" : (activeMeeting.enableInquiryLoop ? "true" : "false")}
                          onChange={(e) => void updateActiveMeeting({ enableInquiryLoop: e.target.value === "true" })}
                          disabled={activeMeeting.moderatorAutonomy === "autonomous" || isControlsDisabled}
                          title="信息追问开关"
                          style={{ cursor: (activeMeeting.moderatorAutonomy === "autonomous" || isControlsDisabled) ? "not-allowed" : "pointer", opacity: (activeMeeting.moderatorAutonomy === "autonomous" || isControlsDisabled) ? 0.5 : 1 }}
                        >
                          <option value="true">开启</option>
                          <option value="false">关闭</option>
                        </select>
                      </div>

                      <div style={{ width: "1px", height: "12px", background: "var(--line)" }} />

                      {/* 火力 */}
                      <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                        <span style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 600 }}>火力</span>
                        <select
                          className="toolbar-select select-intensity"
                          value={activeMeeting.globalDebateIntensity}
                          onChange={(e) => void updateActiveMeeting({ globalDebateIntensity: Number(e.target.value) })}
                          disabled={isControlsDisabled}
                          title="对抗强度"
                          style={{ cursor: isControlsDisabled ? "not-allowed" : "pointer", opacity: isControlsDisabled ? 0.5 : 1 }}
                        >
                          <option value="1">1</option>
                          <option value="2">2</option>
                          <option value="3">3</option>
                          <option value="4">4</option>
                          <option value="5">5</option>
                        </select>
                      </div>

                      <div style={{ width: "1px", height: "12px", background: "var(--line)" }} />

                      {/* 引擎 */}
                      <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                        <span style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 600 }}>引擎</span>
                        <select 
                          className="toolbar-select select-engine" 
                          value={activeEngineId} 
                          onChange={(e) => void handleSelectEngine(e.target.value)}
                          disabled={isControlsDisabled}
                          title="选择模型引擎"
                          style={{ cursor: isControlsDisabled ? "not-allowed" : "pointer", opacity: isControlsDisabled ? 0.5 : 1 }}
                        >
                          {engineConfigs.length === 0 && (
                            <option value="">未配置大模型</option>
                          )}
                          {engineConfigs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </div>

                      {/* 提炼结论按钮 */}
                      {activeMeeting && activeMeeting.messages.length > 2 && (!activeMeeting.finalConclusion || unlockedComposers[activeMeetingId]) && (
                        <>
                          <div style={{ width: "1px", height: "12px", background: "var(--line)", marginLeft: "auto" }} />
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => void handleGenerateConclusion()}
                            disabled={generatingConclusions[activeMeetingId] || isSessionActive}
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
                              opacity: (generatingConclusions[activeMeetingId] || isSessionActive) ? 0.5 : 1,
                              cursor: (generatingConclusions[activeMeetingId] || isSessionActive) ? "not-allowed" : "pointer"
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
          engineConfigs={engineConfigs}
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
                  <span>会议主题 / 议题名称</span>
                  <input required placeholder="例如：核心支付接口防抖设计与重构方案" value={newMeetingDraft.name || ""} onChange={e => setNewMeetingDraft({...newMeetingDraft, name: e.target.value})} />
                </label>
                <label className="compact-field">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                    <span style={{ marginBottom: 0 }}>议题背景与核心上下文 (Context)</span>
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
                  <textarea style={{ minHeight: "80px" }} required placeholder="在此输入该评审议题的背景、设计草案、核心代码或面临的技术疑难，以便 AI 专家进行精准评审..." value={newMeetingDraft.description || ""} onChange={e => setNewMeetingDraft({...newMeetingDraft, description: e.target.value})} />
                </label>
                <label className="compact-field">
                  <span>辩论激烈程度 (1-5)</span>
                  <input type="number" min="1" max="5" required placeholder="默认等级为 3。值越高，专家之间的对抗与质疑越剧烈" value={newMeetingDraft.globalDebateIntensity || 3} onChange={e => setNewMeetingDraft({...newMeetingDraft, globalDebateIntensity: parseInt(e.target.value)})} />
                </label>
                <label className="compact-field">
                  <span>发言流转机制</span>
                  <select required value={newMeetingDraft.turnOrderMode || "sequential"} onChange={e => setNewMeetingDraft({...newMeetingDraft, turnOrderMode: e.target.value as any})}>
                    <option value="sequential">顺序发言</option>
                    <option value="relevance">动态指派</option>
                    <option value="manual">点名发言</option>
                  </select>
                </label>
                <label className="compact-field">
                  <span>主持人决策模式</span>
                  <select 
                    required 
                    value={newMeetingDraft.moderatorAutonomy || "facilitative"} 
                    onChange={e => {
                      const val = e.target.value as any;
                      const updates: Partial<Meeting> = { moderatorAutonomy: val };
                      if (val === "autonomous") {
                        updates.enableInquiryLoop = false;
                      }
                      setNewMeetingDraft({ ...newMeetingDraft, ...updates });
                    }}
                  >
                    <option value="passive">被动传统</option>
                    <option value="facilitative">协调引导</option>
                    <option value="autonomous">自主决策</option>
                  </select>
                </label>
                <label className="compact-field">
                  <span>信息自动追问 (Inquiry)</span>
                  <select 
                    required 
                    value={newMeetingDraft.moderatorAutonomy === "autonomous" ? "false" : (newMeetingDraft.enableInquiryLoop ? "true" : "false")} 
                    onChange={e => setNewMeetingDraft({...newMeetingDraft, enableInquiryLoop: e.target.value === "true"})}
                    disabled={newMeetingDraft.moderatorAutonomy === "autonomous"}
                    style={{ opacity: newMeetingDraft.moderatorAutonomy === "autonomous" ? 0.5 : 1 }}
                  >
                    <option value="true">开启（当上下文缺失时由主持人追问澄清）</option>
                    <option value="false">关闭（忽略不全信息，直接总结）</option>
                  </select>
                </label>
                <div className="modal-actions" style={{ padding: "24px 0", marginTop: "8px" }}>
                  <button type="button" className="ghost-button" onClick={() => setIsMeetingModalOpen(false)}>取消</button>
                  <button type="submit" className="primary-button">{meetingModalMode === "create" ? "创建评审圆桌" : "保存圆桌设置"}</button>
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

interface StreamingTurnOptions {
  endpoint: string;
  body: any;
  signal: AbortSignal;
  streamInactiveTimeoutSeconds?: number;
  onChunk?: (text: string, isExtracting: boolean) => void;
  errorMsgFallback: string;
}

async function requestStreamingTurn({
  endpoint,
  body,
  signal,
  streamInactiveTimeoutSeconds = 30,
  onChunk,
  errorMsgFallback
}: StreamingTurnOptions): Promise<string> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || errorMsgFallback);
  }

  const contentType = response.headers.get("content-type");
  if (contentType && contentType.includes("text/event-stream")) {
    const reader = response.body?.getReader();
    const decoder = new TextDecoder("utf-8");
    let fullContent = "";
    if (!reader) throw new Error("No reader");

    let isNativeReasoning = false;
    let hasClosedNativeReasoning = false;

    const onAbort = () => {
      reader.cancel().catch(() => {});
    };
    signal.addEventListener("abort", onAbort);

    let lastActiveTime = Date.now();
    const watchdog = setInterval(() => {
      if (Date.now() - lastActiveTime > streamInactiveTimeoutSeconds * 1000) {
        console.warn(`[Watchdog] Stream inactive for ${streamInactiveTimeoutSeconds}s, canceling reader...`);
        clearInterval(watchdog);
        reader.cancel().catch(() => {});
      }
    }, 5000);

    try {
      let shouldFinish = false;
      while (true) {
        if (shouldFinish) break;
        const { done, value } = await reader.read();
        if (done) break;

        lastActiveTime = Date.now();

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (line === "data: [DONE]") {
            shouldFinish = true;
            break;
          }
          if (line.startsWith("data: ") && line !== "data: [DONE]") {
            try {
              const data = JSON.parse(line.slice(6));
              const deltaObj = data.choices[0]?.delta;
              const reasoningChunk = deltaObj?.reasoning_content || deltaObj?.reasoning || deltaObj?.thought;
              const contentChunk = deltaObj?.content;

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
                  onChunk(fullContent, false);
                } else {
                  const cleaned = cleanStreamingJson(fullContent);
                  const isExtracting = (fullContent.includes("<think>") && !fullContent.includes("</think>"))
                    ? false
                    : cleaned.length < fullContent.trim().length;
                  onChunk(cleaned, isExtracting);
                }
              }
            } catch (e) {}
          }
        }
      }
    } catch (err: any) {
      if (err.name === "AbortError" || signal.aborted || err.message?.toLowerCase().includes("abort")) {
        console.log("Stream reading aborted safely.");
      } else {
        throw err;
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
      clearInterval(watchdog);
    }

    return fullContent;
  } else {
    const payload = await response.json();
    if (payload.error) throw new Error(payload.error);
    return typeof payload === "string" ? payload : (payload.content || JSON.stringify(payload));
  }
}
