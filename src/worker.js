import { getQueuedJob, finishJob, failJob } from "./queue.js";

export async function processOne(handler) {
  const job = await getQueuedJob();
  if (!job) return null;

  try {
    const result = await handler(job);
    return await finishJob(job.id, result);
  } catch (error) {
    return await failJob(job.id, error);
  }
}

export function createWorker(handler, { intervalMs = 1000 } = {}) {
  let timer = null;
  let stopped = false;

  async function tick() {
    if (stopped) return;
    await processOne(handler);
  }

  return {
    start() {
      if (timer) return;
      stopped = false;
      timer = setInterval(() => { tick().catch(() => {}); }, intervalMs);
      tick().catch(() => {});
    },
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
    }
  };
}
