// ページ → Claude のイベントキュー。
// 発言や「意味を調べて」はキューに入れ、listen 系ツールが取り出す。ツールの待ち時間の枠をまたいでも失われない。

export type PageEvent = Record<string, unknown> & { status: string };

const queue: PageEvent[] = [];
let waiter: ((e: PageEvent) => void) | null = null;

export function deliver(event: PageEvent): void {
  if (waiter) {
    const w = waiter;
    waiter = null;
    w(event);
  } else {
    queue.push(event);
  }
}

export function clearEvents(): void {
  queue.length = 0;
}

/** 待ち手を外す。以後のイベントはキューに入り、次の waitEvent が受け取る */
export function detachWaiter(): void {
  waiter = null;
}

/**
 * deadline までに次のイベントを待つ。来なければ onTimeout() の結果を返す。
 * immediate が値を返すとき（停止中など）は待たずにそれを返す。
 */
export function waitEvent(deadline: number, onTimeout: () => PageEvent, immediate?: () => PageEvent | null): Promise<PageEvent> {
  const now = immediate?.();
  if (now) return Promise.resolve(now);
  const next = queue.shift();
  if (next) return Promise.resolve(next);
  if (Date.now() >= deadline) return Promise.resolve(onTimeout());
  return new Promise((resolve) => {
    const done = (e: PageEvent) => {
      clearTimeout(timer);
      resolve(e);
    };
    const timer = setTimeout(() => {
      if (waiter === done) waiter = null;
      resolve(onTimeout());
    }, deadline - Date.now());
    waiter = done;
  });
}
