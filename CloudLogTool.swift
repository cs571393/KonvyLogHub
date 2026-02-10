//
//  CloudLogTool.swift
//  Konvy
//
//  Created by Gemini on 2026/1/30.
//  Copyright © 2026 Konvy. All rights reserved.
//

import UIKit
import DeviceKit
import Alamofire

#if DEBUG
final class CloudLogTool: NSObject, @unchecked Sendable {
    
    static let shared = CloudLogTool()
    
    /// 查看log的地址： https://konvyloghub.pages.dev
    
    /// 部署后的 Cloudflare Worker 地址
    private let workerUrl = "https://konvyloghub.pages.dev/report"
    private let authToken = "konvy-debug-2026"
    
    // --- 内部网络会话 (用于跳过 TLS 校验) ---
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral // 使用 ephemeral 避免缓存旧网络的 SSL 状态
        config.waitsForConnectivity = true
        config.timeoutIntervalForRequest = 30
        return URLSession(configuration: config, delegate: TLSHandler(), delegateQueue: nil)
    }()

    internal let deviceName = Device.current.description
    internal let deviceId = UserDataTool.getUUID() ?? ""
    internal let os_version = UIDevice.current.systemVersion
    internal let appVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
    
    // --- 批量处理相关 ---
    internal var logBuffer: [[String: Any]] = []
    internal let lock = NSLock()
    internal var sendWorkItem: DispatchWorkItem?
    internal let batchInterval: TimeInterval = 3.0 // 3秒合并一次
    internal var lastMetadata: [String: Any]? // 记录最后一次发送的 metadata
    
    // --- EventMonitor 相关 ---
    /// EventMonitor 协议要求的队列，明确指定为主线程，确保调试打印可见
    var queue: DispatchQueue {
        return .main
    }
}

// MARK: - Public Logging Methods
extension CloudLogTool {
    
    /// 发送普通调试日志
    func log(_ content: Any?, level: String = "info") {
        guard let safeContent = content else { return }
        
        if let str = safeContent as? String, str.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return }
        
        let currentMetadata = getMetadata()
        var logItem: [String: Any] = [
            "deviceId": deviceId,
            "deviceName": deviceName,
            "level": level,
            "content": safeContent,
            "timestamp": Date().timeIntervalSince1970
        ]
        
        if lastMetadata == nil || !NSDictionary(dictionary: currentMetadata).isEqual(to: lastMetadata!) {
            logItem["metadata"] = currentMetadata
            lastMetadata = currentMetadata
        }
        
        addToBuffer(logItem)
    }

    /// 发送 Socket 日志
    func logSocket(action: String, content: Any?) {
        var logItem: [String: Any] = [
            "deviceId": deviceId,
            "deviceName": deviceName,
            "timestamp": Date().timeIntervalSince1970,
            "type": "socket",
            "level": "socket", // 方便在日志列表过滤
            "action": action,
            "content": content ?? ""
        ]
        
        let currentMetadata = getMetadata()
        if lastMetadata == nil || !NSDictionary(dictionary: currentMetadata).isEqual(to: lastMetadata!) {
            logItem["metadata"] = currentMetadata
            lastMetadata = currentMetadata
        }
        
        addToBuffer(logItem)
    }
    
    /// 发送网络日志 (供 Network Tab 使用)
    func logNetwork(url: String,
                    method: String,
                    requestHeaders: [String: Any]?,
                    requestBody: Any?,
                    responseHeaders: [String: Any]?,
                    responseBody: Any?,
                    statusCode: Int,
                    duration: Double) {
        let safeReqBody = processBody(requestBody)
        let safeResBody = processBody(responseBody)
        
        var logItem: [String: Any] = [
            "deviceId": deviceId,
            "deviceName": deviceName,
            "timestamp": Date().timeIntervalSince1970,
            "type": "network",
            "method": method.uppercased(),
            "url": url,
            "status": statusCode,
            "duration": Int(duration * 1000),
            "request": [
                "headers": requestHeaders ?? [:],
                "body": safeReqBody ?? ""
            ],
            "response": [
                "headers": responseHeaders ?? [:],
                "body": safeResBody ?? ""
            ]
        ]
        
        let currentMetadata = getMetadata()
        if lastMetadata == nil || !NSDictionary(dictionary: currentMetadata).isEqual(to: lastMetadata!) {
            logItem["metadata"] = currentMetadata
            lastMetadata = currentMetadata
        }
        
        addToBuffer(logItem)
    }
}

// MARK: - Internal Helpers & Upload Logic
extension CloudLogTool {
    
    /// 获取当前的设备和用户信息
    private func getMetadata() -> [String: Any] {
        let userBase = UserDataTool.shared().userInfoModel?.user?.base
        return [
            "user_id": userBase?.uid ?? "",
            "username": userBase?.username ?? "",
            "fcm_token": CacheTool.shareCacheTool().object(forKey: kFcmToken) as? String ?? "",
            "imei": deviceId,
            "deviceName": deviceName,
            "osVersion": os_version,
            "appVersion": appVersion
        ]
    }

