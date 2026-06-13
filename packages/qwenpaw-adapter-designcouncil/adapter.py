import asyncio
import json
import websockets
import sys

# 假设用户安装了 agentscope 库
try:
    import agentscope
    from agentscope.agents import UserAgent, DialogAgent
    HAS_AGENTSCOPE = True
except ImportError:
    HAS_AGENTSCOPE = False

class DesignCouncilQwenPawAdapter:
    def __init__(self, server_url, bot_token, agent_name="QwenPaw"):
        self.server_url = server_url
        self.bot_token = bot_token
        self.agent_name = agent_name
        self.agent = None

        if HAS_AGENTSCOPE:
            # 初始化一个基础的 AgentScope 对话智能体
            # 注意：实际生产中需要根据 config 初始化具体的 LLM 模型，如通义千问 (Qwen)
            self.agent = DialogAgent(
                name=agent_name,
                sys_prompt="你是一名来自通义千问生态的资深评审专家(QwenPaw)。请以客观、严谨、建设性的态度提供方案评审意见。",
                model_config_name="qwen_config"  # 假定在本地已配置 qwen 模型连接
            )
        else:
            print("[QwenPaw-Adapter] 警告: 未在当前 Python 环境中检测到 agentscope 依赖。将采用模拟推理输出。")

    async def start(self):
        uri = f"{self.server_url}?token={self.bot_token}"
        print(f"[QwenPaw-Adapter] 正在连接至 Design Council 平台 WebSocket: {uri} ...")
        
        while True:
            try:
                async with websockets.connect(uri) as websocket:
                    print("[QwenPaw-Adapter] WebSocket 连接建立成功！")
                    async for message in websocket:
                        payload = json.loads(message)
                        if payload.get("event") == "turn.active":
                            await self.handle_turn(websocket, payload.get("data", {}))
            except websockets.ConnectionClosed:
                print("[QwenPaw-Adapter] WebSocket 连接断开，将在 5 秒后重试...")
                await asyncio.sleep(5)
            except Exception as e:
                print(f"[QwenPaw-Adapter] 连接异常: {e}，将在 5 秒后重试...")
                await asyncio.sleep(5)

    async def handle_turn(self, websocket, data):
        # data: { meetingId, turnId, question, context, previousTurns }
        turn_id = data.get("turnId")
        question = data.get("question")
        context = data.get("context", "")
        previous_turns = data.get("previousTurns", [])

        print(f"[QwenPaw-Adapter] 收到发言令牌. 会议ID: {data.get('meetingId')}, 轮次ID: {turn_id}")

        # 拼接提供给模型的消息
        prompt = (
            f"当前评审议题：{question}\n"
            f"项目背景：{context}\n"
            f"此前会议发言：\n"
        )
        for t in previous_turns:
            prompt += f"【{t.get('expertName')}】：{t.get('content')}\n"

        prompt += "\n请对该方案进行评审，并用中文给出修改意见。在发言末尾，必须输出如下结构化 JSON 摘要：\n"
        prompt += '```json\n{\n  "stance": "您的核心立场",\n  "concern": "最担忧的风险",\n  "recommendation": "可落地建议",\n  "tradeoff": "为了做这个决策需要付出的牺牲/妥协"\n}\n```'

        # 模拟/调用 Agent 思考并流式返回
        if self.agent:
            # 真实对接 AgentScope 推理
            from agentscope.message import Msg
            msg = Msg("user", content=prompt)
            # 假设 model 支持 stream 生成
            response_msg = self.agent(msg)
            reply_text = response_msg.content
            
            # 由于此处是真实生成，可以将其分块流式传输以获得打字机效果
            # 下面为简化处理，做每 10 字符一次的切片模拟流式传输
            chunk_size = 10
            for i in range(0, len(reply_text), chunk_size):
                chunk = reply_text[i:i+chunk_size]
                await websocket.send(json.dumps({
                    "event": "reply.chunk",
                    "data": {
                        "turnId": turn_id,
                        "chunk": chunk
                    }
                }))
                await asyncio.sleep(0.05)
        else:
            # 无 AgentScope 时 fallback 到模拟流式输出
            mock_text = (
                f"我是外部接入的 QwenPaw 专家。对于议题【{question}】，我建议：\n"
                "1. 加强对流式连接异常状况的边缘情况容错，避免连接丢失导致 UI 挂起。\n"
                "2. 保持会话的轻量与幂等性。\n\n"
                "```json\n"
                "{\n"
                '  "stance": "支持流式对接方案",\n'
                '  "concern": "WebSocket 长连接容易受到断网影响",\n'
                '  "recommendation": "增加重连机制和心跳保活检测",\n'
                '  "tradeoff": "需要在客户端和服务端额外维护连接心跳"\n'
                "}\n"
                "```"
            )
            chunk_size = 15
            for i in range(0, len(mock_text), chunk_size):
                chunk = mock_text[i:i+chunk_size]
                await websocket.send(json.dumps({
                    "event": "reply.chunk",
                    "data": {
                        "turnId": turn_id,
                        "chunk": chunk
                    }
                }))
                await asyncio.sleep(0.03)

        # 结束标记发送
        await websocket.send(json.dumps({
            "event": "reply.done",
            "data": {
                "turnId": turn_id
            }
        }))
        print(f"[QwenPaw-Adapter] 发言回复完成: {turn_id}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("使用方式: python adapter.py <dc_bot_token> [server_websocket_url]")
        sys.exit(1)
        
    token = sys.argv[1]
    url = sys.argv[2] if len(sys.argv) > 2 else "ws://localhost:18788/bot"
    
    adapter = DesignCouncilQwenPawAdapter(url, token)
    asyncio.run(adapter.start())
