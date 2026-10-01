import crypto from "node:crypto";

const MAX_AUDIO_BYTES = Number(process.env.BHAI_MAX_AUDIO_BYTES || 12_000_000);
const MAX_TTS_CHARS = Number(process.env.BHAI_MAX_TTS_CHARS || 5000);

function cleanUrl(url, fallback) { return String(url || fallback).replace(/\/$/, ""); }

export function voiceProviderInfo() {
  return {
    stt: { provider: "whisper", local: true, url: cleanUrl(process.env.WHISPER_URL, "http://127.0.0.1:9000"), configured: Boolean(process.env.WHISPER_ENABLED === "true") },
    tts: { provider: "piper", local: true, url: cleanUrl(process.env.PIPER_URL, "http://127.0.0.1:5000"), configured: Boolean(process.env.PIPER_ENABLED === "true") }
  };
}

export function createSpeechRequest({ audio, mimeType, language }) {
  if (!audio) throw new Error("audio is required");
  const bytes = Math.floor(String(audio).length * 0.75);
  if (bytes > MAX_AUDIO_BYTES) throw new Error("Audio is too large");
  return { id: "stt_" + crypto.randomUUID(), audio, mimeType: mimeType || "audio/wav", language: language || null };
}

export async function transcribeWhisper({ audio, mimeType, language, url }) {
  const baseUrl = cleanUrl(url, "http://127.0.0.1:9000");
  const buffer = Buffer.from(String(audio), "base64");
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimeType || "audio/wav" }), "audio.wav");
  if (language) form.append("language", String(language));
  const response = await fetch(baseUrl + "/transcribe", { method: "POST", body: form, signal: AbortSignal.timeout(60000) });
  const text = await response.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(data?.error || data?.message || data?.raw || "Whisper transcription failed");
  return { text: data.text || data.transcription || "", provider: "whisper" };
}

export function createTtsRequest({ text, voice, language }) {
  const value = String(text || "").trim();
  if (!value) throw new Error("text is required");
  if (value.length > MAX_TTS_CHARS) throw new Error("text is too long");
  return { id: "tts_" + crypto.randomUUID(), text: value, voice: voice || null, language: language || null };
}

export async function synthesizePiper({ text, voice, language, url }) {
  const request = createTtsRequest({ text, voice, language });
  const baseUrl = cleanUrl(url, "http://127.0.0.1:5000");
  const response = await fetch(baseUrl + "/synthesize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: request.text, voice: request.voice, language: request.language }),
    signal: AbortSignal.timeout(60000)
  });
  if (!response.ok) throw new Error("Piper synthesis failed: HTTP " + response.status);
  const bytes = Buffer.from(await response.arrayBuffer());
  return { provider: "piper", mimeType: response.headers.get("content-type") || "audio/wav", audio: bytes.toString("base64") };
}