// 指令暂存池 (内存方式)
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
      
      // 存入内存，设置 60s 过期，防止内存无限增长
      PENDING_COMMANDS.set(deviceId, { 
        command, 
        payload, 
        expires: Date.now() + 60000 
      });
      
      return new Response(JSON.stringify({ status: "queued" }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    // --- 逻辑 B: 移动端上报日志 (兼任心跳获取指令) ---
    const logData = data; 
    const sample = Array.isArray(logData) ? logData[0] : logData;
    const dId = sample?.deviceId || sample?.device_id;
    
    let commands = [];
    if (dId && PENDING_COMMANDS.has(dId)) {
      const cmd = PENDING_COMMANDS.get(dId);
      
      // 检查是否过期
      if (Date.now() < cmd.expires) {
        commands.push({ command: cmd.command, payload: cmd.payload });
      }
      
      // 【自动清除】取走即焚，无论是否过期都删掉
      PENDING_COMMANDS.delete(dId);
    }

    // 清理一下其他过期的指令 (简单的 GC 逻辑)
    if (PENDING_COMMANDS.size > 100) {
      for (const [id, c] of PENDING_COMMANDS.entries()) {
        if (Date.now() > c.expires) PENDING_COMMANDS.delete(id);
      }
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

    await fetch(`${supabaseUrl}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(broadcastPayload)
    });

    return new Response(JSON.stringify({ status: "OK", commands }), { 
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } 
    });

  } catch (err) {
    return new Response("Error: " + err.message, { status: 500 });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    }
  });
}

export async function onRequestGet() {
  return new Response("Only POST allowed", { 
    status: 405,
    headers: { "Access-Control-Allow-Origin": "*" } 
  });
}
