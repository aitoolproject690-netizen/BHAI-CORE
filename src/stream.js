export function writeSSE(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function startSSE(res) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
}

export function endSSE(res) {
  writeSSE(res, "done", { ok: true });
  res.end();
}


export function sendEvent(res, event) {
  writeSSE(res, event.type, event);
}
