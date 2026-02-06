// 简易的指令暂存池 (在 Worker 实例活跃期间有效)
const PENDING_COMMANDS = new Map();

export async function onRequestPost(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  // 1. 校验 Token
  const auth = request.headers.get("Authorization");
  if (auth !== env.AUTH_TOKEN) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const data = await request.json();

    // --- 逻辑 A: 网页端推送指令 ---
    if (action === "push_command") {
      const { deviceId, command, payload } = data;
      if (!deviceId) return new Response("Missing deviceId", { status: 400 });
      
      // 存入队列 (每个设备只保留最后一条未取走的指令)
      PENDING_COMMANDS.set(deviceId, { command, payload, ts: Date.now() });
      
      return new Response(JSON.stringify({ status: "queued" }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    // --- 逻辑 B: 移动端上报日志 (兼任心跳获取指令) ---
    const logData = await request.json().catch(() => data); // 兼容已经 parse 过的情况
    
    // 检查该设备是否有待处理指令
    // 如果 logData 是数组，取第一个元素的 deviceId
    const sample = Array.isArray(logData) ? logData[0] : logData;
    const dId = sample?.deviceId || sample?.device_id;
    
    let commands = [];
    if (dId && PENDING_COMMANDS.has(dId)) {
      commands.push(PENDING_COMMANDS.get(dId));
      PENDING_COMMANDS.delete(dId); // 取走即焚
    }

    // --- 发送给 Supabase Realtime Broadcast ---
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_ANON_KEY;
    
    const broadcastPayload = {
      messages: [
        {
          topic: "konvy-logs",
          event: "log-event",
          payload: { data: logData }
        }
      ]
    };

    const supabaseRes = await fetch(`${supabaseUrl}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(broadcastPayload)
    });

    // 返回 OK 以及可能的指令列表
    return new Response(JSON.stringify({ 
      status: "OK", 
      commands: commands 
    }), { 
      status: 200,
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*" 
      } 
    });

  } catch (err) {
    return new Response("Error: " + err.message, { status: 500 });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    }
  });
}

export async function onRequestGet() {
  return new Response("Only POST allowed", { status: 405 });
}
