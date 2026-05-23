import { sleep } from "./utils.js";

export class RateLimiter {
  private count = 0;
  private last = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    readonly rate: number,
    readonly periodMs: number
  ) {}

  async acquire(onBlocked?: () => void): Promise<void> {
    const run = this.queue.then(async () => {
      const now = Date.now();
      if (now - this.last > this.periodMs) {
        this.count = 0;
        this.last = now;
      }
      if (this.count >= this.rate) {
        onBlocked?.();
        await sleep(Math.max(this.periodMs - (Date.now() - this.last) + 50, 0));
        this.count = 0;
        this.last = Date.now();
      }
      this.count += 1;
    });
    this.queue = run.catch(() => undefined);
    await run;
  }
}
