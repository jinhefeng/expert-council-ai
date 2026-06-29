import { getDecisionOptions } from "@/lib/model-router";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      question,
      projectContext,
      conversationHistory,
      synthesisSummary,
      engineConfig,
      llmParams,
      systemPrompts,
    } = body;

    if (!question || !synthesisSummary) {
      return Response.json({ error: "question and synthesisSummary are required" }, { status: 400 });
    }

    let options: string[] = [];
    try {
      options = await getDecisionOptions({
        question,
        projectContext,
        conversationHistory: conversationHistory || [],
        synthesisSummary,
        engineConfig,
        llmParams: llmParams || undefined,
        systemPrompts: systemPrompts || undefined,
      });
    } catch (error: any) {
      console.warn("[decision-options] 大模型决策方案生成失败，已自动降级为本地默认备选项:", error.message || error);
      options = [
        "方向一：维持现状，进一步观测和评估指标细节",
        "方向二：折中改进，在局部实施优化以规避最严重风险",
        "方向三：全面重构，按专家的最高标准建议执行"
      ];
    }

    return Response.json({ options });
  } catch (error) {
    console.error("[decision-options] 路由处理核心层严重异常:", error);
    return Response.json({ 
      options: [
        "方向一：维持现状，进一步观测和评估指标细节",
        "方向二：折中改进，在局部实施优化以规避最严重风险",
        "方向三：全面重构，按专家的最高标准建议执行"
      ] 
    }, { status: 200 });
  }
}
