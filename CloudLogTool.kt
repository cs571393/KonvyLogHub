package com.konvy.konvy.util

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.google.firebase.messaging.FirebaseMessaging
import com.konvy.konvy.BuildConfig
import com.konvy.konvy.KonvyApplication
import com.konvy.konvy.rebuild.androidId
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume

/**
 * Log发送工具
 * */
object CloudLogTool {

    private var fcmToken = "未获取到token"

    init {
        CoroutineScope(Dispatchers.Main + Job()).launch {
            // 同时启动两个异步任务
            val firebaseTask = async { getFirebaseToken() }
            // 设置 3 秒超时
            val result = withTimeoutOrNull(3_000L) {
                firebaseTask.await()
            }
            fcmToken = result ?: "未获取到token"
        }
    }

    // --- 配置区 ---
    private const val WORKER_URL = "https://konvyloghub.pages.dev/report"
    private const val AUTH_TOKEN = "konvy-debug-2026"
    private const val BATCH_INTERVAL = 3000L // 3秒
    private const val MAX_BATCH_BYTES = 900 * 1024

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .build()

    private val logBuffer = mutableListOf<Map<String, Any>>()
    private val handler = Handler(Looper.getMainLooper())
    private var lastMetadata: JSONObject? = null
    private var sendRunnable: Runnable? = null

    /**
     * 上报日志
     * @param content 日志内容 (String 或 Map)
     * @param level info, warn, error
     */
    fun log(content: Any?, level: String = "info") {
        if (content == null) return
        if (content is String && content.trim().isEmpty()) return
        if (content is Map<*, *> && content.isEmpty()) return

        val deviceId = getDeviceId()
        val deviceName = "${Build.MANUFACTURER} ${Build.MODEL}"

        // 构建当前 Metadata
        val currentMetadata = JSONObject().apply {
            put("user_id", getUserId())
            put("username", getUserName())
            put("fcm_token", getFcmToken())
            put("imei", deviceId)
            put("deviceName", deviceName)
            put("osVersion", "Android ${Build.VERSION.RELEASE}")
            put("appVersion", BuildConfig.VERSION_NAME)
        }

        // 构建日志项
        val logItem = mutableMapOf(
            "deviceId" to deviceId,
            "deviceName" to deviceName,
            "level" to level,
            "content" to content,
            "timestamp" to System.currentTimeMillis() / 1000.0
        )

        // 差异化携带 Metadata，仅在变化时附带
        if (lastMetadata == null || lastMetadata.toString() != currentMetadata.toString()) {
            val metaMap = mutableMapOf<String, Any>()
            currentMetadata.keys().forEach { key ->
                metaMap[key] = currentMetadata.get(key)
            }
            logItem["metadata"] = metaMap
            lastMetadata = currentMetadata
        }

        synchronized(logBuffer) {
            logBuffer.add(logItem)
            if (sendRunnable == null) {
                sendRunnable = Runnable { flush() }
                handler.postDelayed(sendRunnable!!, BATCH_INTERVAL)
            }
        }
    }

    /**
     * 网络日志上报 (用于 Network Tab)
     */
    fun logNetwork(
        url: String,
        method: String,
        requestHeaders: Map<String, String>?,
        requestBody: Any?,
        responseHeaders: Map<String, String>?,
        responseBody: Any?,
        statusCode: Int,
        durationMs: Long
    ) {
        val deviceId = getDeviceId()
        val deviceName = "${Build.MANUFACTURER} ${Build.MODEL}"

        val logItem = mutableMapOf<String, Any>(
            "deviceId" to deviceId,
            "deviceName" to deviceName,
            "level" to "info",
            "type" to "network",
            "method" to method.uppercase(),
            "url" to url,
            "status" to statusCode,
            "duration" to durationMs,
            "timestamp" to System.currentTimeMillis() / 1000.0
        )

        val reqObj = JSONObject().apply {
            put("headers", JSONObject(requestHeaders ?: emptyMap<String, String>()))
            put("body", processBody(requestBody))
        }
        val resObj = JSONObject().apply {
            put("headers", JSONObject(responseHeaders ?: emptyMap<String, String>()))
            put("body", processBody(responseBody))
        }

        logItem["request"] = reqObj
        logItem["response"] = resObj

        // 差异化携带 Metadata
        val currentMetadata = JSONObject().apply {
            put("user_id", getUserId())
            put("username", getUserName())
            put("fcm_token", getFcmToken())
            put("imei", deviceId)
            put("deviceName", deviceName)
            put("osVersion", "Android ${Build.VERSION.RELEASE}")
            put("appVersion", BuildConfig.VERSION_NAME)
        }

        if (lastMetadata == null || lastMetadata.toString() != currentMetadata.toString()) {
            logItem["metadata"] = currentMetadata
            lastMetadata = currentMetadata
        }

        synchronized(logBuffer) {
            logBuffer.add(logItem)
            if (sendRunnable == null) {
                sendRunnable = Runnable { flush() }
                handler.postDelayed(sendRunnable!!, BATCH_INTERVAL)
            }
        }
    }

