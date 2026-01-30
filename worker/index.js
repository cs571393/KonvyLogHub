export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        }
      });
    }

    if (request.method !== "POST") {
      return new Response("Only POST allowed", { status: 405 });
    }

    // 校验 Token
    const auth = request.headers.get("Authorization");
    if (auth !== env.AUTH_TOKEN) {
      return new Response("Unauthorized", { status: 401 });
    }

    const logData = await request.json();

    // 构建 Pusher API 请求 (REST API)
    const timestamp = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      name: "log-event",
      channels: ["konvy-logs"],
      data: JSON.stringify(logData)
    });

    // 这一步在 Worker 中需要 node:crypto 或使用 Web Crypto API
    // 为了兼容性，我们假设环境支持 nodejs_compat
    const crypto = require('node:crypto');
    const body_md5 = crypto.createHash('md5').update(body).digest('hex');
    const auth_timestamp = timestamp;
    const auth_version = "1.0";
    
    const string_to_sign = `POST\n/apps/${env.PUSHER_APP_ID}/events\nauth_key=${env.PUSHER_KEY}&auth_timestamp=${auth_timestamp}&auth_version=${auth_version}&body_md5=${body_md5}`;
    const auth_signature = crypto.createHmac('sha256', env.PUSHER_SECRET).update(string_to_sign).digest('hex');

    const pusherUrl = `https://api-${env.PUSHER_CLUSTER}.pusher.com/apps/${env.PUSHER_APP_ID}/events?auth_key=${env.PUSHER_KEY}&auth_timestamp=${auth_timestamp}&auth_version=${auth_version}&body_md5=${body_md5}&auth_signature=${auth_signature}`;

    await fetch(pusherUrl, {
      method: "POST",
      body: body,
      headers: { "Content-Type": "application/json" }
    });

    return new Response("OK", { 
      headers: { "Access-Control-Allow-Origin": "*" } 
    });
  }
};
