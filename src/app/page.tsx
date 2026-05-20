"use client";

import {
  ChangeEvent,
  DragEvent,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { experts, moderatorModes, type Expert } from "@/lib/experts";
import type { DiscussionResponse } from "@/lib/model-router";

const CUSTOM_EXPERTS_STORAGE_KEY = "design-council-custom-experts";

type SourceItem = {
  id: string;
  name: string;
  type: string;
  size: number;
  kind: "image" | "document" | "text" | "file";
  previewUrl?: string;
  textSnippet?: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: SourceItem[];
  discussion?: DiscussionResponse;
};

export default function Home() {
  const [selectedExpertIds, setSelectedExpertIds] = useState([
    "ux-researcher",
    "brand-strategist",
    "growth-designer",
  ]);
  const [question, setQuestion] = useState(
    "这个 SaaS 首页首屏应该怎么评审？",
  );
  const [projectContext] = useState("");
  const [moderatorId, setModeratorId] = useState("balanced");
  const [provider, setProvider] = useState<"mock" | "qwen">("mock");
  const [discussion, setDiscussion] = useState<DiscussionResponse | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [isDraggingSources, setIsDraggingSources] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [customError, setCustomError] = useState("");
  const [customExperts, setCustomExperts] = useState<Expert[]>([]);
  const [isCustomModalOpen, setIsCustomModalOpen] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<Expert | null>(null);
  const [isRolePanelCollapsed, setIsRolePanelCollapsed] = useState(false);
  const [isControlPanelCollapsed, setIsControlPanelCollapsed] = useState(false);
  const [customDraft, setCustomDraft] = useState({
    name: "",
    title: "",
    lens: "",
    temperament: "",
    systemPrompt: "",
  });
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const loadCustomExperts = window.setTimeout(() => {
      const savedCustomExperts = window.localStorage.getItem(
        CUSTOM_EXPERTS_STORAGE_KEY,
      );

      if (!savedCustomExperts) {
        return;
      }

      try {
        setCustomExperts(JSON.parse(savedCustomExperts));
      } catch {
        window.localStorage.removeItem(CUSTOM_EXPERTS_STORAGE_KEY);
      }
    }, 0);

    return () => window.clearTimeout(loadCustomExperts);
  }, []);

  const allExperts = useMemo(
    () => [...experts, ...customExperts],
    [customExperts],
  );

  const selectedExperts = useMemo(
    () => allExperts.filter((expert) => selectedExpertIds.includes(expert.id)),
    [allExperts, selectedExpertIds],
  );

  function toggleExpert(id: string) {
    setSelectedExpertIds((current) => {
      if (current.includes(id)) {
        return current.filter((expertId) => expertId !== id);
      }

      return [...current, id];
    });
  }

  function updateCustomDraft(field: keyof typeof customDraft, value: string) {
    setCustomDraft((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function persistCustomExperts(nextExperts: Expert[]) {
    setCustomExperts(nextExperts);
    window.localStorage.setItem(
      CUSTOM_EXPERTS_STORAGE_KEY,
      JSON.stringify(nextExperts),
    );
  }

  function resetCustomDraft() {
    setCustomDraft({
      name: "",
      title: "",
      lens: "",
      temperament: "",
      systemPrompt: "",
    });
    setCustomError("");
  }

  function openCustomModal() {
    setIsCustomModalOpen(true);
    setCustomError("");
  }

  function closeCustomModal() {
    setIsCustomModalOpen(false);
    resetCustomDraft();
  }

  function addCustomExpert() {
    const name = customDraft.name.trim();
    const lens = customDraft.lens.trim();

    if (!name || !lens) {
      setCustomError("请至少填写角色名称和判断视角。");
      return;
    }

    const expert: Expert = {
      id: `custom-${Date.now()}`,
      name,
      title: customDraft.title.trim() || "自定义人物",
      lens,
      temperament:
        customDraft.temperament.trim() || "按照自定义人物设定进行判断。",
      focus: ["个人偏好", "接受度", "决策风险", "沟通成本"],
      systemPrompt:
        customDraft.systemPrompt.trim() ||
        `你是${name}。请按照这个人物视角评审设计：${lens}。你的性格和判断偏好：${customDraft.temperament.trim() || "按照自定义人物设定进行判断。"}。请指出这个人物会认可什么、反对什么、担心什么，以及会推动什么修改。`,
    };

    const nextExperts = [...customExperts, expert];
    persistCustomExperts(nextExperts);
    setSelectedExpertIds((current) => [...current, expert.id]);
    closeCustomModal();
  }

  function removeCustomExpert(id: string) {
    const nextExperts = customExperts.filter((expert) => expert.id !== id);
    persistCustomExperts(nextExperts);
    setSelectedExpertIds((current) =>
      current.filter((expertId) => expertId !== id),
    );
  }

  function confirmDeleteCustomExpert() {
    if (!deleteCandidate) {
      return;
    }

    removeCustomExpert(deleteCandidate.id);
    setDeleteCandidate(null);
  }

  async function addSourceFiles(fileList: FileList | null) {
    if (!fileList?.length) {
      return;
    }

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

    setSources((current) => [...current, ...nextSources]);
  }

  function handleSourceInputChange(event: ChangeEvent<HTMLInputElement>) {
    void addSourceFiles(event.target.files);
    event.target.value = "";
  }

  function removeSource(id: string) {
    setSources((current) => {
      const source = current.find((item) => item.id === id);

      if (source?.previewUrl) {
        URL.revokeObjectURL(source.previewUrl);
      }

      return current.filter((item) => item.id !== id);
    });
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault();

    if (event.dataTransfer.types.includes("Files")) {
      setIsDraggingSources(true);
    }
  }

  function handleDragLeave(event: DragEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDraggingSources(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsDraggingSources(false);
    void addSourceFiles(event.dataTransfer.files);
  }

  function buildSourceContext() {
    if (!sources.length) {
      return "";
    }

    return [
      "用户上传的资料：",
      ...sources.map((source, index) =>
        [
          `${index + 1}. ${source.name}，类型：${source.kind}，大小：${formatFileSize(source.size)}`,
          source.textSnippet
            ? `文本摘录：${source.textSnippet.slice(0, 1200)}`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
      ),
      "如果资料是图片或二进制文档，当前版本先使用文件名和用户补充的背景进行判断；接入视觉/文档解析模型后再读取内容。",
    ].join("\n");
  }

  async function submitDiscussion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const userQuestion = question.trim();

    if (!userQuestion) {
      setError("请先输入要讨论的问题。");
      return;
    }

    setError("");
    setIsLoading(true);

    const messageSources = [...sources];
    const conversationHistory = messages.slice(-8).map((message) => ({
      role: message.role,
      content: message.content,
      sourceNames: message.sources?.map((source) => source.name),
    }));
    const userMessage: ChatMessage = {
      id: `message-${Date.now()}`,
      role: "user",
      content: userQuestion,
      sources: messageSources,
    };
    setMessages((current) => [...current, userMessage]);

    try {
      const sourceContext = buildSourceContext();
      const response = await fetch("/api/discussions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: userQuestion,
          conversationHistory,
          projectContext: [projectContext.trim(), sourceContext]
            .filter(Boolean)
            .join("\n\n"),
          expertIds: selectedExpertIds,
          customExperts: customExperts.filter((expert) =>
            selectedExpertIds.includes(expert.id),
          ),
          moderatorId,
          provider,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "讨论生成失败。");
      }

      setDiscussion(payload);
      setMessages((current) => [
        ...current,
        {
          id: `message-${Date.now()}-assistant`,
          role: "assistant",
          content: payload.synthesis.summary,
          discussion: payload,
        },
      ]);
      setQuestion("");
      setSources([]);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "讨论生成失败。",
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="header-inner">
          <div className="brand-lockup">
            <div className="brand-mark" aria-hidden="true">
              DC
            </div>
            <div>
              <p className="eyebrow">Design Council AI</p>
              <h1>设计问题，不止一个答案。</h1>
            </div>
          </div>
          <div className="status-group">
            <span className="status-chip">{selectedExperts.length} 位专家</span>
            <span className="status-chip">{messages.length} 条上下文</span>
            <span className="status-chip">{sources.length} 个资料</span>
            <span className="status-chip">
              {provider === "qwen" ? "Qwen Ready" : "Mock Mode"}
            </span>
          </div>
        </div>
      </header>

      <form
        className={`workspace ${
          isRolePanelCollapsed ? "is-role-collapsed" : ""
        } ${isControlPanelCollapsed ? "is-control-collapsed" : ""}`}
        onSubmit={submitDiscussion}
      >
        <section
          className={`panel side-panel role-panel ${
            isRolePanelCollapsed ? "is-collapsed" : ""
          }`}
        >
          {isRolePanelCollapsed ? (
            <button
              aria-label="展开专家席位"
              className="panel-rail"
              type="button"
              onClick={() => setIsRolePanelCollapsed(false)}
            >
              <span className="rail-count">{selectedExperts.length}</span>
              <span>专家</span>
              <span aria-hidden="true">›</span>
            </button>
          ) : (
            <>
              <div className="panel-heading side-panel-heading">
                <div>
                  <h2>专家席位</h2>
                </div>
                <div className="panel-heading-actions">
                  <button
                    aria-label="收起专家席位"
                    className="panel-toggle-button"
                    type="button"
                    onClick={() => setIsRolePanelCollapsed(true)}
                  >
                    <SidebarToggleIcon side="left" />
                  </button>
                </div>
              </div>
              <div className="selected-strip" aria-label="当前参与专家">
                {selectedExperts.map((expert) => (
                  <span key={expert.id}>{expert.name}</span>
                ))}
              </div>
              <div className="role-list">
                {experts.map((expert) => {
                  const isSelected = selectedExpertIds.includes(expert.id);

                  return (
                    <button
                      className={`role-card ${isSelected ? "is-selected" : ""}`}
                      key={expert.id}
                      type="button"
                      onClick={() => toggleExpert(expert.id)}
                    >
                      <div className="role-topline">
                        <div>
                          <p className="role-name">{expert.name}</p>
                          <p className="role-title">{expert.title}</p>
                        </div>
                        <span
                          className={`checkmark ${
                            isSelected ? "is-active" : ""
                          }`}
                          aria-hidden="true"
                        />
                      </div>
                      <p className="role-lens">{expert.lens}</p>
                      <div className="role-focus-tags">
                        {expert.focus.slice(0, 3).map((item) => (
                          <span key={item}>{item}</span>
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>

              {customExperts.length ? (
                <div className="custom-role-section">
                  <div className="subheading">
                    <h3>自定义人物</h3>
                    <span>本地保存</span>
                  </div>
                  <div className="role-list">
                    {customExperts.map((expert) => {
                      const isSelected = selectedExpertIds.includes(expert.id);

                      return (
                        <div
                          className={`role-card custom-role-card ${
                            isSelected ? "is-selected" : ""
                          }`}
                          key={expert.id}
                        >
                          <button
                            className="role-toggle"
                            type="button"
                            onClick={() => toggleExpert(expert.id)}
                          >
                            <div className="role-topline">
                              <div>
                                <p className="role-name">{expert.name}</p>
                                <p className="role-title">{expert.title}</p>
                              </div>
                              <span
                                className={`checkmark ${
                                  isSelected ? "is-active" : ""
                                }`}
                                aria-hidden="true"
                              />
                            </div>
                            <p className="role-lens">{expert.lens}</p>
                            <div className="role-focus-tags">
                              {expert.focus.slice(0, 3).map((item) => (
                                <span key={item}>{item}</span>
                              ))}
                            </div>
                          </button>
                          <button
                            className="text-button"
                            type="button"
                            onClick={() => setDeleteCandidate(expert)}
                          >
                            删除
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div className="custom-role-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={openCustomModal}
                >
                  + 自定义角色
                </button>
              </div>
            </>
          )}
        </section>

        <section className="panel discussion-panel chat-panel">
          <div className="panel-heading discussion-heading">
            <div>
              <h2>圆桌讨论</h2>
            </div>
            <div className="segmented-control">
              {(["mock", "qwen"] as const).map((option) => (
                <button
                  className={provider === option ? "active" : ""}
                  key={option}
                  type="button"
                  onClick={() => setProvider(option)}
                >
                  {option === "mock" ? "Mock" : "Qwen"}
                </button>
              ))}
            </div>
          </div>

          <section className="chat-thread" aria-label="专家圆桌聊天记录">
            {messages.length ? (
              messages.map((message) => (
                <article
                  className={`chat-message ${message.role}`}
                  key={message.id}
                >
                  <div className="message-avatar">
                    {message.role === "user" ? "你" : "议"}
                  </div>
                  <div className="message-body">
                    <p className="message-content">{message.content}</p>
                    {message.sources?.length ? (
                      <div className="source-chip-row">
                        {message.sources.map((source) => (
                          <span className="source-chip" key={source.id}>
                            {source.name}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {message.discussion ? (
                      <div className="assistant-result">
                        <div className="round-list">
                          {message.discussion.expertRounds.map((round) => (
                            <article className="result-card" key={round.expertId}>
                              <div className="result-card-heading">
                                <h3>{round.expertName}</h3>
                                <p>{round.title}</p>
                              </div>
                              <div className="result-grid">
                                <p>
                                  <strong>立场：</strong>
                                  {round.stance}
                                </p>
                                <p>
                                  <strong>风险：</strong>
                                  {round.concern}
                                </p>
                                <p>
                                  <strong>建议：</strong>
                                  {round.recommendation}
                                </p>
                                <p>
                                  <strong>取舍：</strong>
                                  {round.tradeoff}
                                </p>
                              </div>
                            </article>
                          ))}
                        </div>

                        <article className="synthesis-card">
                          <h3>主持人综合</h3>
                          <p>{message.discussion.synthesis.summary}</p>
                          {message.discussion.synthesis.decisions.length ? (
                            <ul>
                              {message.discussion.synthesis.decisions.map(
                                (item) => (
                                  <li key={item}>{item}</li>
                                ),
                              )}
                            </ul>
                          ) : null}
                        </article>
                      </div>
                    ) : null}
                  </div>
                </article>
              ))
            ) : (
              <div className="empty-chat">
                <p className="empty-eyebrow">Design Council AI</p>
                <h3>召集一个设计评审会</h3>
                <p>先抛出问题，专家会从不同判断框架给出分歧、共识和行动建议。</p>
                <div className="empty-suggestions">
                  <button
                    type="button"
                    onClick={() =>
                      setQuestion("请从 UX、视觉和开发成本角度评审这个方案。")
                    }
                  >
                    评审方案
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setQuestion("这个设计在落地开发时有哪些风险？")
                    }
                  >
                    看开发风险
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setQuestion("如果老板看这个设计，可能会挑什么问题？")
                    }
                  >
                    模拟老板视角
                  </button>
                </div>
              </div>
            )}
          </section>

          {error ? <p className="error-message">{error}</p> : null}

          <div
            className={`composer-shell ${
              isDraggingSources ? "is-dragging" : ""
            }`}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <div className="composer-drag-hint">
              <strong>松手添加附件</strong>
              <span>图片和文件会加入本轮对话</span>
            </div>
            <input
              accept="image/*,.pdf,.doc,.docx,.md,.txt,.csv,.json"
              className="hidden-file-input"
              multiple
              ref={fileInputRef}
              type="file"
              onChange={handleSourceInputChange}
            />
            {sources.length ? (
              <div className="composer-sources">
                {sources.map((source) => (
                  <span className="attachment-pill" key={source.id}>
                    <span
                      className="attachment-thumb"
                      style={
                        source.previewUrl
                          ? {
                              backgroundImage: `url(${source.previewUrl})`,
                            }
                          : undefined
                      }
                    >
                      {source.previewUrl ? "" : source.kind.toUpperCase()}
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
            ) : null}
            <div className="composer-row">
              <button
                aria-label="添加来源"
                className="composer-add"
                type="button"
                onClick={() => fileInputRef.current?.click()}
              >
                +
              </button>
              <textarea
                className="composer-input"
                placeholder="输入你想让专家圆桌讨论的问题"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <button
                className="composer-send"
                disabled={isLoading || selectedExperts.length === 0}
                type="submit"
              >
                {isLoading ? "生成中" : "发送"}
              </button>
            </div>
          </div>
        </section>

        <aside
          className={`panel side-panel control-panel ${
            isControlPanelCollapsed ? "is-collapsed" : ""
          }`}
        >
          {isControlPanelCollapsed ? (
            <button
              aria-label="展开会议设置"
              className="panel-rail"
              type="button"
              onClick={() => setIsControlPanelCollapsed(false)}
            >
              <span className="rail-count">设</span>
              <span>设置</span>
              <span aria-hidden="true">‹</span>
            </button>
          ) : (
            <>
              <div className="panel-heading side-panel-heading">
                <div>
                  <h2>会议设置</h2>
                </div>
                <button
                  aria-label="收起会议设置"
                  className="panel-toggle-button"
                  type="button"
                  onClick={() => setIsControlPanelCollapsed(true)}
                >
                  <SidebarToggleIcon side="right" />
                </button>
              </div>
              <div className="control-block">
                <p className="control-label">本轮引擎</p>
                <div className="engine-list">
                  <span>{provider === "qwen" ? "Qwen" : "Local Mock"}</span>
                  <span>{selectedExperts.length} perspectives</span>
                  <span>{sources.length} attachments</span>
                </div>
              </div>

              <div className="control-block">
                <p className="control-label">主持模式</p>
                <div className="moderator-list">
                  {moderatorModes.map((mode) => (
                    <button
                      className={`moderator-card ${
                        moderatorId === mode.id ? "is-selected" : ""
                      }`}
                      key={mode.id}
                      type="button"
                      onClick={() => setModeratorId(mode.id)}
                    >
                      <p>{mode.name}</p>
                      <span>{mode.description}</span>
                    </button>
                  ))}
                </div>
              </div>

              {discussion ? (
                <div className="prompt-panel">
                  <p className="control-label">提示词预览</p>
                  <pre>{discussion.promptPreview}</pre>
                </div>
              ) : null}
            </>
          )}
        </aside>

        {isCustomModalOpen ? (
          <div className="modal-backdrop" role="presentation">
            <section
              aria-labelledby="custom-role-title"
              aria-modal="true"
              className="modal-card"
              role="dialog"
            >
              <div className="modal-header">
                <div>
                  <p className="eyebrow">Custom Expert</p>
                  <h2 id="custom-role-title">新增自定义角色</h2>
                </div>
                <button
                  aria-label="关闭弹窗"
                  className="icon-button"
                  type="button"
                  onClick={closeCustomModal}
                >
                  ×
                </button>
              </div>
              <label className="compact-field">
                <span>角色名称</span>
                <input
                  autoFocus
                  placeholder="例如：蒸馏版老板"
                  value={customDraft.name}
                  onChange={(event) =>
                    updateCustomDraft("name", event.target.value)
                  }
                />
              </label>
              <label className="compact-field">
                <span>角色标签</span>
                <input
                  placeholder="例如：成本敏感型决策者"
                  value={customDraft.title}
                  onChange={(event) =>
                    updateCustomDraft("title", event.target.value)
                  }
                />
              </label>
              <label className="compact-field">
                <span>判断视角</span>
                <textarea
                  placeholder="例如：会特别关注页面是否显得高级、是否容易被老板理解、是否会增加开发排期。"
                  value={customDraft.lens}
                  onChange={(event) =>
                    updateCustomDraft("lens", event.target.value)
                  }
                />
              </label>
              <label className="compact-field">
                <span>性格偏好</span>
                <textarea
                  placeholder="例如：直接、挑剔、预算敏感，但喜欢看起来有面子的方案。"
                  value={customDraft.temperament}
                  onChange={(event) =>
                    updateCustomDraft("temperament", event.target.value)
                  }
                />
              </label>
              <label className="compact-field">
                <span>高级 Prompt</span>
                <textarea
                  placeholder="可选：以后可以放蒸馏人物模型的完整设定。"
                  value={customDraft.systemPrompt}
                  onChange={(event) =>
                    updateCustomDraft("systemPrompt", event.target.value)
                  }
                />
              </label>
              {customError ? <p className="custom-error">{customError}</p> : null}
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
                  添加角色
                </button>
              </div>
            </section>
          </div>
        ) : null}

        {deleteCandidate ? (
          <div className="modal-backdrop" role="presentation">
            <section
              aria-labelledby="delete-role-title"
              aria-modal="true"
              className="modal-card confirm-card"
              role="dialog"
            >
              <div className="modal-header">
                <div>
                  <p className="eyebrow danger-eyebrow">Delete Expert</p>
                  <h2 id="delete-role-title">确认删除自定义角色？</h2>
                </div>
                <button
                  aria-label="关闭弹窗"
                  className="icon-button"
                  type="button"
                  onClick={() => setDeleteCandidate(null)}
                >
                  ×
                </button>
              </div>
              <p className="confirm-copy">
                删除后，“{deleteCandidate.name}” 会从本地自定义角色中移除。
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
        ) : null}
      </form>
    </main>
  );
}

function getSourceKind(file: File): SourceItem["kind"] {
  if (file.type.startsWith("image/")) {
    return "image";
  }

  if (
    file.type.includes("pdf") ||
    file.type.includes("word") ||
    file.name.endsWith(".doc") ||
    file.name.endsWith(".docx")
  ) {
    return "document";
  }

  if (
    file.type.startsWith("text/") ||
    file.name.endsWith(".md") ||
    file.name.endsWith(".json") ||
    file.name.endsWith(".csv")
  ) {
    return "text";
  }

  return "file";
}

function formatFileSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function SidebarToggleIcon({ side }: { side: "left" | "right" }) {
  const dividerX = side === "left" ? 9 : 15;

  return (
    <svg
      aria-hidden="true"
      className="panel-toggle-svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <rect
        height="15.5"
        rx="4"
        stroke="currentColor"
        strokeWidth="1.7"
        width="16"
        x="4"
        y="4.25"
      />
      <path
        d={`M${dividerX} 8v8`}
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}
