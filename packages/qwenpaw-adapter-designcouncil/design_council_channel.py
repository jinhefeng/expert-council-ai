import asyncio
import json
import websockets
from typing import Any, Optional

from qwenpaw.app.channels.base import BaseChannel
from qwenpaw.app.channels.schema import AgentRequest
from qwenpaw.app.channels.schema import ChannelType

class DesignCouncilChannel(BaseChannel):
    # 注册频道标识符
    channel: ChannelType = "design_council"

    def __init__(self, server_url: str, bot_token: str, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.server_url = server_url
        self.bot_token = bot_token
        self.ws: Optional[websockets.WebSocketClientProtocol] = None
        self.running = False
        self.listener_task: Optional[asyncio.Task] = None

    @classmethod
    def from_config(cls, config: dict) -> "DesignCouncilChannel":
        """从 settings.json 的配置初始化"""
        return cls(
            server_url=config.get("serverUrl", "ws://localhost:18788/bot"),
            bot_token=config.get("botToken", "")
        )

    async def start(self) -> None:
        """启动频道，建立与 Design Council 平台的 WebSocket 长连接"""
        self.running = True
        self.listener_task = asyncio.create_task(self._websocket_loop())
        print(f"[QwenPaw-Channel] DesignCouncil 频道已启动，正长连接至 {self.server_url} ...")

    async def stop(self) -> None:
        """停止频道，关闭 WebSocket 连接"""
        self.running = False
        if self.ws:
            await self.ws.close()
        if self.listener_task:
            self.listener_task.cancel()
            try:
                await self.listener_task
            except asyncio.CancelledError:
                pass
        print("[QwenPaw-Channel] DesignCouncil 频道已停止。")

    async def _websocket_loop(self) -> None:
        uri = f"{self.server_url}?token={self.bot_token}"
        while self.running:
            try:
                async with websockets.connect(uri) as websocket:
                    self.ws = websocket
                    print("[QwenPaw-Channel] WebSocket 连接建立成功，已注册为圆桌会议专家！")
                    
                    async for message in websocket:
                        try:
                            payload = json.loads(message)
                            if payload.get("event") == "turn.active":
                                # 接收到会议发言令牌，转换为 QwenPaw 的规范请求
                                agent_request = self.build_agent_request_from_native(payload)
                                # 派发给 QwenPaw 内部的 AgentRunner 执行推理
                                # 这会最终触发本类的 self.send() 逻辑
                                await self.handle_message(agent_request)
                        except json.JSONDecodeError:
                            print(f"[QwenPaw-Channel] 接收到非法的 JSON 帧: {message}")
                        except Exception as e:
                            print(f"[QwenPaw-Channel] 处理会议消息发生异常: {e}")
            except (websockets.ConnectionClosed, ConnectionRefusedError):
                if self.running:
                    print("[QwenPaw-Channel] WebSocket 连接断开，将在 5 秒后尝试自动重连...")
                    await asyncio.sleep(5)
            except Exception as e:
                if self.running:
                    print(f"[QwenPaw-Channel] WebSocket 连接异常: {e}，将在 5 秒后重试...")
                    await asyncio.sleep(5)

    def build_agent_request_from_native(self, native_payload: dict) -> AgentRequest:
        """
        核心抽象方法实现：将 Design Council 原始数据帧格式化为 QwenPaw 的标准请求对象
        """
        data = native_payload.get("data", {})
        question = data.get("question", "")
        context = data.get("context", "")
        previous_turns = data.get("previousTurns", [])
        turn_id = data.get("turnId")
        meeting_id = data.get("meetingId", "default-meeting")

        # 归一化输入，拼接对话上下文，引导小龙虾进行答复
        prompt = (
            f"当前评审议题：{question}\n"
            f"项目背景：{context}\n"
            f"此前会议发言：\n"
        )
        for t in previous_turns:
            prompt += f"【{t.get('expertName')}】：{t.get('content')}\n"

        prompt += (
            "\n请针对上述讨论，发表您的专家评审意见。请使用简体中文进行专业且具有对抗性的回答。\n"
            "【思维链指引】：如果您的模型支持推理/思考（Reasoning/Thinking），请将您的完整思考和推理过程输出在 `<think>...</think>` 标签内，随后再输出您的正式评审意见。\n"
            "在回答的最后，必须附带如下格式的纯 JSON 结构化摘要：\n"
            "```json\n"
            "{\n"
            '  "stance": "您的核心立场",\n'
            '  "concern": "最担忧的风险",\n'
            '  "recommendation": "具体可落地建议",\n'
            '  "tradeoff": "做此项决策必须付出的取舍"\n'
            "}\n"
            "```"
        )

        # 封装为规范的 AgentRequest 传入引擎
        return AgentRequest(
            content=prompt,
            session_id=meeting_id,
            user_id=turn_id,  # 巧用 user_id 来暂存 turn_id，以便 send() 方法取回并送回平台
            meta={
                "meeting_id": meeting_id,
                "turn_id": turn_id
            }
        )

    async def send(self, to_handle: str, text: str, meta: Optional[dict] = None) -> None:
        """
        核心抽象方法实现：将智能体(Qwen)推理完成后的最终发言，回传给 Design Council 平台
        to_handle 即为我们在 build_agent_request_from_native 中存入的 turn_id
        """
        if not self.ws:
            print("[QwenPaw-Channel] 发送失败：WebSocket 连接不可用")
            return

        try:
            # 1. 尝试从 meta 中检测并提取思维链 / 推理内容，自动为外部智能体封装标准的 <think> 标签
            thought = ""
            if meta and isinstance(meta, dict):
                # 兼容 QwenPaw/AgentScope 常见的推理字段
                for k in ["thought", "reasoning_content", "thinking", "reasoning", "thinking_content"]:
                    v = meta.get(k)
                    if v and isinstance(v, str):
                        thought = v.strip()
                        break

            # 组装最终回传的文本。如果有提取出的思维链，且 text 不以 <think> 开头，则为其套上 <think> 标签并拼接
            clean_text = text or ""
            if thought and not clean_text.strip().startswith("<think>"):
                full_text = f"<think>\n{thought}\n</think>\n\n{clean_text}"
            else:
                full_text = clean_text

            # 2. 回传最终文本内容
            await self.ws.send(json.dumps({
                "event": "reply.chunk",
                "data": {
                    "turnId": to_handle,
                    "chunk": full_text
                }
            }))
            
            # 2. 发送发言结束信号 (Reply Done)
            await self.ws.send(json.dumps({
                "event": "reply.done",
                "data": {
                    "turnId": to_handle
                }
            }))
            print(f"[QwenPaw-Channel] 发言完毕，回传内容成功。轮次ID: {to_handle}")
        except Exception as e:
            print(f"[QwenPaw-Channel] 回传消息至平台发生异常: {e}")