    /// 将日志加入缓冲区并开启定时器
    private func addToBuffer(_ item: [String: Any]) {
        lock.lock()
        logBuffer.append(item)
        if sendWorkItem == nil {
            let workItem = DispatchWorkItem { [weak self] in
                self?.flush()
            }
            sendWorkItem = workItem
            DispatchQueue.global().asyncAfter(deadline: .now() + batchInterval, execute: workItem)
        }
        lock.unlock()
    }

    /// 立即刷新缓冲区
    private func flush() {
        lock.lock()
        let logsToSend = logBuffer
        logBuffer.removeAll()
        sendWorkItem = nil
        lock.unlock()
        
        guard !logsToSend.isEmpty else { return }
        performUpload(logsToSend)
    }

    private func performUpload(_ logs: [[String: Any]]) {
        let maxBatchBytes = 900 * 1024 
        var currentChunk: [[String: Any]] = []
        var currentChunkSize = 0
        
        for log in logs {
            // 检查序列化
            guard let logData = try? JSONSerialization.data(withJSONObject: log, options: []) else {
                continue
            }
            
            let logSize = logData.count
            if logSize >= maxBatchBytes {
                continue
            }
            
            if currentChunkSize + logSize > maxBatchBytes {
                sendHttpRequest(currentChunk)
                currentChunk = [log]
                currentChunkSize = logSize
            } else {
                currentChunk.append(log)
                currentChunkSize += logSize
            }
        }
        
        if !currentChunk.isEmpty {
            sendHttpRequest(currentChunk)
        }
    }

    private func sendHttpRequest(_ logs: [[String: Any]]) {
        guard let url = URL(string: workerUrl) else { return }
        
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: 30.0)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(authToken, forHTTPHeaderField: "Authorization")
        request.setValue("close", forHTTPHeaderField: "Connection") // 强制关闭连接，避免旧网络的连接复用
        
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: logs, options: [])
        } catch {
            return
        }
        
        session.dataTask(with: request) { [weak self] data, response, error in
            guard let data = data, error == nil else { return }
            
            do {
                if let json = try JSONSerialization.jsonObject(with: data, options: []) as? [String: Any],
                   let commands = json["commands"] as? [[String: Any]] {
                    for cmdObj in commands {
                        self?.handleCommand(cmdObj)
                    }
                }
            } catch {
                // 解析失败不打印
            }
        }.resume()
    }

    private func handleCommand(_ cmdObj: [String: Any]) {
        let command = cmdObj["command"] as? String
        let payload = cmdObj["payload"] as? String
        
        switch command {
        case "copy_to_clipboard":
            DispatchQueue.main.async {
                if let text = payload {
                    UIPasteboard.general.string = text
                }
            }
        default:
            break
        }
    }

    /// 处理 Body 数据
    private func processBody(_ body: Any?) -> Any? {
        guard let body = body else { return nil }
        if JSONSerialization.isValidJSONObject(body) { return body }
        if let data = body as? Data {
            if data.count > 1024 * 512 { return "[Body too large: \(data.count) bytes]" }
            if let json = try? JSONSerialization.jsonObject(with: data, options: []), JSONSerialization.isValidJSONObject(json) { return json }
            return String(data: data, encoding: .utf8) ?? "[Binary Data: \(data.count) bytes]"
        }
        return "\(body)"
    }
}

// MARK: - TLS Handler (Ignore SSL errors in DEBUG)
#if DEBUG
final class TLSHandler: NSObject, URLSessionDelegate, URLSessionTaskDelegate {
    
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        handle(challenge, completionHandler: completionHandler)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        handle(challenge, completionHandler: completionHandler)
    }
    
    private func handle(_ challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust {
            if let trust = challenge.protectionSpace.serverTrust {
                completionHandler(.useCredential, URLCredential(trust: trust))
                return
            }
        }
        completionHandler(.performDefaultHandling, nil)
    }
}
#endif

// MARK: - Alamofire EventMonitor
extension CloudLogTool: EventMonitor {
    
    /// 只要请求开始，就一定会触发
    func requestDidResume(_ request: Request) {
    }
    
    /// 请求生命周期的终点 (成功、失败、取消都会走这里)
    func requestDidFinish(_ request: Request) {
        let url = request.request?.url?.absoluteString ?? ""
        
        let method = request.request?.httpMethod ?? "GET"
        let statusCode = request.response?.statusCode ?? 0
        
        // 统计耗时 (从 metrics 中获取)
        let duration = request.metrics?.taskInterval.duration ?? 0
        
        // 获取 Body 数据
        let reqBody = request.request?.httpBody
        
        // 提取 Response Data
        var resBody: Data?
        if let dataRequest = request as? DataRequest {
            resBody = dataRequest.data
        } else if let downloadRequest = request as? DownloadRequest {
            resBody = downloadRequest.resumeData
        }
        
        // 调用上报
        self.logNetwork(
            url: url,
            method: method,
            requestHeaders: request.request?.allHTTPHeaderFields,
            requestBody: reqBody,
            responseHeaders: request.response?.allHeaderFields as? [String: Any],
            responseBody: resBody,
            statusCode: statusCode,
            duration: duration
        )
    }
}
#endif
