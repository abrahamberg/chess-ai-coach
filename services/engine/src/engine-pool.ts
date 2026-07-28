import { UciEngine } from './uci.js';

/** Serializes access to a fixed-size pool of `UciEngine` processes: calls beyond
 * the pool size queue and run once an engine frees up. */
export class EnginePool {
  private readonly engines: UciEngine[];
  private readonly idle: UciEngine[];
  private readonly waiters: Array<(engine: UciEngine) => void> = [];

  constructor(size: number, engineFactory: () => UciEngine = () => new UciEngine()) {
    this.engines = Array.from({ length: size }, engineFactory);
    this.idle = [...this.engines];
  }

  async withEngine<T>(fn: (engine: UciEngine) => Promise<T>): Promise<T> {
    const engine = await this.acquire();
    try {
      return await fn(engine);
    } finally {
      this.release(engine);
    }
  }

  async quitAll(): Promise<void> {
    await Promise.all(this.engines.map((engine) => engine.quit()));
  }

  get size(): number {
    return this.engines.length;
  }

  get busy(): number {
    return this.engines.length - this.idle.length;
  }

  private acquire(): Promise<UciEngine> {
    const engine = this.idle.pop();
    if (engine) return Promise.resolve(engine);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private release(engine: UciEngine): void {
    const next = this.waiters.shift();
    if (next) {
      next(engine);
      return;
    }
    this.idle.push(engine);
  }
}
