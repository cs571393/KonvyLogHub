# KonvyLogHub 移动端集成协议文档 (v3.0)

本文档描述了如何在 iOS 和 Android 客户端接入 **KonvyLogHub** 日志系统，以实现实时查看控制台日志、HTTP 网络请求以及 **Socket 链路监控**。

---

## 1. 接口配置 (API Configuration)

- **上报接口地址**: `https://konvyloghub.pages.dev/report`
- **请求方法**: `POST`
- **请求头 (Headers)**:
    - `Content-Type`: `application/json`
    - `Authorization`: `konvy-debug-2026`

---

## 2. 数据协议 (Data Protocol)

### 2.1 批量上报策略
为了兼顾实时性与性能，建议：
- **上报间隔**: **3秒**
- **单包大小上限**: **1MB** (Supabase Realtime 限制)

---

### 2.2 Socket 日志协议 (New in v3.0)
Socket 相关的结构化数据必须包含 `"type": "socket"`，以便 Dashboard 启用高亮和交互式 JSON 树。

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `type` | String | 固定为 `"socket"` |
| `level` | String | 固定为 `"socket"` |
| `action` | String | 动作，如: `SEND`, `RECEIVED`, `CONNECTED`, `ERROR`, `PING` |
| `content` | Any | 载荷，支持 JSON 对象或字符串 |

---

### 2.3 网络请求协议
网络日志必须包含 `"type": "network"`。前端已针对 v2.8+ 版本优化了 **JSON 树形预览**、**局部搜索**与**增量 UI 更新**。

---

## 3. 集成建议

### 3.1 iOS `CloudLogTool.swift`
调用 `logSocket(action:content:)` 来记录长连接交互：
```swift
CloudLogTool.shared.logSocket(action: "SEND", content: messageDict)
```

### 3.2 Android `CloudLogTool.kotlin`
建议使用 `CloudLogTool.Interceptor` 自动抓取 OkHttp 请求，并在 WebSocket 监听器中调用：
```kotlin
CloudLogTool.logSocket(context, "RECEIVED", jsonResponse)
```

---

## 4. 关键限制与建议 (Crucial Tips)

1.  **数据包大小限制**: 
    - **Supabase Realtime 单次消息上限为 1MB**。
    - 建议单条日志 Body 尽量保持在 **200KB** 以内，以确保网页端加载不卡顿。
2.  **增量更新**: 网页端已优化。当你展开 JSON 树或进行搜索高亮时，新收到的日志会直接追加到列表，**不会**重置你当前的交互状态。
3.  **TLS 忽略**: 在 DEBUG 环境下，SDK 应允许证书校验失败，确保在 Charles 等抓包环境下日志上报功能依然可用。
4.  **脱敏**: 切勿上报敏感字段（如 Token、密码）。
