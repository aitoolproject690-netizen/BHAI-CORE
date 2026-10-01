export const EVENTS = Object.freeze({
  START: "start",
  TOKEN: "token",
  COMPLETE: "complete",
  ERROR: "error"
});

export function tokenEvent(text) {
  return { type: EVENTS.TOKEN, text: String(text ?? "") };
}

export function completeEvent(result) {
  return {
    type: EVENTS.COMPLETE,
    provider: result.provider,
    model: result.model,
    attempts: result.attempts
  };
}

export function errorEvent(error) {
  return { type: EVENTS.ERROR, error: error?.message || "Unknown error" };
}
