import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { deleteMessage, dequeueBatch, enqueue } from "../_shared/queue.ts";
import { getServiceClient } from "../_shared/db.ts";
import { RoutingMessage } from "../_types/RoutingMessage.ts";

EdgeRuntime.waitUntil(process());
Deno.serve(() => {
  return new Response(JSON.stringify({ message: "ok" }));
});
addEventListener("beforeunload", (ev) => {
  console.log("Function will be shutdown due to", ev.detail);
});

async function process() {
  const decide = await loadDecisionTree();
  const batch = await dequeueBatch<RoutingMessage>("routing_queue");
  for (const item of batch) {
    try {
      const { route } = decide(item.message);
      await enqueue(route, item.message);
      await deleteMessage("routing_queue", item.msg_id);
    } catch (_e) {
      await enqueue("routing_dlq", {
        ...item.message,
        error: (_e as Error).message,
      }).catch((e) => {
        // todo: send to sentry
        console.error(e);
      });
      await deleteMessage("routing_queue", item.msg_id).catch((e) => {
        // todo: send to sentry
        console.error(e);
      });
    }
  }
}

async function loadDecisionTree(): Promise<
  (msg: RoutingMessage) => { route: string }
> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("dynamic_functions")
    .select("code")
    .eq("name", "router_function")
    .single();
  if (error || !data?.code) {
    throw new Error("Failed to load router function");
  }
  // code must export default function (msg) { return { route: string } }
  return new Function("msg", data.code as string) as (
    msg: RoutingMessage,
  ) => { route: string };
}
