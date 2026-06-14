import sys
from typing import Any, Annotated
from pydantic import BaseModel, Field, create_model, BeforeValidator
from .agent_council_channel import AgentCouncilChannel

# 在常规版 QwenPaw 载入时，动态给 Pydantic 的全局配置对象打补丁，以在 UI 上渲染我们所需的特设字段
try:
    import qwenpaw.config.config as qcc
    from qwenpaw.config.config import BaseChannelConfig

    # 1. 声明专属于 Agent Council 的配置模型类，并注入自描述的交互引导别名
    class AgentCouncilConfig(BaseChannelConfig):
        model_config = {
            "populate_by_name": True
        }
        server_url: str = Field(
            default="ws://localhost:18788/bot",
            description="Agent Council Server WebSocket URL",
            alias="连接地址 server_url (填写主站的WS机器人接入地址，如 ws://127.0.0.1:18788/bot)"
        )
        bot_token: str = Field(
            default="",
            description="Bot authentication Token generated from Agent Council",
            alias="令牌鉴权 bot_token (填入从 Agent Council 专家管理中生成的接入 Token)"
        )
        streaming_enabled: bool = Field(
            default=True,
            description="Enable real-time stream reply",
            alias="流式传输 streaming_enabled (推荐启用以在圆桌会议中获得打字机流式评审效果)"
        )

    # 2. 动态重组 ChannelConfig 字段大字典
    fields_dict = {}
    for field_name, field_info in qcc.ChannelConfig.model_fields.items():
        fields_dict[field_name] = (field_info.annotation, field_info)

    # 注入 agent_council，UI 识别为 "Agent Council" (由 title 驱动)
    fields_dict["agent_council"] = (
        AgentCouncilConfig,
        Field(default_factory=AgentCouncilConfig, title="Agent Council")
    )

    NewChannelConfig = create_model(
        "ChannelConfig",
        __module__=qcc.__name__,
        **fields_dict
    )

    # 3. 前置校验拦截器：解决新旧类校验冲突，并向下兼容旧有的 design_council 配置字段
    def convert_old_channels(v: Any) -> Any:
        if v is not None:
            data = None
            if v.__class__.__name__ == "ChannelConfig":
                try:
                    if hasattr(v, "model_dump"):
                        data = v.model_dump()
                    elif hasattr(v, "dict"):
                        data = v.dict()
                except Exception:
                    pass
                if data is None:
                    try:
                        data = dict(getattr(v, "__dict__", {}))
                    except Exception:
                        pass
            elif isinstance(v, dict):
                data = dict(v)

            if isinstance(data, dict):
                if "design_council" in data and "agent_council" not in data:
                    data["agent_council"] = data["design_council"]
                return data
        return v

    # 4. 动态重组 Config 字段大字典 (Config 包含 channels 属性)
    fields_dict_config = {}
    for field_name, field_info in qcc.Config.model_fields.items():
        if field_name == "channels":
            fields_dict_config[field_name] = (
                Annotated[NewChannelConfig, BeforeValidator(convert_old_channels)],
                Field(default_factory=NewChannelConfig)
            )
        else:
            fields_dict_config[field_name] = (field_info.annotation, field_info)

    NewConfig = create_model(
        "Config",
        __module__=qcc.__name__,
        **fields_dict_config
    )

    # 5. 动态重组 AgentProfileConfig 字段大字典 (包含 channels 属性)
    fields_dict_profile = {}
    for field_name, field_info in qcc.AgentProfileConfig.model_fields.items():
        if field_name == "channels":
            fields_dict_profile[field_name] = (
                Annotated[NewChannelConfig, BeforeValidator(convert_old_channels)],
                Field(default=None)
            )
        else:
            fields_dict_profile[field_name] = (field_info.annotation, field_info)

    NewAgentProfileConfig = create_model(
        "AgentProfileConfig",
        __module__=qcc.__name__,
        **fields_dict_profile
    )

    # 6. 先绑定 to qcc 模块，以供 model_rebuild 能够正确寻址所有 ForwardRef 类
    old_config_cls = qcc.Config
    old_channel_config_cls = qcc.ChannelConfig
    old_profile_cls = qcc.AgentProfileConfig

    qcc.ChannelConfig = NewChannelConfig
    qcc.Config = NewConfig
    qcc.AgentProfileConfig = NewAgentProfileConfig

    # 7. 调用 model_rebuild 重新编译类结构，防止 ForwardRef 校验解析冲突报错
    NewChannelConfig.model_rebuild()
    NewConfig.model_rebuild()
    NewAgentProfileConfig.model_rebuild()

    # 7.1 动态塞入 ChannelConfigUnion，保证 ResponseModel 校验
    from typing import Union
    original_args = getattr(qcc.ChannelConfigUnion, "__args__", ())
    new_args = list(original_args) + [AgentCouncilConfig]
    NewChannelConfigUnion = Union[tuple(new_args)]
    old_union_cls = qcc.ChannelConfigUnion
    qcc.ChannelConfigUnion = NewChannelConfigUnion

    # 8. 全局模块引用替换 (sys.modules)
    for name, module in list(sys.modules.items()):
        if name.startswith("qwenpaw"):
            if hasattr(module, "Config") and getattr(module, "Config") == old_config_cls:
                setattr(module, "Config", NewConfig)
            if hasattr(module, "ChannelConfig") and getattr(module, "ChannelConfig") == old_channel_config_cls:
                setattr(module, "ChannelConfig", NewChannelConfig)
            if hasattr(module, "AgentProfileConfig") and getattr(module, "AgentProfileConfig") == old_profile_cls:
                setattr(module, "AgentProfileConfig", NewAgentProfileConfig)
            if hasattr(module, "ChannelConfigUnion") and getattr(module, "ChannelConfigUnion") == old_union_cls:
                setattr(module, "ChannelConfigUnion", NewChannelConfigUnion)

    # 9. 重置 config 缓存，使得 load_config() 能重新执行 model_validate 从而生效
    try:
        import qwenpaw.config.utils as qcu
        qcu._config_cache = None
        qcu._agent_config_cache = {}
    except Exception:
        pass

    # 10. 对 FastAPI 路由进行零侵入拦截与别名转换
    try:
        from qwenpaw.app.routers.config import router, _CHANNEL_CONFIG_CLASS_MAP
        from fastapi import Request

        # 注入自定义配置类映射，保证 PUT 保存时能反序列化为正确的模型
        _CHANNEL_CONFIG_CLASS_MAP["agent_council"] = AgentCouncilConfig

        # 拦截辅助函数：对单个通道配置字典执行 1.物理过滤 2.Alias转换 3.默认补齐 4.严格排序
        def clean_and_order_single_channel(ch_data: Any) -> dict:
            if hasattr(ch_data, "model_dump"):
                ch_data = ch_data.model_dump(by_alias=False)
            elif not isinstance(ch_data, dict):
                try:
                    ch_data = dict(ch_data)
                except Exception:
                    ch_data = {}
            else:
                ch_data = dict(ch_data)

            # 2. 物理过滤掉面向 IM 机器人的冗余安全策略字段及 require_mention
            redundant_keys = [
                "dm_policy", "group_policy", "allow_from", "deny_message",
                "dm_disabled", "group_disabled", "access_control_dm", "access_control_group",
                "require_mention"
            ]
            for r_key in redundant_keys:
                ch_data.pop(r_key, None)

            # 3. 将原生 Key 自动转换为 alias Key，以保证前端渲染带有详细中文说明
            mapping = {
                "server_url": "连接地址 server_url (填写主站的WS机器人接入地址，如 ws://127.0.0.1:18788/bot)",
                "bot_token": "令牌鉴权 bot_token (填入从 Agent Council 专家管理中生成的接入 Token)",
                "streaming_enabled": "流式传输 streaming_enabled (推荐启用以在圆桌会议中获得打字机流式评审效果)"
            }
            for orig_k, alias_k in mapping.items():
                if orig_k in ch_data:
                    ch_data[alias_k] = ch_data.pop(orig_k)

            # 4. 如果缺失这三个自定义字段，补齐默认值 (带 alias 别名格式)
            try:
                default_cfg = AgentCouncilConfig()
                default_data = default_cfg.model_dump(by_alias=True)
                target_aliases = [
                    "连接地址 server_url (填写主站的WS机器人接入地址，如 ws://127.0.0.1:18788/bot)",
                    "令牌鉴权 bot_token (填入从 Agent Council 专家管理中生成的接入 Token)",
                    "流式传输 streaming_enabled (推荐启用以在圆桌会议中获得打字机流式评审效果)"
                ]
                for attr_key in target_aliases:
                    if attr_key in default_data and attr_key not in ch_data:
                        ch_data[attr_key] = default_data[attr_key]
            except Exception as patch_err:
                print(f"[QwenPaw-Channel] 补全通道默认值失败: {patch_err}")

            # 5. 严格组件排序：重组字典 Key，确保 [连接地址 ➔ 令牌鉴权 ➔ 流式传输] 从上到下排布
            ordered_data = {}
            for k in ["enabled", "bot_prefix", "filter_tool_messages", "filter_thinking", "isBuiltin"]:
                if k in ch_data:
                    ordered_data[k] = ch_data.pop(k)

            custom_order = [
                "连接地址 server_url (填写主站的WS机器人接入地址，如 ws://127.0.0.1:18788/bot)",
                "令牌鉴权 bot_token (填入从 Agent Council 专家管理中生成的接入 Token)",
                "流式传输 streaming_enabled (推荐启用以在圆桌会议中获得打字机流式评审效果)"
            ]
            for k in custom_order:
                if k in ch_data:
                    ordered_data[k] = ch_data.pop(k)

            for k, v in list(ch_data.items()):
                ordered_data[k] = v

            return ordered_data

        # 拦截列表批量处理函数
        def apply_clean_and_order_patch(res: Any):
            if not isinstance(res, dict):
                return res

            for key, ch_data in res.items():
                if key == "agent_council":
                    res[key] = clean_and_order_single_channel(ch_data)
                elif key in NewChannelConfig.model_fields:
                    field_info = NewChannelConfig.model_fields[key]
                    cfg_cls = field_info.annotation
                    if hasattr(cfg_cls, "model_fields"):
                        try:
                            default_cfg = cfg_cls()
                            default_data = default_cfg.model_dump()
                            if isinstance(ch_data, dict):
                                for attr_key, attr_val in default_data.items():
                                    if attr_key not in ch_data:
                                        ch_data[attr_key] = attr_val
                        except Exception as patch_err:
                            print(f"[QwenPaw-Channel] 补全通道 {key} 默认值失败: {patch_err}")
            return res

        # 注册 ASGI 中间件以进行零侵入路由拦截与参数净化
        import json
        from starlette.middleware.base import BaseHTTPMiddleware
        from starlette.responses import JSONResponse, Response
        from qwenpaw.config.config import load_agent_config

        class AgentCouncilConfigMiddleware(BaseHTTPMiddleware):
            async def dispatch(self, request: Request, call_next):
                path = request.url.path
                method = request.method

                # 1. 检查是否是 agent_council 单通道接口 (GET 或 PUT)
                is_single_channel = False
                agent_id = "default"
                
                path_parts = path.strip("/").split("/")
                if len(path_parts) >= 6 and path_parts[0] == "api" and path_parts[1] == "agents" and path_parts[3] == "config" and path_parts[4] == "channels" and path_parts[5] == "agent_council":
                    is_single_channel = True
                    agent_id = path_parts[2]
                elif len(path_parts) >= 4 and path_parts[0] == "api" and path_parts[1] == "config" and path_parts[2] == "channels" and path_parts[3] == "agent_council":
                    is_single_channel = True
                    agent_id = request.headers.get("X-Agent-Id") or "default"

                if is_single_channel:
                    # === GET 请求拦截 ===
                    if method == "GET":
                        try:
                            cfg = load_agent_config(agent_id)
                            agent_council_cfg = getattr(cfg.channels, "agent_council", None)
                            if agent_council_cfg is None:
                                extra = getattr(cfg.channels, "__pydantic_extra__", None) or {}
                                agent_council_cfg = extra.get("agent_council")
                            cleaned_data = clean_and_order_single_channel(agent_council_cfg)
                            return JSONResponse(content=cleaned_data)
                        except Exception as e:
                            print(f"[QwenPaw-Channel] GET 单通道拦截处理失败: {e}")
                            
                    # === PUT 请求拦截 ===
                    elif method == "PUT":
                        try:
                            body = await request.body()
                            body_str = body.decode("utf-8")
                            single_cfg = json.loads(body_str) if body_str else {}
                            reverse_mapping = {
                                "连接地址 server_url (填写主站的WS机器人接入地址，如 ws://127.0.0.1:18788/bot)": "server_url",
                                "令牌鉴权 bot_token (填入从 Agent Council 专家管理中生成的接入 Token)": "bot_token",
                                "流式传输 streaming_enabled (推荐启用以在圆桌会议中获得打字机流式评审效果)": "streaming_enabled"
                            }
                            cleaned_config = {}
                            for k, v in single_cfg.items():
                                real_k = reverse_mapping.get(k, k)
                                cleaned_config[real_k] = v
                                
                            redundant_keys = [
                                "dm_policy", "group_policy", "allow_from", "deny_message",
                                "dm_disabled", "group_disabled", "access_control_dm", "access_control_group",
                                "require_mention"
                            ]
                            for r_key in redundant_keys:
                                cleaned_config.pop(r_key, None)
                                
                            async def receive():
                                return {
                                    "type": "http.request",
                                    "body": json.dumps(cleaned_config).encode("utf-8"),
                                    "more_body": False
                                }
                            request._receive = receive
                            
                            response = await call_next(request)
                            
                            cfg = load_agent_config(agent_id)
                            agent_council_cfg = getattr(cfg.channels, "agent_council", None)
                            if agent_council_cfg is None:
                                extra = getattr(cfg.channels, "__pydantic_extra__", None) or {}
                                agent_council_cfg = extra.get("agent_council")
                            cleaned_data = clean_and_order_single_channel(agent_council_cfg)
                            return JSONResponse(content=cleaned_data)
                        except Exception as e:
                            print(f"[QwenPaw-Channel] PUT 单通道拦截处理失败: {e}")

                # 2. 检查是否是批量通道列表接口 GET 请求
                is_list_channels = False
                if len(path_parts) >= 5 and path_parts[0] == "api" and path_parts[1] == "agents" and path_parts[3] == "config" and path_parts[4] == "channels" and len(path_parts) == 5:
                    is_list_channels = True
                elif len(path_parts) >= 3 and path_parts[0] == "api" and path_parts[1] == "config" and path_parts[2] == "channels" and len(path_parts) == 3:
                    is_list_channels = True

                if is_list_channels and method == "GET":
                    response = await call_next(request)
                    if response.status_code == 200:
                        try:
                            body = [section async for section in response.body_iterator]
                            body_bytes = b"".join(body)
                            res_json = json.loads(body_bytes.decode("utf-8"))
                            cleaned_res = apply_clean_and_order_patch(res_json)
                            return JSONResponse(content=cleaned_res)
                        except Exception as e:
                            print(f"[QwenPaw-Channel] GET 批量列表拦截失败: {e}")
                            return Response(content=body_bytes, status_code=response.status_code, headers=dict(response.headers))

                return await call_next(request)

        # 双重 Patch 机制 ── B. 挂载中间件到 FastAPI 运行期实例上
        try:
            import qwenpaw.app._app as qaa
            if hasattr(qaa, "app") and qaa.app:
                has_middleware = False
                for middleware in qaa.app.user_middleware:
                    if middleware.cls.__name__ == "AgentCouncilConfigMiddleware":
                        has_middleware = True
                        break
                if not has_middleware:
                    qaa.app.add_middleware(AgentCouncilConfigMiddleware)
                    print("[QwenPaw-Channel] 成功将 AgentCouncilConfigMiddleware 挂载至 FastAPI 应用中！")
        except Exception as app_e:
            print(f"[QwenPaw-Channel] App 中间件挂载失败: {app_e}")

    except Exception as e:
        print(f"[QwenPaw-Channel] 路由器 patch 失败: {e}")

    print("[QwenPaw-Channel] 成功打上 Agent Council 动态配置补丁！")
except Exception as e:
    print(f"[QwenPaw-Channel] 动态配置补丁加载失败: {e}")

__all__ = ["AgentCouncilChannel"]
