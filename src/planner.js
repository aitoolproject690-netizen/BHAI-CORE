import { executeAgentTool, listAgentTools } from "./agent.js";

const TOOL_NAMES = new Set(listAgentTools().map(tool => tool.name));
const MAX_STEPS = Number(process.env.BHAI_AGENT_MAX_STEPS || 8);

const rules = [
  { when: /\b(search|find|lookup|document|file)\b/i, tool: "rag_search" },
  { when: /\b(image|photo|picture|screenshot)\b/i, tool: "vision_analyze" },
  { when: /\b(generate|create|draw)\b.*\b(image|picture)\b/i, tool: "image_generate" },
  { when: /\b(transcribe|speech to text|audio to text)\b/i, tool: "voice_transcribe" },
  { when: /\b(text to speech|speak|voice|tts)\b/i, tool: "voice_synthesize" },
  { when: /\b(model|models)\b/i, tool: "models" }
];

export function planAgentRequest({ text, tool, input = {} }) {
  const request = String(text || "").trim();
  if (!request && !tool) throw new Error("text or tool is required");

  if (tool) {
    if (!TOOL_NAMES.has(tool)) throw new Error("Unknown agent tool: " + tool);
    return [{ id: "step_1", tool, input, dependsOn: [] }];
  }

  const match = rules.find(rule => rule.when.test(request));
  if (match) return [{ id: "step_1", tool: match.tool, input: { ...input, query: input.query || request }, dependsOn: [] }];

  return [{ id: "step_1", tool: "chat", input: {
    ...input,
    messages: input.messages || [{ role: "user", content: request }]
  }, dependsOn: [] }];
}

export function validatePlan(plan) {
  if (!Array.isArray(plan) || !plan.length) throw new Error("Plan must contain at least one step");
  if (plan.length > MAX_STEPS) throw new Error("Agent plan exceeds maximum steps");
  const ids = new Set();
  for (const step of plan) {
    if (!step?.id || ids.has(step.id)) throw new Error("Invalid or duplicate step id");
    if (!TOOL_NAMES.has(step.tool)) throw new Error("Unknown tool in plan: " + step.tool);
    ids.add(step.id);
    if (!Array.isArray(step.dependsOn)) throw new Error("dependsOn must be an array");
    for (const dependency of step.dependsOn) if (!ids.has(dependency)) throw new Error("Dependency must reference an earlier step");
  }
  return true;
}

export async function runAgentPlan(plan, identity) {
  validatePlan(plan);
  const results = [];
  for (const step of plan) {
    try {
      const result = await executeAgentTool(step.tool, step.input || {}, identity);
      results.push({ id: step.id, tool: step.tool, status: "succeeded", result });
    } catch (error) {
      results.push({ id: step.id, tool: step.tool, status: "failed", error: error.message });
      break;
    }
  }
  return {
    status: results.length === plan.length && results.every(item => item.status === "succeeded") ? "succeeded" : "failed",
    completedSteps: results.length,
    totalSteps: plan.length,
    steps: results
  };
}
