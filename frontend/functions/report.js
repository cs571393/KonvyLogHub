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

    // 1. 校验 Token
    const auth = request.headers.get("Authorization");
    if (auth !== env.AUTH_TOKEN) {
      return new Response("Unauthorized", { status: 401 });
    }

    try {
      const logData = await request.json();
      const body = JSON.stringify({
        name: "log-event",
        channels: ["konvy-logs"],
        data: JSON.stringify(logData)
      });

      // --- 使用 Web Crypto API 计算 MD5 和 HMAC ---
      
      // 2. 计算 Body MD5
      const msgUint8 = new TextEncoder().encode(body);
      const hashBuffer = await crypto.subtle.digest("MD5", msgUint8);
      const body_md5 = Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      // 3. 准备签名参数
      const timestamp = Math.floor(Date.now() / 1000);
      const auth_version = "1.0";
      const queryParams = `auth_key=${env.PUSHER_KEY}&auth_timestamp=${timestamp}&auth_version=${auth_version}&body_md5=${body_md5}`;
      const stringToSign = `POST\n/apps/${env.PUSHER_APP_ID}/events\n${queryParams}`;

      // 4. 计算 HMAC-SHA256 签名
      const encoder = new TextEncoder();
      const keyData = encoder.encode(env.PUSHER_SECRET);
      const key = await crypto.subtle.importKey(
        "raw", keyData, { name: "HMAC", hash: "SHA-256" },
        false, ["sign"]
      );
      const signatureBuffer = await crypto.subtle.sign(
        "HMAC", key, encoder.encode(stringToSign)
      );
      const auth_signature = Array.from(new Uint8Array(signatureBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      // 5. 发送请求给 Pusher
      const pusherUrl = `https://api-${env.PUSHER_CLUSTER}.pusher.com/apps/${env.PUSHER_APP_ID}/events?${queryParams}&auth_signature=${auth_signature}`;

      const pusherRes = await fetch(pusherUrl, {
        method: "POST",
        body: body,
        headers: { "Content-Type": "application/json" }
      });

      const resText = await pusherRes.text();
      return new Response(resText, { 
        status: pusherRes.status,
        headers: { "Access-Control-Allow-Origin": "*" } 
      });

    } catch (err) {
      return new Response("Error: " + err.message, { status: 500 });
    }
  }
};
