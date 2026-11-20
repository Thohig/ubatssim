import type { Order, OrderSource, QueuedOrder } from './orders';

/** FIFO queue of orders, drained at the start of each simulation step. */
export class OrderQueue {
  private items: QueuedOrder[] = [];

  push(order: Order, source: OrderSource): void {
    this.items.push({ order, source });
  }

  drain(): QueuedOrder[] {
    const out = this.items;
    this.items = [];
    return out;
  }

  /** The waiting orders, oldest first (not removed). */
  peek(): readonly QueuedOrder[] {
    return this.items;
  }

  get length(): number {
    return this.items.length;
  }
}
