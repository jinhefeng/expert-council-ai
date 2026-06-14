# 📑 外部智能体连通性测试与自适应热重载交互说明书 (Connectivity Test & Hot Reload Spec)

本说明书定义了在 `agent-council-ai` 平台侧和外部智能体侧（QwenPaw）实现“测试连通性”功能，以及建立“实时生效、免启动先后顺序依赖”的自适应重连与热重载交互逻辑的技术规范。

---

## 1. 业务逻辑与系统模型

### 1.1 连通性测试模型 (Connectivity Probing)
外部智能体（客户端，如 QwenPaw）作为 WebSocket 客户端主动向平台侧（服务端，如 Council 的 `ws-relay-server`）发起连接。在这样的反向接入拓扑中：
- **传统的 Ping/Test 机制缺陷**：由于客户端接口处于内网或无公网 IP，平台侧无法通过 HTTP 发送探测包。
- **反向心跳状态检验（第一性原理）**：平台已经通过 `ws-relay-server.ts` 并在全局内存变量 `global.wsRelayBotConnections` 中维持了所有当前已建立握手的物理 WebSocket 连接池。因此，“测试连通性”在技术上的最佳解是：**直接在服务端检索目标 Token 对应的物理 TCP 链路是否处于 `OPEN` 状态**。
- **前置交互流**：即使该外部专家在平台的配置表单中还没有最终点击“保存”，平台也可以通过其当前生成的临时 `botToken` 直接去底层全局连接池中匹配，因为客户端在配好 Token 后一旦启动就会每 5 秒自动拨号。

### 1.2 实时生效与免启动顺序依赖 (Hot Reload & Self-Healing)
为了实现“双向配置修改后实时建立新连接”而无需手动重启任何后台进程：
1. **解决 QwenPaw 侧加载缺陷**：QwenPaw 通道类 `AgentCouncilChannel` 必须正确重构其构造器与 `from_config` 反射方法，无缝接收 QwenPaw 框架注入的 `process` （ProcessHandler）和 `**kwargs`，以此解决构造参数缺失被 skipped 的崩溃。
2. **QwenPaw 侧配置热重载**：当用户在 QwenPaw 侧更新并保存配置（HTTP PUT）后，QwenPaw 将在后台调用其 `MultiAgentManager.reload_agent()` 触发智能体热重载，销毁旧通道长连接、按照新配置（新 WS URL/Token）唤醒新通道实例建立物理连接。
3. **免顺序依赖自动拨号**：QwenPaw 连接循环（`_websocket_loop`）本身具备异常捕获与重试退避机制（每 5 秒重试一次）。当平台 Council 尚未启动时，QwenPaw 处于“自动拨号中”；一旦 Council 随时启动就绪，QwenPaw 将在 5 秒内自动建立物理连接，完成自适应握手，彻底摆脱启动顺序的强制束缚。

---

## 2. 接口定义 (API Specification)

### 2.1 平台侧：外部连接检测接口

- **路径**: `/api/discussions/test-bot`
- **方法**: `GET`
- **请求参数 (Query)**:
  - `token` (string, 必填): 专家的外部智能体 Bot Token。
- **响应格式 (JSON)**:
  - **连接成功 (在线)**:
    ```json
    {
      "success": true,
      "status": "online"
    }
    ```
  - **连接失败 (离线/网络未通)**:
    ```json
    {
      "success": false,
      "status": "offline",
      "error": "客户端未在线，请检查外部智能体服务是否启动，并正确配置了该 Token。"
    }
    ```

---

## 3. UI/UX 交互说明 (Interaction Design)

### 3.1 专家设置弹窗 (ExpertModal.tsx) 的“测试连接”按钮
1. **位置**: 在 `ExpertModal.tsx` 的外部智能体 Token (Bot Token) 的配置卡片内。
2. **样式**:
   - 在 Token 行下方新增一个“测试连接 (Test Connection)”的操作区块。
   - 提供一个科技质感的按钮，点击时展示菊花加载状态（Spinner），并且按钮文本变为 `正在测试...`。
3. **状态反馈**:
   - **连接成功**: 展示绿色发光呼吸灯（在线指示），按钮右侧或下方淡入显示绿色提示文字：`✓ 连接成功：外部智能体已成功接入平台`。
   - **连接失败**: 展示红色呼吸灯（离线指示），按钮右侧或下方淡入显示淡红色提示文字，并带有详细的出错诱因：`✗ 连接失败：未检测到活跃连接。请确认客户端已运行且配置了正确的 Token`。
4. **防抖与限制**: 按钮应具备防抖控制，在请求进行中时禁用（Disabled），避免用户重复频繁点击造成网关压力。

---

## 4. 边缘案例处理 (Edge Cases)

| 场景 | 后端行为 | 前端行为 |
| :--- | :--- | :--- |
| **测试时 Token 字段为空** | API 返回 400 Bad Request 或 `success: false` | 提示“请先输入或生成机器人 Token” |
| **测试时网关 global 未初始化** | API 安全降级，返回 `status: offline` 并不崩溃 | 提示“网关未启动，请稍后重试” |
| **客户端频繁重连** | 平台网关在 handleClose 中清理旧 socket 引用，避免内存泄漏 | 前端根据网关推送最新 bot_status 保持呼吸灯同步 |
| **修改配置后旧连接未释放** | QwenPaw 热重载阶段会在 swap 后对旧 Channel 触发 stop()，彻底 close 旧 Socket | 前端实时感知到旧 Token 断开，新 Token 接入 |
