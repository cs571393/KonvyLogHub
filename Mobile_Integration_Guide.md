# KonvyLogHub 移动端集成协议文档 (v2.8)

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

### 2.1 公共基础字段 (Common Fields)

| 字段名 | 类型 | 描述 |
| :--- | :--- | :--- |
| `deviceId` | String | 设备唯一标识 (UUID / IMEI) |
| `deviceName` | String | 设备名称 (如 "iPhone 15 Pro") |
| `timestamp` | Double | Unix 时间戳 (秒)，建议精确到毫秒 |
| `type` | String | **可选**。网络日志固定为 `"network"`，普通日志可不传。 |
| `metadata` | Object | **可选**。建议仅在 App 启动首条日志携带。 |

---

### 2.2 普通日志 (Standard Log)
支持 `info`, `warn`, `error`, `debug` 级别，控制台会根据级别显示不同颜色。

```json
{
  "deviceId": "uuid-1234",
  "deviceName": "iPhone 15",
  "timestamp": 1706851234.56,
  "level": "info",
  "content": "用户点击了支付按钮", // 建议发送 String 或 JSON Object
  "metadata": { "user_id": "123", "username": "张三" }
}
```

---

### 2.3 网络日志 (Network Log)
**重要**: 必须包含 `"type": "network"`。前端会自动解析并生成 **JSON 可折叠树视图** 且支持 **关键字搜索**。

```json
{
  "deviceId": "uuid-1234",
  "deviceName": "iPhone 15",
  "timestamp": 1706851234.56,
  "type": "network",
  "method": "POST",
  "url": "https://api.example.com/v1/order",
  "status": 200,
  "duration": 150, // 毫秒
  "request": {
    "headers": { ... },
    "body": { ... } // 自动解析 JSON 树
  },
  "response": {
    "headers": { ... },
    "body": { ... } // 自动解析 JSON 树
  }
}
```

---

## 3. 技术实现方案 (Technical Guide)

### 3.1 iOS (Alamofire / Moya)

**方式 A: Alamofire EventMonitor (全局拦截)**
```swift
class CloudLogMonitor: EventMonitor {
    func request(_ request: Request, didParseResponse response: DataResponse<Any, AFError>) {
        let url = request.request?.url?.absoluteString ?? ""
        CloudLogTool.shared.logNetwork(
            url: url,
            method: request.request?.httpMethod ?? "GET",
            requestHeaders: request.request?.allHTTPHeaderFields,
            requestBody: request.request?.httpBody, // 内部处理 Data 转 JSON/String
            responseHeaders: response.response?.allHeaderFields as? [String: Any],
            responseBody: response.data,
            statusCode: response.response?.statusCode ?? 0,
            duration: response.metrics?.taskInterval.duration ?? 0
        )
    }
}
// 初始化 Session
let session = Session(eventMonitors: [CloudLogMonitor()])
```

**方式 B: Moya Plugin (针对 Moya 用户)**
```swift
struct CloudLogMoyaPlugin: PluginType {
    func didFinishRequest(_ result: Result<Moya.Response, MoyaError>, target: TargetType) {
        // 在此处解析 result 并调用 CloudLogTool.shared.logNetwork
    }
}
// 初始化 Provider
let provider = MoyaProvider<MyAPI>(plugins: [CloudLogMoyaPlugin()])
```

### 3.2 Android (OkHttp Interceptor)

```kotlin
class CloudLogInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val start = System.nanoTime()
        val response = chain.proceed(request)
        val duration = (System.nanoTime() - start) / 1000000

        // 建议限制 Body 大小，防止超标 (100KB)
        val reqBody = request.body?.let { readRequestBody(it) }
        val resBody = response.peekBody(100 * 1024).string() 

        CloudLogManager.logNetwork(
            url = request.url.toString(),
            method = request.method,
            status = response.code,
            duration = duration,
            reqBody = reqBody,
            resBody = resBody
        )
        return response
    }
}
```

---

## 4. 关键限制与建议 (Crucial Tips)

1.  **数据包大小限制**: 
    - **Supabase Realtime 单次消息上限为 1MB**。
    - 建议单条日志 Body 压缩/截断在 **100KB** 以内，以确保网页端加载流畅。
    - 对于上传图片等二进制流，Body 请上报 `"[Binary Data]"`。
2.  **增量更新**: 网页端已优化为增量渲染。持续上报数据时，你展开的 JSON 树状态和搜索高亮会被保留。
3.  **JSON 树搜索**: 上报的 Body 建议尽量是标准的 JSON 对象或 JSON 字符串，前端提供了强力搜索和“上一个/下一个”跳转功能。
4.  **脱敏**: 切勿上报用户密码、Token 等敏感 Header 或 Body 字段。