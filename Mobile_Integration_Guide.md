# KonvyLogHub 移动端集成协议文档 (v2.9)

本文档描述了如何在 iOS 和 Android 客户端接入 **KonvyLogHub** 日志系统，以实现实时查看控制台日志和 HTTP 网络请求详情。

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

### 2.2 数据格式 (JSON)
网络日志必须包含 `"type": "network"`。前端已针对 v2.8+ 版本优化了 **JSON 树形预览**、**局部搜索**与**增量 UI 更新**。

---

## 3. iOS `CloudLogTool.swift` 修改建议

请在你的 App 项目中修改 `CloudLogTool.swift` 的以下常量：

```swift
// 1. 修改上报频率
private let batchInterval: TimeInterval = 3.0 // 缩短为 3秒

// 2. 提升单次数据量上限 (1MB 约等于 1,000,000 字节)
private func performUpload(_ logs: [[String: Any]]) {
    let maxBatchBytes = 950_000 // 预留 50KB 给 Header 等
    // ... 原有逻辑 ...
}

// 3. 建议在拦截器中增加对 Body 的截断保护
func logNetwork(...) {
    // 处理 Body 时，如果单个请求 Body 超过 800KB，建议截断
    // 防止整个 Batch (多个日志) 叠加后超过 1MB 导致发送失败
}
```

---

## 4. 关键限制与建议 (Crucial Tips)

1.  **数据包大小限制**: 
    - **Supabase Realtime 单次消息上限为 1MB**。
    - 虽然支持 1MB，但建议单条日志 Body 尽量保持在 **200KB** 以内，以确保网页端加载不卡顿。
2.  **增量更新**: 网页端已优化。当你展开 JSON 树或进行搜索高亮时，新收到的日志会直接追加到列表，**不会**重置你当前的交互状态。
3.  **脱敏**: 切勿上报敏感字段。
