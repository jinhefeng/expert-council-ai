import asyncio
import json
import websockets
import re
from typing import Any, Optional, Dict

from qwenpaw.app.channels.base import BaseChannel
try:
    from qwenpaw.app.channels.schema import AgentRequest
except ImportError:
    from agentscope_runtime.engine.schemas.agent_schemas import AgentRequest
from qwenpaw.app.channels.schema import ChannelType


def extract_expert_stance_from_json(json_str: str) -> dict:
    s = json_str.strip()
    if s.startswith("```"):
        lines = s.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        s = "\n".join(lines).strip()

    first_brace = s.find("{")
    if first_brace == -1:
        return {}

    s = s[first_brace:]
    quote_count = 0
    escaped = False
    for char in s:
        if char == '\\':
            escaped = not escaped
            continue
        if char == '"' and not escaped:
            quote_count += 1
        escaped = False

    if quote_count % 2 != 0:
        s += '"'

    open_braces = s.count("{")
    close_braces = s.count("}")
    if open_braces > close_braces:
        s += "}" * (open_braces - close_braces)

    try:
        data = json.loads(s)
        if isinstance(data, dict):
            return {
                "stance": data.get("stance", "暂无立场摘要"),
                "concern": data.get("concern", "暂无风险摘要"),
                "recommendation": data.get("recommendation", "暂无建议摘要"),
                "tradeoff": data.get("tradeoff", "暂无取舍摘要")
            }
    except Exception:
        pass

    def regex_extract(field):
        pattern = rf'"{field}"\s*:\s*"([^"]+)"'
        match = re.search(pattern, s)
        if match:
            return match.group(1)
        partial_pattern = rf'"{field}"\s*:\s*"([^"]*)$'
        partial_match = re.search(partial_pattern, s)
        if partial_match:
            return partial_match.group(1)
        return ""

    return {
        "stance": regex_extract("stance") or "暂无立场摘要",
        "concern": regex_extract("concern") or "暂无风险摘要",
        "recommendation": regex_extract("recommendation") or "暂无建议摘要",
        "tradeoff": regex_extract("tradeoff") or "暂无取舍摘要"
    }


def extract_stance_from_full_text(text: str) -> tuple[dict, str]:
    """
    从全文本中提取立场卡片，并返回 (立场字典, 清洗后的文本)
    """
    if not text:
        return {}, ""
    # 1. 尝试匹配 ```json ... ```
    pattern = r"```json\s*(.*?)\s*(?:```|$)"
    matches = list(re.finditer(pattern, text, re.DOTALL))
    if matches:
        last_match = matches[-1]
        json_str = last_match.group(1)
        clean_text = text[:last_match.start()] + text[last_match.end():]
        return extract_expert_stance_from_json(json_str), clean_text.strip()
    
    # 2. 如果没匹配到 ```json，尝试找最后一个 {
    idx = text.rfind("{")
    if idx != -1:
        json_str = text[idx:]
        clean_text = text[:idx]
        return extract_expert_stance_from_json(json_str), clean_text.strip()
        
    return {}, text


