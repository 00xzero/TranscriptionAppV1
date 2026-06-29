/**
 * Tiny zero-dependency CORS proxy for the Soniox POC.
 *
 * Only needed if calling api.soniox.com directly from the browser fails with a
 * CORS / network error. Run it, then set the POC's "API base" field to
 * http://localhost:8787 and transcribe as normal.
 *
 *   node proxy.js
 *
 * Requires Node 18+ (uses the built-in global fetch).
 */

const http = require("http");

const PORT = process.env.PORT || 8787;
const TARGET = "https://api.soniox.com";

const server = http.createServer(async (req, res) => {
  // CORS preflight + headers for every response
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Buffer the raw body (handles JSON and multipart uploads alike)
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);

  const headers = {};
  if (req.headers["authorization"]) headers["authorization"] = req.headers["authorization"];
  if (req.headers["content-type"]) headers["content-type"] = req.headers["content-type"];

  try {
    const upstream = await fetch(TARGET + req.url, {
      method: req.method,
      headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
    });

    const buf = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, {
      "Content-Type": upstream.headers.get("content-type") || "application/json",
    });
    res.end(buf);
    console.log(`${req.method} ${req.url} → ${upstream.status}`);
  } catch (e) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "proxy_error", message: String(e) }));
    console.error(`${req.method} ${req.url} → proxy error:`, e.message);
  }
});

server.listen(PORT, () => {
  console.log(`Soniox CORS proxy → ${TARGET}`);
  console.log(`Listening on http://localhost:${PORT}`);
  console.log(`Set the POC "API base" field to http://localhost:${PORT}`);
});
