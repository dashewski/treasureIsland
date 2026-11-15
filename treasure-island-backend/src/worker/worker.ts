import { WORKER_FAST_INTERVAL, WORKER_SLOW_INTERVAL } from "../constants";
import { fastPass, slowPass } from "./passes";

// Runs a pass, waits for it to finish, then waits the interval: passes of one loop never overlap.
function loop(pass: () => Promise<void>, intervalSeconds: number, name: string) {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> = Promise.resolve();

  const tick = () => {
    running = (async () => {
      try {
        await pass();
      } catch (error: unknown) {
        console.error(`worker: ${name} pass failed`, error);
      }
      if (!stopped) timer = setTimeout(tick, intervalSeconds * 1000);
    })();
  };
  tick();

  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await running;
  };
}

// starts both loops; the returned function stops them and waits for the running pass
export function startWorker(): () => Promise<void> {
  const stopFast = loop(fastPass, WORKER_FAST_INTERVAL, "fast");
  const stopSlow = loop(slowPass, WORKER_SLOW_INTERVAL, "slow");
  return async () => {
    await Promise.all([stopFast(), stopSlow()]);
  };
}
