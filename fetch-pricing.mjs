const url = "https://api-docs.deepseek.com/assets/js/main.48759f8c.js";
const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
const text = await resp.text();
console.log("len=" + text.length);
const re = /[^"{}]{0,80}(?:0\.0\d+|\$?\d+(?:\.\d+)?\s*(?:USD|CNY)|per 1M|per 1 M|cache hit|cache miss|output tokens|input tokens|peak|off-peak|v4-pro|v4-flash)[^"{}]{0,120}/gi;
const seen = new Set();
for (const m of text.match(re) ?? []) {
  const t = m.replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\s+/g, " ").trim();
  if (t.length > 8 && t.length < 260) seen.add(t);
}
console.log([...seen].slice(0, 80).join("\n---\n"));
