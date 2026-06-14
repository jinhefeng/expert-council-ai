import { NextResponse } from "next/server";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token")?.trim();

    if (!token) {
      return NextResponse.json(
        { success: false, error: "缺少 token 参数" },
        { status: 400 }
      );
    }

    const botConnections = global.wsRelayBotConnections;
    if (!botConnections) {
      return NextResponse.json({
        success: false,
        status: "offline",
        error: "WebSocket 网关尚未初始化，请稍后重试"
      });
    }

    const ws = botConnections.get(token);
    // readyState === 1 代表 WebSocket.OPEN
    if (ws && ws.readyState === 1) {
      return NextResponse.json({
        success: true,
        status: "online"
      });
    }

    return NextResponse.json({
      success: false,
      status: "offline",
      error: "未检测到活跃连接。请确保客户端已运行且配置了正确的 Token"
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "内部服务器异常" },
      { status: 500 }
    );
  }
}
