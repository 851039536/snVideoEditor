/**
 * Minimal promise-concurrency limiter (pLimit style).
 * Ensures at most `concurrency` async tasks run simultaneously; the rest queue.
 * Used to avoid spawning too many ffprobe/ffmpeg child processes at once.
 */
export function pLimit(concurrency: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: (() => void)[] = [];

  function next(): void {
    active--;
    if (queue.length > 0) {
      const run = queue.shift();
      if (run) {
        run();
      }
    }
  }

  return <T>(fn: () => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      function run(): void {
        active++;
        fn().then(resolve, reject).finally(next);
      }
      if (active < concurrency) {
        run();
      } else {
        queue.push(run);
      }
    });
  };
}
