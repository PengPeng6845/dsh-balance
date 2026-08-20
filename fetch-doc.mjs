const url = process.argv[2];
const resp = await fetch(url, { signal: AbortSignal.timeout(20000) });
console.log("status:", resp.status);
const text = await resp.text();
console.log(text.slice(0, 3000));
