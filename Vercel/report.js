 // api/report.js
  export default async function handler(req, res) {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // 验证 token
    if (req.headers.authorization !== 'konvy-debug-2026') {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      // 转发到 Cloudflare Worker
      const response = await fetch('https://konvyloghub.pages.dev/report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': req.headers.authorization,
        },
        body: JSON.stringify(req.body),
      });

      const data = await response.json();
      res.status(200).json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }