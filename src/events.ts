export type EventCallback<TSender, TArgs> = (sender: TSender, args: TArgs) => void;
export type EventFilter<TSender, TArgs> = (sender: TSender, args: TArgs) => boolean;

export class KisEventTicket<TSender, TArgs> {
  private active = true;

  constructor(
    private readonly handler: KisEventHandler<TSender, TArgs>,
    private readonly callback: EventCallback<TSender, TArgs>
  ) {}

  get registered(): boolean {
    return this.active && this.handler.has(this.callback);
  }

  unsubscribe(): void {
    if (!this.active) return;
    this.handler.remove(this.callback);
    this.active = false;
  }
}

export class KisEventHandler<TSender, TArgs> {
  private readonly handlers = new Set<EventCallback<TSender, TArgs>>();

  add(handler: EventCallback<TSender, TArgs>): KisEventTicket<TSender, TArgs> {
    this.handlers.add(handler);
    return new KisEventTicket(this, handler);
  }

  on(
    handler: EventCallback<TSender, TArgs>,
    options: { where?: EventFilter<TSender, TArgs>; once?: boolean } = {}
  ): KisEventTicket<TSender, TArgs> {
    const wrapped: EventCallback<TSender, TArgs> = (sender, args) => {
      if (options.where && options.where(sender, args)) return;
      if (options.once) this.remove(wrapped);
      handler(sender, args);
    };
    return this.add(wrapped);
  }

  once(handler: EventCallback<TSender, TArgs>, where?: EventFilter<TSender, TArgs>): KisEventTicket<TSender, TArgs> {
    return this.on(handler, { where, once: true });
  }

  remove(handler: EventCallback<TSender, TArgs>): void {
    this.handlers.delete(handler);
  }

  clear(): void {
    this.handlers.clear();
  }

  has(handler: EventCallback<TSender, TArgs>): boolean {
    return this.handlers.has(handler);
  }

  invoke(sender: TSender, args: TArgs): void {
    for (const handler of [...this.handlers]) handler(sender, args);
  }
}