    /**
     * Socket 日志上报
     * @param action 动作名称 (emit, on, connect, etc.)
     * @param content 内容
     */
    fun logSocket(action: String, content: Any?) {
        val deviceId = getDeviceId()
        val deviceName = "${Build.MANUFACTURER} ${Build.MODEL}"

        val logItem = mutableMapOf<String, Any>(
            "deviceId" to deviceId,
            "deviceName" to deviceName,
            "level" to "socket", // 方便在日志列表过滤
            "type" to "socket",
            "action" to action,
            "content" to processBody(content),
            "timestamp" to System.currentTimeMillis() / 1000.0
        )

        // 构建当前 Metadata
        val currentMetadata = JSONObject().apply {
            put("user_id", getUserId())
            put("username", getUserName())
            put("fcm_token", getFcmToken())
            put("imei", deviceId)
            put("deviceName", deviceName)
            put("osVersion", "Android ${Build.VERSION.RELEASE}")
            put("appVersion", BuildConfig.VERSION_NAME)
        }

        if (lastMetadata == null || lastMetadata.toString() != currentMetadata.toString()) {
            logItem["metadata"] = currentMetadata
            lastMetadata = currentMetadata
        }

        synchronized(logBuffer) {
            logBuffer.add(logItem)
            if (sendRunnable == null) {
                sendRunnable = Runnable { flush() }
                handler.postDelayed(sendRunnable!!, BATCH_INTERVAL)
            }
        }
    }

    /**
     * 处理请求/响应体，尝试解析为 JSON
     */
    private fun processBody(body: Any?): Any {
        if (body == null) return ""
        if (body is JSONObject || body is JSONArray) return body
        if (body is String) {
            return try {
                JSONObject(body)
            } catch (e: Exception) {
                try {
                    JSONArray(body)
                } catch (e2: Exception) {
                    body
                }
            }
        }
        if (body is ByteArray) {
            if (body.size > 512 * 1024) return "[Body too large: ${body.size} bytes]"
            val str = String(body)
            return try {
                JSONObject(str)
            } catch (e: Exception) {
                str
            }
        }
        return body.toString()
    }

    private fun flush() {
        val logsToSend: List<Map<String, Any>>
        synchronized(logBuffer) {
            logsToSend = ArrayList(logBuffer)
            logBuffer.clear()
            sendRunnable = null
        }
        if (logsToSend.isNotEmpty()) {
            performUpload(logsToSend)
        }
    }

    private fun performUpload(logs: List<Map<String, Any>>) {
        var batch = JSONArray()
        var currentSize = 0

        for (log in logs) {
            val logJson = JSONObject(log).toString()
            val logBytes = logJson.toByteArray().size

            if (currentSize + logBytes > MAX_BATCH_BYTES && batch.length() > 0) {
                // 当前批次已满，先发送，再开新批次
                sendHttpRequest(batch.toString())
                batch = JSONArray()
                currentSize = 0
            }
            batch.put(JSONObject(log))
            currentSize += logBytes
        }

        if (batch.length() > 0) {
            sendHttpRequest(batch.toString())
        }
    }

    private fun sendHttpRequest(jsonString: String) {
        val request = Request.Builder()
            .url(WORKER_URL)
            .post(jsonString.toRequestBody("application/json".toMediaType()))
            .addHeader("Authorization", AUTH_TOKEN)
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
            }

            override fun onResponse(call: Call, response: Response) {
                if (response.isSuccessful) {
                    val bodyStr = response.body?.string()
                    if (!bodyStr.isNullOrEmpty()) {
                        try {
                            val json = JSONObject(bodyStr)
                            val commands = json.optJSONArray("commands")
                            if (commands != null && commands.length() > 0) {
                                for (i in 0 until commands.length()) {
                                    handleCommand(commands.getJSONObject(i))
                                }
                            }
                        } catch (e: Exception) {
                        }
                    }
                }
                response.close()
            }
        })
    }

    private fun handleCommand(cmdObj: JSONObject) {
        val command = cmdObj.optString("command")
        val payload = cmdObj.optString("payload")

        when (command) {
            "copy_to_clipboard" -> {
                handler.post {
                    try {
                        val clipboard = KonvyApplication.getApplication()
                            ?.getSystemService(Context.CLIPBOARD_SERVICE) as? android.content.ClipboardManager
                        val clip = android.content.ClipData.newPlainText("KonvyLogHub", payload)
                        clipboard?.setPrimaryClip(clip)
                    } catch (e: Exception) {
                    }
                }
            }
        }
    }

    private fun getDeviceId(): String {
        return androidId
    }

    private fun getUserId(): String = Tool.getUserInfo()?.id.toString()

    private fun getUserName(): String = Tool.getUserInfo()?.userName ?: ""

    private fun getFcmToken(): String = fcmToken

    // 将 Firebase 异步操作封装为协程
    private suspend fun getFirebaseToken(): String = suspendCancellableCoroutine { cont ->
        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if (task.isSuccessful) {
                cont.resume(task.result ?: "未获取到token")
            } else {
                cont.resume("未获取到token")
            }
        }
    }
}
