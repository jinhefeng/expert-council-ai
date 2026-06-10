"use client";

import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { experts as defaultExperts, moderatorModes, mergeSystemExperts } from "@/lib/experts";
import { LocalStorageService } from "@/lib/storage-service";
import {
  Expert,
  LLMEngineConfig,
  Meeting,
  ChatMessage,
  SourceItem,
} from "@/lib/types";

const TENANT_ID = "default-org";

export default function Home() {
  // 存储服务实例
  const storage = useMemo(() => new LocalStorageService(), []);



  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [activeMeetingId, setActiveMeetingId] = useState<string>("");
  const [systemExperts, setSystemExperts] = useState<Expert[]>(defaultExperts);
  const [customExperts, setCustomExperts] = useState<Expert[]>([]);
  const [engineConfigs, setEngineConfigs] = useState<LLMEngineConfig[]>([]);
  
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
  const [isDiscussing, setIsDiscussing] = useState(false);
  const [speakingExpertId, setSpeakingExpertId] = useState<string | null>(null);
  const [isSynthesisPending, setIsSynthesisPending] = useState(false);

  // 面板展开/收起
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isControlPanelCollapsed, setIsControlPanelCollapsed] = useState(false);

  // 弹窗与表单配置状态
  const [isCustomModalOpen, setIsCustomModalOpen] = useState(false);
  const [isEngineModalOpen, setIsEngineModalOpen] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<Expert | null>(null);

  // 自定义专家表单
  const [customDraft, setCustomDraft] = useState({
    name: "",
    title: "",
    lens: "",
    temperament: "",
    systemPrompt: "",
    debateIntensity: 3,
  });
  const [customError, setCustomError] = useState("");

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

  // 初始化加载本地组织资源与会议
  useEffect(() => {
    async function initData() {
      const loadedMeetings = await storage.getMeetings(TENANT_ID);
      const loadedExperts = await storage.getCustomExperts(TENANT_ID);
      const loadedConfigs = await storage.getEngineConfigs(TENANT_ID);
      const systemOverrides = await storage.getSystemExpertsOverrides(TENANT_ID);

      setSystemExperts(mergeSystemExperts(defaultExperts, systemOverrides));
      setCustomExperts(loadedExperts);
      setEngineConfigs(loadedConfigs);

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
      const savedControl = localStorage.getItem("DC_control_collapsed");
      if (savedSidebar === "true") setIsSidebarCollapsed(true);
      if (savedControl === "true") setIsControlPanelCollapsed(true);
      
      const savedActivations = localStorage.getItem("DC_expert_activations");
      if (savedActivations) {
        try {
          setExpertActivationTimestamps(JSON.parse(savedActivations));
        } catch (e) {}
      }
      
      setIsLoaded(true);

      if (loadedMeetings.length > 0) {
        setMeetings(loadedMeetings);
        setActiveMeetingId(loadedMeetings[0].id);
      } else {
        // 创建初始默认会议
        const defaultMeeting: Meeting = {
          id: `meeting-${Date.now()}`,
          tenantId: TENANT_ID,
          name: "核心业务方案跨职能评审会",
          description: "评估核心业务逻辑、架构设计与用户价值的专家圆桌会",
          expertIds: ["ux-researcher", "brand-strategist", "growth-designer"],
          moderatorId: "balanced",
          globalDebateIntensity: 3,
          turnOrderMode: "sequential",
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

  useEffect(() => {
    if (isLoaded) {
      localStorage.setItem("DC_control_collapsed", String(isControlPanelCollapsed));
    }
  }, [isControlPanelCollapsed, isLoaded]);

  // 滚动到聊天底部
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [meetings, speakingExpertId, isSynthesisPending]);

  // 计算属性
  const allExperts = useMemo(() => {
    return [...systemExperts, ...customExperts];
  }, [systemExperts, customExperts]);

  const activeMeeting = useMemo(() => {
    return meetings.find(m => m.id === activeMeetingId);
  }, [meetings, activeMeetingId]);

  const activeEngineConfig = useMemo(() => {
    return engineConfigs.find(c => c.id === activeEngineId);
  }, [engineConfigs, activeEngineId]);

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
  async function handleCreateMeeting() {
    const name = window.prompt("请输入新会议的名称：");
    if (!name?.trim()) return;

    const newMeeting: Meeting = {
      id: `meeting-${Date.now()}`,
      tenantId: TENANT_ID,
      name: name.trim(),
      description: "关于复杂议题论证的圆桌会议",
      expertIds: ["ux-researcher", "brand-strategist"],
      moderatorId: "balanced",
      globalDebateIntensity: 3,
      turnOrderMode: "sequential",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    };

    await storage.saveMeeting(TENANT_ID, newMeeting);
    setMeetings(prev => [...prev, newMeeting]);
    setActiveMeetingId(newMeeting.id);
  }

  async function handleDeleteMeeting(id: string, event: React.MouseEvent) {
    event.stopPropagation();
    if (!window.confirm("确定要删除这场会议吗？相关的对话记录将被清除。")) return;

    await storage.deleteMeeting(TENANT_ID, id);
    const nextMeetings = meetings.filter(m => m.id !== id);
    setMeetings(nextMeetings);
    if (activeMeetingId === id && nextMeetings.length > 0) {
      setActiveMeetingId(nextMeetings[0].id);
    }
  }

  // 自定义智能体操作
  function openCustomModal() {
    setIsCustomModalOpen(true);
    setCustomError("");
  }

  function closeCustomModal() {
    setIsCustomModalOpen(false);
    setCustomDraft({
      name: "",
      title: "",
      lens: "",
      temperament: "",
      systemPrompt: "",
      debateIntensity: 3,
    });
  }

  async function addCustomExpert() {
    const { name, title, lens, temperament, systemPrompt, debateIntensity } = customDraft;
    if (!name.trim() || !lens.trim()) {
      setCustomError("请至少填写角色名称和判断视角。");
      return;
    }

    const newExpert: Expert = {
      id: `custom-${Date.now()}`,
      tenantId: TENANT_ID,
      name: name.trim(),
      title: title.trim() || "自定义视角专家",
      lens: lens.trim(),
      temperament: temperament.trim() || "按照自定义人物设定进行理性判断。",
      focus: ["自定义审视", "接受度", "商业闭环"],
      debateIntensity: Number(debateIntensity),
      systemPrompt: systemPrompt.trim() || `你是${name.trim()}。请从以下视角进行评审：${lens.trim()}。性格：${temperament.trim()}。请客观分析，指出风险，并给出折中方案。`,
      isCustom: true,
    };

    await storage.saveCustomExpert(TENANT_ID, newExpert);
    setCustomExperts(prev => [...prev, newExpert]);
    
    // 默认加到本场参会人中
    if (activeMeeting) {
      await updateActiveMeeting({
        expertIds: [...activeMeeting.expertIds, newExpert.id]
      });
    }

    closeCustomModal();
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

  // 专家单步发言逻辑封装 (API 调用)
  async function requestExpertTurn(
    meeting: Meeting,
    expert: Expert,
    previousTurns: { expertName: string; content: string }[],
    userQuestion: string,
    contextStr: string,
    history: ChatMessage[],
    signal: AbortSignal
  ) {
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
        conversationHistory: history, // 传入历史多轮对话上下文
      }),
      signal,
    });

    if (!response.ok) {
      const payload = await response.json();
      throw new Error(payload.error || "大模型在生成智能体观点时失败。");
    }

    return response.json();
  }

  // 智能相关度下一发言人决策
  async function requestNextSpeakerId(
    userQuestion: string,
    previousTurns: { expertName: string; content: string }[],
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
        conversationHistory: history, // 传入历史对话
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
    expertRounds: { expertName: string; content: string }[],
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
        conversationHistory: history, // 传入历史对话
      }),
      signal,
    });

    if (!response.ok) {
      const payload = await response.json();
      throw new Error(payload.error || "主持人总结处理失败。");
    }

    return response.json();
  }

  // 叫停会议
  function handleAbort() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }

  // 圆桌讨论主提交入口
  async function handleSubmitDiscussion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeMeeting || isDiscussing) return;

    const userQuestion = question.trim();
    if (!userQuestion) return;

    setIsDiscussing(true);
    setQuestion("");
    setSources([]);

    // 缓存这轮提问发生前的整场历史对话列表
    const conversationHistory = activeMeeting.messages;

    // 1. 创建 User 消息
    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}-user`,
      meetingId: activeMeeting.id,
      tenantId: TENANT_ID,
      role: "user",
      senderName: "用户",
      content: userQuestion,
      sources: [...sources],
      createdAt: Date.now(),
    };

    const updatedMessages = [...activeMeeting.messages, userMessage];
    const nextMeetingState = { ...activeMeeting, messages: updatedMessages };
    setMeetings(prev => prev.map(m => m.id === activeMeetingId ? nextMeetingState : m));
    await storage.saveMeeting(TENANT_ID, nextMeetingState);

    // 2. 构造 Abort 监控
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const signal = controller.signal;

    // 获取参会的专家
    const selectedExperts = allExperts.filter(e => activeMeeting.expertIds.includes(e.id));
    const contextStr = [projectContext, buildSourceContext()].filter(Boolean).join("\n\n");

    // 本轮发言缓冲
    const previousTurns: { expertName: string; content: string }[] = [];
    let currentMeeting = nextMeetingState;

    try {
      // 如果没有勾选任何参会专家，直接跑主持人总结
      if (selectedExperts.length === 0) {
        setIsSynthesisPending(true);
        const synth = await requestSynthesis(currentMeeting, userQuestion, [], contextStr, conversationHistory, signal);
        
        const modMessage: ChatMessage = {
          id: `msg-${Date.now()}-mod`,
          meetingId: currentMeeting.id,
          tenantId: TENANT_ID,
          role: "moderator",
          senderName: "主持人",
          content: synth.summary,
          expertStance: {
            stance: "共识：" + (synth.consensus?.join("；") || "无。"),
            concern: "分歧：" + (synth.disagreements?.join("；") || "无。"),
            recommendation: "决议：" + (synth.decisions?.join("；") || "无。"),
            tradeoff: "行动：" + (synth.nextActions?.join("；") || "无。"),
          },
          createdAt: Date.now(),
        };

        const finalMessages = [...currentMeeting.messages, modMessage];
        currentMeeting = { ...currentMeeting, messages: finalMessages };
        setMeetings(prev => prev.map(m => m.id === activeMeetingId ? currentMeeting : m));
        await storage.saveMeeting(TENANT_ID, currentMeeting);
        
        setIsSynthesisPending(false);
        setIsDiscussing(false);
        return;
      }

      // 如果是“手动点名”模式，只生成一个占位消息，提示用户点名，不自动流转队列
      if (currentMeeting.turnOrderMode === "manual") {
        setIsDiscussing(false);
        return;
      }

      // 自动圆桌发言流 (Sequential 或 Relevance)
      let remainCandidates = [...selectedExperts];

      while (remainCandidates.length > 0) {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");

        // 确定下一个发言人
        let currentExpert: Expert;
        if (currentMeeting.turnOrderMode === "relevance" && remainCandidates.length > 1) {
          const nextId = await requestNextSpeakerId(userQuestion, previousTurns, remainCandidates, conversationHistory, signal);
          currentExpert = remainCandidates.find(e => e.id === nextId) || remainCandidates[0];
        } else {
          currentExpert = remainCandidates[0];
        }

        remainCandidates = remainCandidates.filter(e => e.id !== currentExpert.id);

        setSpeakingExpertId(currentExpert.id);

        // 调用单步发言
        const turnResult = await requestExpertTurn(
          currentMeeting,
          currentExpert,
          previousTurns,
          userQuestion,
          contextStr,
          conversationHistory,
          signal
        );

        // 生成专家发言并追加
        const expertMessage: ChatMessage = {
          id: `msg-${Date.now()}-${currentExpert.id}`,
          meetingId: currentMeeting.id,
          tenantId: TENANT_ID,
          role: "expert",
          senderId: currentExpert.id,
          senderName: currentExpert.name,
          senderTitle: currentExpert.title,
          content: turnResult.content,
          expertStance: turnResult.expertStance,
          createdAt: Date.now(),
        };

        const nextMsgs = [...currentMeeting.messages, expertMessage];
        currentMeeting = { ...currentMeeting, messages: nextMsgs };
        setMeetings(prev => prev.map(m => m.id === activeMeetingId ? currentMeeting : m));
        await storage.saveMeeting(TENANT_ID, currentMeeting);

        previousTurns.push({
          expertName: currentExpert.name,
          content: turnResult.content,
        });
      }

      // 4. 调用主持人综合总结
      setSpeakingExpertId(null);
      setIsSynthesisPending(true);

      const synth = await requestSynthesis(currentMeeting, userQuestion, previousTurns, contextStr, conversationHistory, signal);
      
      const modMessage: ChatMessage = {
        id: `msg-${Date.now()}-mod`,
        meetingId: currentMeeting.id,
        tenantId: TENANT_ID,
        role: "moderator",
        senderName: "主持人",
        content: synth.summary,
        expertStance: {
          stance: "共识：" + (synth.consensus?.join("；") || "达成基本共识。"),
          concern: "分歧：" + (synth.disagreements?.join("；") || "无明显分歧。"),
          recommendation: "决议：" + (synth.decisions?.join("；") || "默认按最优方案落地。"),
          tradeoff: "行动：" + (synth.nextActions?.join("；") || "跟进常规迭代。"),
        },
        createdAt: Date.now(),
      };

      const finalMessages = [...currentMeeting.messages, modMessage];
      currentMeeting = { ...currentMeeting, messages: finalMessages };
      setMeetings(prev => prev.map(m => m.id === activeMeetingId ? currentMeeting : m));
      await storage.saveMeeting(TENANT_ID, currentMeeting);

    } catch (e: any) {
      if (e.name === "AbortError" || signal.aborted) {
        // 叫停处理
        const abortMessage: ChatMessage = {
          id: `msg-abort-${Date.now()}`,
          meetingId: currentMeeting.id,
          tenantId: TENANT_ID,
          role: "moderator",
          senderName: "系统提示",
          content: "⚠️ 本轮专家圆桌讨论已被用户手动叫停中止。已保留之前生成的讨论观点，您可以输入新的追问或调整设置。",
          createdAt: Date.now(),
        };
        const nextMsgs = [...currentMeeting.messages, abortMessage];
        const nextState = { ...currentMeeting, messages: nextMsgs };
        setMeetings(prev => prev.map(m => m.id === activeMeetingId ? nextState : m));
        await storage.saveMeeting(TENANT_ID, nextState);
      } else {
        console.error("圆桌讨论异常中止", e);
        alert(`圆桌发生异常: ${e.message || "请求失败"}`);
      }
    } finally {
      setIsDiscussing(false);
      setSpeakingExpertId(null);
      setIsSynthesisPending(false);
      abortControllerRef.current = null;
    }
  }

  // 主持人点名手动触发特定专家发言
  async function handleCallExpertDirectly(expert: Expert) {
    if (!activeMeeting || isDiscussing) return;
    setIsDiscussing(true);
    setSpeakingExpertId(expert.id);

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
    abortControllerRef.current = controller;
    const signal = controller.signal;
    const contextStr = [projectContext, buildSourceContext()].filter(Boolean).join("\n\n");

    try {
      const turnResult = await requestExpertTurn(
        activeMeeting,
        expert,
        historyRounds,
        userQuestion,
        contextStr,
        conversationHistory,
        signal
      );

      const expertMessage: ChatMessage = {
        id: `msg-${Date.now()}-${expert.id}`,
        meetingId: activeMeeting.id,
        tenantId: TENANT_ID,
        role: "expert",
        senderId: expert.id,
        senderName: expert.name,
        senderTitle: expert.title,
        content: turnResult.content,
        expertStance: turnResult.expertStance,
        createdAt: Date.now(),
      };

      const nextMsgs = [...activeMeeting.messages, expertMessage];
      const nextMeetingState = { ...activeMeeting, messages: nextMsgs };
      setMeetings(prev => prev.map(m => m.id === activeMeetingId ? nextMeetingState : m));
      await storage.saveMeeting(TENANT_ID, nextMeetingState);

    } catch (e: any) {
      if (e.name !== "AbortError" && !signal.aborted) {
        alert("点名专家发言失败: " + e.message);
      }
    } finally {
      setIsDiscussing(false);
      setSpeakingExpertId(null);
      abortControllerRef.current = null;
    }
  }

  // 主持人手动终结会议，输出汇总
  async function handleManualSynthesize() {
    if (!activeMeeting || isDiscussing) return;
    setIsDiscussing(true);
    setIsSynthesisPending(true);

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
    abortControllerRef.current = controller;
    const signal = controller.signal;
    const contextStr = [projectContext, buildSourceContext()].filter(Boolean).join("\n\n");

    try {
      const synth = await requestSynthesis(activeMeeting, userQuestion, historyRounds, contextStr, conversationHistory, signal);
      
      const modMessage: ChatMessage = {
        id: `msg-${Date.now()}-mod`,
        meetingId: activeMeeting.id,
        tenantId: TENANT_ID,
        role: "moderator",
        senderName: "主持人",
        content: synth.summary,
        expertStance: {
          stance: "共识：" + (synth.consensus?.join("；") || "达成基本共识。"),
          concern: "分歧：" + (synth.disagreements?.join("；") || "无明显分歧。"),
          recommendation: "决议：" + (synth.decisions?.join("；") || "无特定决议。"),
          tradeoff: "行动：" + (synth.nextActions?.join("；") || "维持原状。"),
        },
        createdAt: Date.now(),
      };

      const finalMessages = [...activeMeeting.messages, modMessage];
      const nextMeetingState = { ...activeMeeting, messages: finalMessages };
      setMeetings(prev => prev.map(m => m.id === activeMeetingId ? nextMeetingState : m));
      await storage.saveMeeting(TENANT_ID, nextMeetingState);

    } catch (e: any) {
      if (e.name !== "AbortError" && !signal.aborted) {
        alert("生成主持人汇总失败: " + e.message);
      }
    } finally {
      setIsDiscussing(false);
      setIsSynthesisPending(false);
      abortControllerRef.current = null;
    }
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

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="header-inner">
          <div className="brand-lockup">
            <div className="brand-mark" aria-hidden="true">
              EC
            </div>
            <div>
              <p className="eyebrow">Expert Council AI - Organization Level</p>
              <h1>组织级 AI 专家圆桌会议中心</h1>
            </div>
          </div>
          <div className="status-group">
            <span className="status-chip">{meetings.length} 场会议</span>
            <span className="status-chip">{customExperts.length} 自定义智能体</span>
            <span className="status-chip">
              {activeEngineId === "system-env" ? "系统环境模型" : activeEngineConfig?.name || "未知引擎"}
            </span>
            <a href="/admin" className="ghost-button" style={{ display: "inline-flex", alignItems: "center", minHeight: "30px", padding: "0 12px", textDecoration: "none", borderRadius: "999px", fontSize: "12px", border: "1px solid var(--line)", background: "var(--surface)" }}>
              后台管理 →
            </a>
          </div>
        </div>
      </header>

      <form
        className={`workspace-triple ${
          isSidebarCollapsed ? "is-sidebar-collapsed" : ""
        } ${
          isControlPanelCollapsed ? "is-control-collapsed" : ""
        }`}
        onSubmit={handleSubmitDiscussion}
      >
        {/* 左侧栏一：会议列表空间 */}
        <section className={`panel side-panel ${isSidebarCollapsed ? "is-collapsed" : ""}`}>
          {isSidebarCollapsed ? (
            <button
              aria-label="展开会议列表"
              className="panel-rail"
              type="button"
              onClick={() => setIsSidebarCollapsed(false)}
            >
              <span className="rail-count">{meetings.length}</span>
              <span>会议</span>
              <span aria-hidden="true" style={{ transform: "rotate(-90deg)", display: "inline-block" }}>›</span>
            </button>
          ) : (
            <div className="meeting-section">
              <div className="panel-heading side-panel-heading">
                <h2>会议空间</h2>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <button
                    className="btn-create-meeting"
                    type="button"
                    onClick={handleCreateMeeting}
                    title="新建会议室"
                  >
                    +
                  </button>
                  <button
                    aria-label="收起会议空间"
                    className="panel-toggle-button"
                    type="button"
                    onClick={() => setIsSidebarCollapsed(true)}
                  >
                    ‹
                  </button>
                </div>
              </div>
              <div className="meeting-list">
                {meetings.map((meeting) => {
                  const isActive = meeting.id === activeMeetingId;
                  return (
                    <div
                      key={meeting.id}
                      className={`meeting-item ${isActive ? "is-active" : ""}`}
                      onClick={() => setActiveMeetingId(meeting.id)}
                    >
                      <div className="meeting-item-info">
                        <span className="meeting-item-title">{meeting.name}</span>
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
                title="新建组织智能体"
              >
                +
              </button>
            </div>
          </div>
              
              <div className="role-list">
                {displayExperts.map((expert) => {
                  const isSelected = activeMeeting?.expertIds.includes(expert.id) ?? false;
                  const isSpeaking = speakingExpertId === expert.id;

                  return (
                    <div
                      key={expert.id}
                      className={`role-card ${isSelected ? "is-selected" : ""} ${isSpeaking ? "is-speaking" : ""}`}
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
                            <p className="role-name" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              {expert.name}
                              <span className={`intensity-badge lvl-${expert.debateIntensity}`}>
                                Lvl {expert.debateIntensity} 对抗
                              </span>
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
                              disabled={isDiscussing}
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
                        {activeMeeting?.turnOrderMode === "manual" && isSelected && !isDiscussing && (
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
                      
                      {expert.isCustom && (
                        <button
                          className="text-button"
                          type="button"
                          onClick={() => setDeleteCandidate(expert)}
                          style={{ position: "absolute", right: "12px", top: "42px" }}
                        >
                          删除
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>


        </section>

        {/* 中间栏：会议室讨论现场 */}
        <section className="panel discussion-panel chat-panel">
          <div className="discussion-heading">
            <div style={{ minWidth: 0, flex: 1 }}>
              <span className="eyebrow" style={{ display: "block" }}>当前会议室</span>
              <h2 style={{ fontSize: "20px", fontWeight: "700", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {activeMeeting ? activeMeeting.name : "载入中..."}
              </h2>
            </div>
            
            {/* 点名模式下，如果专家发过言但还未总结，允许手动一键总结 */}
            {activeMeeting?.turnOrderMode === "manual" && !isDiscussing && activeMeeting.messages.length > 0 && (
              <button
                className="btn-small-action"
                type="button"
                onClick={handleManualSynthesize}
                style={{ marginRight: "10px", borderColor: "var(--amber)", color: "var(--amber)" }}
              >
                📝 总结会议意见
              </button>
            )}
          </div>

          {/* 真实模式下，若未配大模型引擎，展示全局警告条并引导 */}
          {showKeyWarning && (
            <div className="note-message" style={{ borderLeft: "4px solid var(--amber)", borderRadius: "4px", margin: "14px 18px 0", background: "var(--amber-soft)", color: "#684c08" }}>
              <strong>⚠️ 当前为【真枪实弹运行模式】</strong>：若您在本地的 `.env.local` 配置文件中配置了 `DASHSCOPE_API_KEY` 或 `OPENAI_API_KEY`，可直接选用【系统默认大模型】启动；若未配置，请点击右侧【自定义大模型服务】输入您的 API 密钥，否则圆桌会议发送提问时将会报错。
            </div>
          )}

          <section className="chat-thread">
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
                      {(isExp || isMod) && (
                        <p style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "4px" }}>
                          {message.senderName} · {message.senderTitle || "总监"}
                        </p>
                      )}
                      
                      <div className="message-content" style={{ whiteSpace: "pre-wrap" }}>
                        {message.content}
                      </div>

                      {message.expertStance && (
                        <div className="assistant-result" style={{ marginTop: "10px" }}>
                          <div className="result-card" style={{ borderLeft: "3px solid var(--amber)", borderRadius: "0 8px 8px 0" }}>
                            <div className="result-grid">
                              <p><strong>立场观点：</strong>{message.expertStance.stance}</p>
                              <p><strong>关键风险：</strong>{message.expertStance.concern}</p>
                              <p><strong>实施建议：</strong>{message.expertStance.recommendation}</p>
                              <p><strong>方案取舍：</strong>{message.expertStance.tradeoff}</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="empty-state-content">
                <p className="empty-state-label">EXPERT ROUNDTABLE</p>
                <h3>召集一场专家圆桌会</h3>
                <p>在下方输入框中抛出您要讨论的产品规划、技术方案、业务瓶颈或任何复杂议题，AI 专家群组将开始论证。</p>
              </div>
            )}

            {speakingExpertId && (
              <article className="chat-message expert">
                <div className="message-avatar">
                  {allExperts.find(e => e.id === speakingExpertId)?.name.slice(0, 2) || "AI"}
                </div>
                <div className="message-body">
                  <div className="thinking-card">
                    <div className="thinking-loader">
                      <strong>{allExperts.find(e => e.id === speakingExpertId)?.name}</strong> 正在审视议题
                      <div className="dot-pulse">
                        <span />
                        <span />
                        <span />
                      </div>
                    </div>
                    <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                      正在结合个人对抗强度与会议历史多轮对话上下文编排论点...
                    </span>
                  </div>
                </div>
              </article>
            )}

            {isSynthesisPending && (
              <article className="chat-message moderator">
                <div className="message-avatar">主持</div>
                <div className="message-body">
                  <div className="thinking-card" style={{ borderStyle: "solid", borderColor: "var(--amber)" }}>
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

            <div ref={chatEndRef} />
          </section>

          {/* 附件上传 */}
          <div
            className={`composer-shell ${isDraggingSources ? "is-dragging" : ""}`}
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
              <button
                aria-label="添加附件"
                className="composer-add"
                type="button"
                onClick={() => fileInputRef.current?.click()}
              >
                +
              </button>
              <textarea
                className="composer-input"
                placeholder="输入你想让专家圆桌深度论证的全新议题（Command + Enter 发送）"
                value={question}
                disabled={isDiscussing}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              {isDiscussing ? (
                <button
                  aria-label="叫停讨论"
                  className="btn-abort"
                  type="button"
                  onClick={handleAbort}
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
        </section>

        {/* 右侧栏：控制面板和统一模型引擎配置 */}
        <section className={`panel side-panel control-panel ${isControlPanelCollapsed ? "is-collapsed" : ""}`}>
          {isControlPanelCollapsed ? (
            <button
              aria-label="展开会议控制"
              className="panel-rail"
              type="button"
              onClick={() => setIsControlPanelCollapsed(false)}
            >
              <span className="rail-count" style={{ border: "none", background: "transparent", fontSize: "16px" }}>⚙️</span>
              <span>会议控制</span>
              <span aria-hidden="true" style={{ transform: "rotate(-90deg)", display: "inline-block" }}>‹</span>
            </button>
          ) : (
            <>
              <div className="panel-heading side-panel-heading">
                <h2>会议控制</h2>
                <button
                  aria-label="收起设置"
                  className="panel-toggle-button"
                  type="button"
                  onClick={() => setIsControlPanelCollapsed(true)}
                >
                  ›
                </button>
              </div>

              {/* 大模型切换 */}
              <div className="control-block" style={{ borderTop: "none", paddingTop: 0 }}>
                <p className="control-label">当前运行模型</p>
                <div style={{ marginTop: "8px" }}>
                  <select
                    className="ghost-button"
                    style={{ width: "100%", padding: "6px 10px", borderRadius: "6px", border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)", outline: "none", fontSize: "13px", cursor: "pointer" }}
                    value={activeEngineId}
                    onChange={(e) => void handleSelectEngine(e.target.value)}
                  >
                    <option value="system-env">系统默认大模型 (环境变量)</option>
                    {engineConfigs.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 发言模式 */}
              {activeMeeting && (
                <div className="control-block">
                  <p className="control-label">发言顺序管理</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px" }}>
                    <button
                      className={`btn-small-action ${activeMeeting.turnOrderMode === "sequential" ? "active" : ""}`}
                      type="button"
                      onClick={() => void updateActiveMeeting({ turnOrderMode: "sequential" })}
                    >
                      Sequential (自动顺序发言)
                    </button>
                    <button
                      className={`btn-small-action ${activeMeeting.turnOrderMode === "relevance" ? "active" : ""}`}
                      type="button"
                      onClick={() => void updateActiveMeeting({ turnOrderMode: "relevance" })}
                    >
                      Relevance (AI 动态相关指派)
                    </button>
                    <button
                      className={`btn-small-action ${activeMeeting.turnOrderMode === "manual" ? "active" : ""}`}
                      type="button"
                      onClick={() => void updateActiveMeeting({ turnOrderMode: "manual" })}
                    >
                      Manual (主持人手动点名)
                    </button>
                  </div>
                </div>
              )}

              {/* 对抗强度 */}
              {activeMeeting && (
                <div className="control-block" style={{ borderBottom: "1px solid var(--line)", paddingBottom: "14px", marginTop: "14px" }}>
                  <p className="control-label">会议全局对抗激烈度</p>
                  <label className="intensity-selector">
                    <input
                      type="range"
                      min="1"
                      max="5"
                      disabled={isDiscussing}
                      value={activeMeeting.globalDebateIntensity}
                      onChange={(e) => void updateActiveMeeting({ globalDebateIntensity: Number(e.target.value) })}
                    />
                    <span style={{ fontSize: "14px" }}>{activeMeeting.globalDebateIntensity}</span>
                  </label>
                  <span style={{ fontSize: "11px", color: "var(--muted)", display: "block", marginTop: "4px" }}>
                    强度越高，专家之间观点碰撞与漏洞攻击的尖锐度越强。
                  </span>
                </div>
              )}

              {/* 主持风格 */}
              {activeMeeting && (
                <div className="control-block" style={{ marginTop: "14px" }}>
                  <p className="control-label">主持人风格模式</p>
                  <div className="moderator-list" style={{ marginTop: "8px" }}>
                    {moderatorModes.map((mode) => (
                      <button
                        className={`moderator-card ${activeMeeting.moderatorId === mode.id ? "is-selected" : ""}`}
                        key={mode.id}
                        type="button"
                        onClick={() => void updateActiveMeeting({ moderatorId: mode.id })}
                      >
                        <p>{mode.name}</p>
                        <span>{mode.description}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        {/* 弹窗：新建自定义智能体 */}
        {isCustomModalOpen && (
          <div className="modal-backdrop">
            <section className="modal-card">
              <div className="modal-header">
                <div>
                  <p className="eyebrow">Organization Agent</p>
                  <h2>新增组织智能体 (自定义视角)</h2>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  onClick={closeCustomModal}
                >
                  ×
                </button>
              </div>
              
              <label className="compact-field">
                <span>智能体角色名称</span>
                <input
                  placeholder="如：安全合规官"
                  value={customDraft.name}
                  onChange={(e) => setCustomDraft({ ...customDraft, name: e.target.value })}
                />
              </label>

              <label className="compact-field">
                <span>角色头衔标签</span>
                <input
                  placeholder="如：合规风险架构师"
                  value={customDraft.title}
                  onChange={(e) => setCustomDraft({ ...customDraft, title: e.target.value })}
                />
              </label>

              <label className="field-block">
                <span>审视该议题的专业视角 (Lens)</span>
                <input
                  type="text"
                  placeholder="说明该智能体着重挑刺/关注哪些点。如：评估页面是否涉嫌虚假宣传、隐私协议是否合规。"
                  value={customDraft.lens}
                  onChange={(e) => setCustomDraft({ ...customDraft, lens: e.target.value })}
                />
              </label>

              <label className="compact-field">
                <span>智能体性格脾气 (Temperament)</span>
                <input
                  placeholder="如：极其挑剔、强迫症、极其保守"
                  value={customDraft.temperament}
                  onChange={(e) => setCustomDraft({ ...customDraft, temperament: e.target.value })}
                />
              </label>

              <label className="compact-field">
                <span>高级系统 Prompt (可选)</span>
                <textarea
                  placeholder="可以填入该智能体大模型专属的完整 System Setting。"
                  value={customDraft.systemPrompt}
                  onChange={(e) => setCustomDraft({ ...customDraft, systemPrompt: e.target.value })}
                />
              </label>

              <label className="compact-field">
                <span>默认辩论激烈度：{customDraft.debateIntensity}</span>
                <input
                  type="range"
                  min="1"
                  max="5"
                  value={customDraft.debateIntensity}
                  onChange={(e) => setCustomDraft({ ...customDraft, debateIntensity: Number(e.target.value) })}
                />
              </label>

              {customError && <p className="custom-error">{customError}</p>}

              <div className="modal-actions">
                <button
                  className="ghost-button"
                  type="button"
                  onClick={closeCustomModal}
                >
                  取消
                </button>
                <button
                  className="primary-button"
                  type="button"
                  onClick={addCustomExpert}
                >
                  添加组织角色
                </button>
              </div>
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
      </form>
    </main>
  );
}
