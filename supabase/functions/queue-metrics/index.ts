import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { metricsAll } from "../_shared/queue.ts";
import { wrapWorker } from "../_shared/worker.ts";
import { captureMessage } from "../_shared/sentry.ts";

wrapWorker("queue-metrics", process);

async function process() {
  const metrics = await metricsAll();
  console.log(metrics);
  captureMessage("queue metrics", "info", { metrics });
}
