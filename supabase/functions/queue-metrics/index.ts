import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { metricsAll } from "../_shared/queue.ts";

EdgeRuntime.waitUntil(process());
Deno.serve(() => {
  return new Response(JSON.stringify({ message: "ok" }));
});
addEventListener("beforeunload", (ev) => {
  console.log("Function will be shutdown due to", ev.detail);
});

async function process() {
  const metrics = await metricsAll();
  console.log(metrics);
  // todo: send to sentry
}
