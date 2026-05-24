/**
 * Minimal typed EventEmitter — no Node.js `events` dependency.
 *
 * Usage:
 *   type MyEvents = { data: (chunk: Uint8Array) => void; close: (code: number) => void };
 *   class MyClass extends EventEmitter<MyEvents> { ... }
 */

// Derive argument tuple from a function type.
type ArgsOf<F> = F extends (...args: infer A) => void ? A : never;

export class EventEmitter<
  EventMap extends Record<string, (...args: never[]) => void>,
> {
  private readonly _listeners: {
    [K in keyof EventMap]?: Array<EventMap[K]>;
  } = {};

  /**
   * Register an event listener.
   * Returns `this` for chaining.
   */
  on<K extends keyof EventMap>(event: K, listener: EventMap[K]): this {
    if (!this._listeners[event]) {
      this._listeners[event] = [];
    }
    this._listeners[event]!.push(listener);
    return this;
  }

  /**
   * Remove a previously registered listener.
   */
  off<K extends keyof EventMap>(event: K, listener: EventMap[K]): this {
    const list = this._listeners[event];
    if (!list) return this;
    const idx = list.indexOf(listener);
    if (idx >= 0) list.splice(idx, 1);
    return this;
  }

  /**
   * Register a one-time listener (auto-removed after first call).
   */
  once<K extends keyof EventMap>(event: K, listener: EventMap[K]): this {
    const wrapper = ((...args: ArgsOf<EventMap[K]>) => {
      this.off(event, wrapper as EventMap[K]);
      (listener as (...a: ArgsOf<EventMap[K]>) => void)(...args);
    }) as EventMap[K];
    return this.on(event, wrapper);
  }

  /**
   * Emit an event, calling all registered listeners synchronously.
   */
  protected emit<K extends keyof EventMap>(
    event: K,
    ...args: ArgsOf<EventMap[K]>
  ): void {
    const list = this._listeners[event];
    if (!list) return;
    for (const cb of [...list]) {
      (cb as (...a: ArgsOf<EventMap[K]>) => void)(...args);
    }
  }

  /**
   * Remove all listeners for an event, or all events if no event specified.
   */
  removeAllListeners(event?: keyof EventMap): this {
    if (event !== undefined) {
      delete this._listeners[event];
    } else {
      for (const key of Object.keys(this._listeners)) {
        delete this._listeners[key as keyof EventMap];
      }
    }
    return this;
  }
}
