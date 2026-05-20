"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { experts, moderatorModes, type Expert } from "@/lib/experts";
import type { DiscussionResponse } from "@/lib/model-router";

const CUSTOM_EXPERTS_STORAGE_KEY = "design-council-custom-experts";
const MAX_SELECTED_EXPERTS = 5;

export default function Home() {
  const [selectedExpertIds, setSelectedExpertIds] = useState([
    "ux-researcher",
    "brand-strategist",
    "growth-designer",
  ]);
  const [question, setQuestion] = useState(
    "这个 SaaS 首页首屏应该怎么评审？",
  );
  const [projectContext, setProjectContext] = useState("");
  const [moderatorId, setModeratorId] = useState("balanced");
  const [provider, setProvider] = useState<"mock" | "qwen">("mock");
  const [discussion, setDiscussion] = useState<DiscussionResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [customError, setCustomError] = useState("");
  const [customExperts, setCustomExperts] = useState<Expert[]>([]);
  const [isCustomModalOpen, setIsCustomModalOpen] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<Expert | null>(null);
  const [customDraft, setCustomDraft] = useState({
    name: "",
    title: "",
    lens: "",
    temperament: "",
    systemPrompt: "",
  });

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

      if (current.length >= MAX_SELECTED_EXPERTS) {
        return current;
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
    setSelectedExpertIds((current) =>
      current.length < MAX_SELECTED_EXPERTS ? [...current, expert.id] : current,
    );
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

  async function submitDiscussion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/discussions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          projectContext,
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
          <div>
            <p className="eyebrow">Design Council AI</p>
            <h1>设计专家圆桌</h1>
          </div>
          <div className="status-group">
            <span className="status-chip">{selectedExperts.length} 位专家</span>
            <span className="status-chip">
              {provider === "qwen" ? "Qwen Ready" : "Mock Mode"}
            </span>
          </div>
        </div>
      </header>

      <form className="workspace" onSubmit={submitDiscussion}>
        <section className="panel">
          <div className="panel-heading">
            <h2>专家角色</h2>
            <span>最多 {MAX_SELECTED_EXPERTS} 位</span>
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
                      className={`checkmark ${isSelected ? "is-active" : ""}`}
                      aria-hidden="true"
                    />
                  </div>
                  <p className="role-lens">{expert.lens}</p>
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
              添加自定义角色
            </button>
          </div>
        </section>

        <section className="panel discussion-panel">
          <div className="panel-heading discussion-heading">
            <h2>本次讨论</h2>
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

          <label className="field">
            <span>设计问题</span>
            <textarea
              className="textarea question-input"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
            />
          </label>

          <label className="field">
            <span>项目背景</span>
            <textarea
              className="textarea context-input"
              placeholder="品牌、用户、页面类型、目标、限制条件"
              value={projectContext}
              onChange={(event) => setProjectContext(event.target.value)}
            />
          </label>

          {error ? <p className="error-message">{error}</p> : null}

          <div className="action-row">
            <p>
              当前：
              {selectedExperts.map((expert) => expert.name).join("、")}
            </p>
            <button
              className="primary-button"
              disabled={isLoading || selectedExperts.length === 0}
              type="submit"
            >
              {isLoading ? "生成中" : "开始讨论"}
            </button>
          </div>

          {discussion ? (
            <section className="result-section">
              {discussion.note ? (
                <p className="note-message">{discussion.note}</p>
              ) : null}

              <div className="round-list">
                {discussion.expertRounds.map((round) => (
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
                <p>{discussion.synthesis.summary}</p>
                {discussion.synthesis.decisions.length ? (
                  <ul>
                    {discussion.synthesis.decisions.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </article>
            </section>
          ) : null}
        </section>

        <aside className="panel">
          <h2>主持模式</h2>
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

          {discussion ? (
            <div className="prompt-panel">
              <h2>Prompt</h2>
              <pre>{discussion.promptPreview}</pre>
            </div>
          ) : null}
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
