export async function readRequestBody(req, maxBytes) {
  const limit = Number(maxBytes);
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw Object.assign(new Error("Invalid request body limit"), { code: "REQUEST_BODY_LIMIT_INVALID", status: 500 });
  }
  let body = "";
  let bytes = 0;
  for await (const chunk of req) {
    const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    bytes += Buffer.byteLength(text, "utf8");
    if (bytes > limit) {
      throw Object.assign(new Error("Request body too large"), { code: "REQUEST_BODY_TOO_LARGE", status: 413 });
    }
    body += text;
  }
  return body;
}
