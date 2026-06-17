// 本接口在圆桌会议重构为“流式单步大模型编排”后已废弃。
// 请使用 /api/discussions/expert-turn 等更小粒度的接口。

export async function POST() {
  return Response.json(
    {
      error: "This legacy endpoint has been deprecated. Please use /api/discussions/expert-turn instead.",
    },
    { status: 410 }
  );
}
