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
      
      // 使用 Cloudflare KV 存储，设置 60s 过期
      if (env.COMMAND_KV) {
        await env.COMMAND_KV.put(deviceId, JSON.stringify({ command, payload }), { expirationTtl: 60 });
      }
      
      return new Response(JSON.stringify({ status: "queued" }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    // --- 逻辑 B: 移动端上报日志 (兼任心跳获取指令) ---
    const logData = data; 
    const sample = Array.isArray(logData) ? logData[0] : logData;
    const dId = sample?.deviceId || sample?.device_id;
    
    let commands = [];
    if (dId && env.COMMAND_KV) {
      // 从 KV 获取指令
      const stored = await env.COMMAND_KV.get(dId);
      if (stored) {
        const cmd = JSON.parse(stored);
        commands.push({ command: cmd.command, payload: cmd.payload });
        // 【自动清除】取走即焚
        await env.COMMAND_KV.delete(dId);
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
