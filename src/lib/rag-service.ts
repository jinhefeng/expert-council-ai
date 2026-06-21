// 对接外部 RAG 数据库向量检索服务
export async function getRelevantChunks(
  expert: {
    ragEnabled?: boolean;
    ragEndpoint?: string;
    ragToken?: string;
    ragDatasetId?: string;
  },
  query: string
): Promise<string> {
  if (expert.ragEnabled && expert.ragEndpoint) {
    try {
      console.log(`[RAG] 正在发起外部 RAG 检索: ${expert.ragEndpoint}`);
      const response = await fetch(expert.ragEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": expert.ragToken ? `Bearer ${expert.ragToken}` : "",
        },
        body: JSON.stringify({
          query: query,
          datasetId: expert.ragDatasetId || "",
          topK: 3,
        }),
        signal: AbortSignal.timeout(5000), // 5秒超时强阻断
      });

      if (response.ok) {
        const data = await response.json();
        const chunks: string[] = data.chunks || data.results?.map((r: any) => r.text) || [];
        if (chunks.length > 0) {
          return chunks.join("\n\n---\n\n");
        }
      }
      console.warn(`[RAG Warning] 外部 RAG 无返回，HTTP 状态码: ${response.status}`);
    } catch (e) {
      console.error("[RAG Error] 外部 RAG 数据库连接异常，直接返回空", e);
    }
  }

  return "";
}