class AgentCouncilChannel(BaseChannel):
    # 注册频道标识符
    channel: ChannelType = "agent_council"

    def __init__(self, server_url: str, bot_token: str, streaming_enabled: bool = True, process: Any = None, **kwargs: Any) -> None:
        kwargs.pop("workspace_dir", None)
        super().__init__(process=process, streaming_enabled=streaming_enabled, **kwargs)
        self.server_url = server_url
        self.bot_token = bot_token
        self.ws: Optional[websockets.WebSocketClientProtocol] = None
        self.running = False
        self.listener_task: Optional[asyncio.Task] = None
        self._has_sent_think_open = {}  # 保存每个 turn_id/to_handle 是否已发送首部 <think> 的状态
        self._prompt_cache = {}  # 缓存最终喂给大模型的最终拼装 Prompt，以便 reply.done 配合回传
        self._has_received_message = {}  # 记录每个 turn_id 是否已接收到 message 正文流量


    @classmethod
    def from_config(cls, config: Any, process: Any = None, **kwargs: Any) -> "AgentCouncilChannel":
        """从 settings.json 或 config.json 的配置初始化"""
        cfg_dict = config if isinstance(config, dict) else getattr(config, "__dict__", {})
        if not isinstance(cfg_dict, dict):
            try:
                cfg_dict = config.model_dump()
            except Exception:
                try:
                    cfg_dict = {k: getattr(config, k) for k in getattr(config, "model_fields", {})}
                except Exception:
                    cfg_dict = {}

        server_url = cfg_dict.get("server_url") or cfg_dict.get("serverUrl") or "ws://localhost:18788/bot"
        bot_token = cfg_dict.get("bot_token") or cfg_dict.get("botToken") or ""
        streaming_enabled = cfg_dict.get("streaming_enabled", cfg_dict.get("streamingEnabled", True))

        return cls(
            server_url=server_url,
            bot_token=bot_token,
            streaming_enabled=streaming_enabled,
            process=process,
            **kwargs
        )

    async def start(self) -> None:
        """启动频道，建立与 Agent Council 平台的 WebSocket 长连接"""
        self.running = True
        self.listener_task = asyncio.create_task(self._websocket_loop())
        print(f"[QwenPaw-Channel] Agent Council 频道已启动，正长连接至 {self.server_url} ...")

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
        print("[QwenPaw-Channel] Agent Council 频道已停止。")

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
                            if payload.get("event") == "turn.request":
                                # 接收到会议发言令牌，转换为 QwenPaw 的规范请求
                                agent_request = self.build_agent_request_from_native(payload)
                                # 派发给 QwenPaw 内部的 UnifiedQueueManager 队列
                                if self._enqueue is not None:
                                    self._enqueue(agent_request)
                                else:
                                    await self.consume_one(agent_request)
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
        核心方法实现：将 Agent Council 原始数据帧格式化为 QwenPaw 的标准请求对象
        """
        data = native_payload.get("data", {})
        question = data.get("question", "")
        context = data.get("context", "")
        previous_turns = data.get("previousTurns", [])
        turn_id = data.get("turnId")
        meeting_id = data.get("meetingId", "default-meeting")
        expert_name = data.get("expertName") or "未知专家"
        expert_title = data.get("expertTitle") or "未知头衔"
        external_prompt_tpl = data.get("externalAgentPrompt")
        user_title = data.get("userTitle") or "首席决策官"
        user_name = data.get("userName") or "主持人"

        # 整理以往会议发言拼接文本
        previous_turns_text = ""
        for t in previous_turns:
            content = t.get('content') or ""
            # 清除思维链及其标签内容
            content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL)
            if "<think>" in content:
                idx = content.find("<think>")
                content = content[:idx]
            
            t_name = t.get('expertName') or "未知专家"
            t_title = t.get('expertTitle') or "未知头衔"
            previous_turns_text += (
                f"┌──────────────────────────────────────────\n"
                f"│ 参会专家发言观点：{t_name} ({t_title})\n"
                f"└──────────────────────────────────────────\n"
                f"{content.strip()}\n\n"
            )
        
        if not previous_turns_text:
            previous_turns_text = "本轮中你是第一个发言的专家。"
        else:
            previous_turns_text = previous_turns_text.strip()

        if external_prompt_tpl and external_prompt_tpl.strip():
            # 动态替换模板中的占位符
            prompt = external_prompt_tpl
            prompt = prompt.replace("{question}", question)
            prompt = prompt.replace("{context}", context)
            prompt = prompt.replace("{previousTurns}", previous_turns_text)
            prompt = prompt.replace("{expertName}", expert_name)
            prompt = prompt.replace("{expertTitle}", expert_title)
            prompt = prompt.replace("{userTitle}", user_title)
            prompt = prompt.replace("{userName}", user_name)
        else:
            # 平滑降级至默认硬编码拼接格式
            prompt = (
                f"你当前在会议中扮演的角色是【{expert_name}】，核心头衔是【{expert_title}】。\n"
                f"当前来自人类决策者（{user_title} {user_name}）的现场干预与最新指令：\n{question}\n"
                f"项目背景：{context}\n"
                f"此前会议发言：\n{previous_turns_text}\n"
            )
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

        # 缓存拼好的最终 Prompt
        self._prompt_cache[turn_id] = prompt
        
        # 封装为规范 of AgentRequest 传入引擎，对齐 QwenPaw 联合主键会话机制
        from agentscope_runtime.engine.schemas.agent_schemas import TextContent, ContentType
        content_parts = [TextContent(type=ContentType.TEXT, text=prompt)]
        agent_request = self.build_agent_request_from_user_content(
            channel_id=self.channel,
            sender_id=meeting_id,  # 设为唯一 meeting_id，不再使用变化轮次的 turn_id
            session_id=meeting_id, # session_id 同样为唯一 meeting_id，确保在 qwenpaw 中显示为同一个 Chat 会话
            content_parts=content_parts
        )
        # 动态绑定当前真实的 turn_id 属性，以便发送路由
        agent_request.turn_id = turn_id
        return agent_request

    def get_to_handle_from_request(self, request: "AgentRequest") -> str:
        """重写父类虚方法，优先提取我们动态绑定的 turn_id 作为目标 to_handle"""
        return getattr(request, "turn_id", None) or getattr(request, "user_id", "") or ""

    async def on_streaming_start(
        self,
        request: "AgentRequest",
        to_handle: str,
        event: Any,
        send_meta: Dict[str, Any],
        stream_type: str,
        accumulated_text: str = "",
    ) -> None:
        """当流式片段开始时的回调"""
        if stream_type == "message":
            self._has_received_message[to_handle] = True

    async def on_streaming_delta(
        self,
        request: "AgentRequest",
        to_handle: str,
        event: Any,
        send_meta: Dict[str, Any],
        stream_type: str,
        accumulated_text: str = "",
    ) -> None:
        """当流式产生新的增量 Token 时的回调"""
        if not self.ws:
            return

        delta_text = getattr(event, "text", "") or ""
        if not delta_text:
            return

        if stream_type == "reasoning":
            # 首个推理 Token 派发前，补全首部 <think> 标签，以激活前端的折叠样式
            if not self._has_sent_think_open.get(to_handle):
                await self.ws.send(json.dumps({
                    "event": "reply.thought",
                    "data": {
                        "turnId": to_handle,
                        "chunk": "<think>\n"
                    }
                }))
                self._has_sent_think_open[to_handle] = True

            await self.ws.send(json.dumps({
                "event": "reply.thought",
                "data": {
                    "turnId": to_handle,
                    "chunk": delta_text
                }
            }))
        elif stream_type == "message":
            # 如果正文开始输出，且推理思考区尚未闭合，立即发送尾部 </think> 闭合思考区，提升交互时效性
            if self._has_sent_think_open.get(to_handle):
                await self.ws.send(json.dumps({
                    "event": "reply.thought",
                    "data": {
                        "turnId": to_handle,
                        "chunk": "\n</think>\n"
                    }
                }))
                self._has_sent_think_open.pop(to_handle, None)

            # 标记已接收到 message
            self._has_received_message[to_handle] = True

            # 纯粹的流式透传，将正式发言的 Token 直接发给 Council 平台
            await self.ws.send(json.dumps({
                "event": "reply.chunk",
                "data": {
                    "turnId": to_handle,
                    "chunk": delta_text
                }
            }))

    async def on_streaming_end(
        self,
        request: "AgentRequest",
        to_handle: str,
        event: Any,
        send_meta: Dict[str, Any],
        stream_type: str,
        accumulated_text: str = "",
    ) -> None:
        """当流式片段结束时的回调"""
        if not self.ws:
            return

        if stream_type == "reasoning":
            # 发送尾部 </think> 标签闭合思考区，前端将会把思考框折叠收起
            if self._has_sent_think_open.get(to_handle):
                await self.ws.send(json.dumps({
                    "event": "reply.thought",
                    "data": {
                        "turnId": to_handle,
                        "chunk": "\n</think>\n"
                    }
                }))
                self._has_sent_think_open.pop(to_handle, None)

            # 延迟 3.0s (3000ms) 检查是否接收到了 message 流量，如果未接收到，说明大模型仅输出了 think，执行兜底 done 释放
            async def _delay_check_done():
                await asyncio.sleep(3.0)
                if not self._has_received_message.get(to_handle, False):
                    raw_prompt = self._prompt_cache.pop(to_handle, "")
                    await self.ws.send(json.dumps({
                        "event": "reply.done",
                        "data": {
                            "turnId": to_handle,
                            "expertStance": {},
                            "rawPrompt": raw_prompt
                        }
                    }))
                    self._has_received_message.pop(to_handle, None)
                    print(f"[QwenPaw-Channel] 延迟自愈：检测到无正文流产生的 think-only 会话，已自动补发 done。轮次ID: {to_handle}")

            asyncio.create_task(_delay_check_done())

        elif stream_type == "message":
            self._has_received_message[to_handle] = True
            expert_stance, _ = extract_stance_from_full_text(accumulated_text)
            raw_prompt = self._prompt_cache.pop(to_handle, "")

            await self.ws.send(json.dumps({
                "event": "reply.done",
                "data": {
                    "turnId": to_handle,
                    "expertStance": expert_stance,
                    "rawPrompt": raw_prompt
                }
            }))
            self._has_received_message.pop(to_handle, None)
            print(f"[QwenPaw-Channel] 发言完毕 (流式)，回传内容与立场摘要成功。轮次ID: {to_handle}")


    async def send(self, to_handle: str, text: str, meta: Optional[dict] = None) -> None:
        """
        核心抽象方法实现：非流式模式下的发包逻辑
        """
        if not self.ws:
            print("[QwenPaw-Channel] 发送失败：WebSocket 连接不可用")
            return

        try:
            # 1. 提取思维链
            thought = ""
            think_match = re.search(r"<think>(.*?)</think>", text, re.DOTALL)
            if think_match:
                thought = think_match.group(1).strip()
                # 剪除 think 标签段
                text = text[:think_match.start()] + text[think_match.end():]
            elif "<think>" in text:
                idx = text.find("<think>")
                thought = text[idx+7:].strip()
                text = text[:idx]

            # 2. 从正文中提取立场卡片并裁剪正文中的 JSON 块
            expert_stance, clean_text = extract_stance_from_full_text(text)

            # 3. 顺序发包
            if thought:
                await self.ws.send(json.dumps({
                    "event": "reply.thought",
                    "data": {
                        "turnId": to_handle,
                        "chunk": f"<think>\n{thought}\n</think>\n"
                    }
                }))
            
            if clean_text:
                await self.ws.send(json.dumps({
                    "event": "reply.chunk",
                    "data": {
                        "turnId": to_handle,
                        "chunk": clean_text
                    }
                }))

            raw_prompt = self._prompt_cache.pop(to_handle, "")
            await self.ws.send(json.dumps({
                "event": "reply.done",
                "data": {
                    "turnId": to_handle,
                    "expertStance": expert_stance,
                    "rawPrompt": raw_prompt
                }
            }))
            print(f"[QwenPaw-Channel] 发言完毕 (非流式)，回传内容与立场摘要成功。轮次ID: {to_handle}")
        except Exception as e:
            print(f"[QwenPaw-Channel] 非流式回传消息发生异常: {e}")
