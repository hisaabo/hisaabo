/**
 * runInThread — run CPU-bound work in a worker thread with a hard timeout.
 *
 * Synchronous JavaScript (a catastrophic regex, a huge parse) cannot be
 * interrupted from the thread that runs it; the only safe bound is to run it
 * in a separate thread and terminate that thread. `modulePath` is an ES module
 * whose default export is `(input) => output | Promise<output>`; input and
 * output must be structured-cloneable.
 *
 * A timeout is a ThreadTimeoutError, a PermanentError: CPU blow-ups are
 * deterministic, so retrying would only burn the same time again.
 */
import { Worker, type ResourceLimits } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import { PermanentError } from "./errors.js";

export class ThreadTimeoutError extends PermanentError {
  override name = "ThreadTimeoutError";
}

export interface RunInThreadOptions {
  timeoutMs: number;
  resourceLimits?: ResourceLimits;
  signal?: AbortSignal;
}

// CommonJS bootstrap (eval workers are scripts); dynamic import() loads the ESM task.
const BOOTSTRAP = `
const { parentPort, workerData } = require("node:worker_threads");
import(workerData.moduleUrl)
  .then((m) => (m.default ?? m.run)(workerData.input))
  .then((output) => parentPort.postMessage({ ok: true, output }))
  .catch((e) => parentPort.postMessage({ ok: false, name: e && e.name, message: String(e && e.message || e) }));
`;

export function runInThread<I, O>(modulePath: string | URL, input: I, opts: RunInThreadOptions): Promise<O> {
  const moduleUrl = modulePath instanceof URL ? modulePath.href
    : modulePath.startsWith("file:") ? modulePath : pathToFileURL(modulePath).href;

  return new Promise<O>((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new Error("Aborted before start"));
    const worker = new Worker(BOOTSTRAP, {
      eval: true,
      workerData: { moduleUrl, input },
      resourceLimits: { maxOldGenerationSizeMb: 256, ...opts.resourceLimits },
    });
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      void worker.terminate();
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new ThreadTimeoutError(`Task exceeded ${opts.timeoutMs} ms and was terminated`))),
      opts.timeoutMs,
    );
    const onAbort = () => finish(() => reject(new Error("Aborted")));
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    worker.once("message", (msg: { ok: true; output: O } | { ok: false; name?: string; message: string }) => {
      finish(() => {
        if (msg.ok) resolve(msg.output);
        else reject(Object.assign(new Error(msg.message), { name: msg.name ?? "Error" }));
      });
    });
    worker.once("error", (err) => finish(() => reject(err)));
    worker.once("exit", (code) => finish(() => reject(new Error(`Worker thread exited with code ${code}`))));
  });
}
