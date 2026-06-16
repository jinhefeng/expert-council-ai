import asyncio
import json
import websockets
import sys
import re

# 假设用户安装了 agentscope 库
try:
    import agentscope
    from agentscope.agents import UserAgent, DialogAgent
    HAS_AGENTSCOPE = True
except ImportError:
    HAS_AGENTSCOPE = False

class StreamingState:
    INIT = "INIT"
    THINKING = "THINKING"
    SPEAKING = "SPEAKING"
    EXTRACTING_JSON = "EXTRACTING_JSON"


class StreamingTokenFilter:
    def __init__(self):
        self.state = StreamingState.INIT
        self.buffer = ""
        self.json_buffer = ""

    def feed(self, token: str):
        events = []
        if not token:
            return events

        if self.state == StreamingState.INIT:
            self.buffer += token
            if len(self.buffer) >= 7 or "<think>" in self.buffer:
                if "<think>" in self.buffer:
                    self.state = StreamingState.THINKING
                    parts = self.buffer.split("<think>", 1)
                    before = parts[0]
                    after = parts[1]
                    if before:
                        events.append(("chunk", before))
                    if after:
                        events.append(("thought", after))
                else:
                    self.state = StreamingState.SPEAKING
                    events.append(("chunk", self.buffer))
                self.buffer = ""
            return events

        elif self.state == StreamingState.THINKING:
            self.buffer += token
            if "</think>" in self.buffer:
                parts = self.buffer.split("</think>", 1)
                inside = parts[0]
                outside = parts[1]
                if inside:
                    events.append(("thought", inside))
                self.state = StreamingState.SPEAKING
                self.buffer = ""
                if outside:
                    events.extend(self.feed_speaking(outside))
            else:
                if len(self.buffer) > 8:
                    to_send = self.buffer[:-8]
                    self.buffer = self.buffer[-8:]
                    events.append(("thought", to_send))
            return events

        elif self.state == StreamingState.SPEAKING:
            return self.feed_speaking(token)

        elif self.state == StreamingState.EXTRACTING_JSON:
            self.json_buffer += token
            return events

    def feed_speaking(self, token: str):
        events = []
        self.buffer += token
        lower_buf = self.buffer.lower()
        idx_json = lower_buf.find("```json")
        idx_brace = lower_buf.find("{")
        idx_code = lower_buf.find("```")

        positions = []
        if idx_json != -1:
            positions.append((idx_json, "json_block"))
        if idx_brace != -1:
            positions.append((idx_brace, "brace"))
        if idx_code != -1:
            positions.append((idx_code, "code_block"))

        if positions:
            positions.sort(key=lambda x: x[0])
            first_idx, marker_type = positions[0]
            before = self.buffer[:first_idx]
            if before:
                events.append(("chunk", before))
            self.state = StreamingState.EXTRACTING_JSON
            self.json_buffer = self.buffer[first_idx:]
            self.buffer = ""
        else:
            if len(self.buffer) > 7:
                to_send = self.buffer[:-7]
                self.buffer = self.buffer[-7:]
                events.append(("chunk", to_send))
        return events

    def finalize(self):
        events = []
        if self.state == StreamingState.INIT:
            if self.buffer:
                events.append(("chunk", self.buffer))
            self.state = StreamingState.SPEAKING
        elif self.state == StreamingState.THINKING:
            if self.buffer:
                events.append(("thought", self.buffer))
        elif self.state == StreamingState.SPEAKING:
            lower_buf = self.buffer.lower()
            idx_json = lower_buf.find("```json")
            idx_brace = lower_buf.find("{")
            idx_code = lower_buf.find("```")
            positions = [pos for pos in [idx_json, idx_brace, idx_code] if pos != -1]
            if positions:
                first_idx = min(positions)
                before = self.buffer[:first_idx]
                if before:
                    events.append(("chunk", before))
                self.json_buffer = self.buffer[first_idx:]
                self.state = StreamingState.EXTRACTING_JSON
            else:
                if self.buffer:
                    events.append(("chunk", self.buffer))
            self.buffer = ""
        return events


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
                        if payload.get("event") == "turn.request":
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
        expert_name = data.get("expertName", "未知专家")
        expert_title = data.get("expertTitle", "未知头衔")

        print(f"[QwenPaw-Adapter] 收到发言令牌. 会议ID: {data.get('meetingId')}, 轮次ID: {turn_id}")

        # 拼接提供给模型的消息
        prompt = (
            f"你当前在会议中扮演的角色是【{expert_name}】，核心头衔是【{expert_title}】。\n"
            f"当前评审议题：{question}\n"
            f"项目背景：{context}\n"
            f"此前会议发言：\n"
        )
        for t in previous_turns:
            content = t.get('content') or ""
            # 清洗 think
            content = re.sub(r'<think>[\s\S]*?<\/think>', '', content)
            think_idx = content.find("<think>")
            if think_idx != -1:
                content = content[:think_idx]
            
            lines = content.strip().split('\n')
            formatted_lines = [f"> {line}" for line in lines]
            blockquote = '\n'.join(formatted_lines)
            prompt += f"【{t.get('expertName')}】发言：\n{blockquote}\n\n"

        prompt += "\n请对该方案进行评审，并用中文给出修改意见。在发言末尾，必须输出如下结构化 JSON 摘要：\n"
        prompt += '```json\n{\n  "stance": "您的核心立场",\n  "concern": "最担忧的风险",\n  "recommendation": "可落地建议",\n  "tradeoff": "为了做这个决策需要付出的牺牲/妥协"\n}\n```'

        # 模拟/调用 Agent 思考并流式返回
        reply_text = ""
        if self.agent:
            # 真实对接 AgentScope 推理
            from agentscope.message import Msg
            msg = Msg("user", content=prompt)
            # 假设 model 支持 stream 生成
            response_msg = self.agent(msg)
            reply_text = response_msg.content
        else:
            # 无 AgentScope 时 fallback 到模拟流式输出
            reply_text = (
                f"<think>正在构思对于议题【{question}】的专业评审意见...</think>\n\n"
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

        token_filter = StreamingTokenFilter()
        chunk_size = 5
        for i in range(0, len(reply_text), chunk_size):
            chunk = reply_text[i:i+chunk_size]
            events = token_filter.feed(chunk)
            for ev_type, ev_text in events:
                event_name = "reply.thought" if ev_type == "thought" else "reply.chunk"
                await websocket.send(json.dumps({
                    "event": event_name,
                    "data": {
                        "turnId": turn_id,
                        "chunk": ev_text
                    }
                }))
            await asyncio.sleep(0.01)

        # 流结束收尾
        final_events = token_filter.finalize()
        for ev_type, ev_text in final_events:
            event_name = "reply.thought" if ev_type == "thought" else "reply.chunk"
            await websocket.send(json.dumps({
                "event": event_name,
                "data": {
                    "turnId": turn_id,
                    "chunk": ev_text
                }
            }))

        # 提取卡片摘要并解析
        json_str = token_filter.json_buffer
        expert_stance = extract_expert_stance_from_json(json_str)

        # 结束标记发送，携带 expertStance
        await websocket.send(json.dumps({
            "event": "reply.done",
            "data": {
                "turnId": turn_id,
                "expertStance": expert_stance
            }
        }))
        print(f"[QwenPaw-Adapter] 发言回复与卡片摘要完成: {turn_id}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("使用方式: python adapter.py <dc_bot_token> [server_websocket_url]")
        sys.exit(1)
        
    token = sys.argv[1]
    url = sys.argv[2] if len(sys.argv) > 2 else "ws://localhost:18788/bot"
    
    adapter = DesignCouncilQwenPawAdapter(url, token)
    asyncio.run(adapter.start())
