export async function readRequestBody(req, maxBytes) {
  const limit = Number(maxBytes);
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw Object.assign(new Error("Invalid request body limit"), { code: "REQUEST_BODY_LIMIT_INVALID", status: 500 });
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
    bytes += buffer.length;
    if (bytes > limit) {
      throw Object.assign(new Error("Request body too large"), { code: "REQUEST_BODY_TOO_LARGE", status: 413 });
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
