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

      return new Response("OK", { 
        status: supabaseRes.status,
        headers: { "Access-Control-Allow-Origin": "*" } 
      });

    } catch (err) {
      return new Response("Error: " + err.message, { status: 500 });
    }
  }
};
