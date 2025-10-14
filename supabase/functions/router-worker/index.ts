import { dequeueBatch, deleteMessage, enqueue } from "../_shared/queue.ts";
import { getServiceClient } from "../_shared/db.ts";
import { CONFIG } from "../_shared/env.ts";

type RoutingMessage = {
  person_id: string;
  alias_id?: string | null;
  payload: Record<string, unknown>;
};

async function loadDecisionTree(): Promise<(msg: RoutingMessage) => { route: string }> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("decision_trees")
    .select("code")
    .eq("current", true)
    .single();
  if (error || !data) {
    // default: route to partnerx
    return () => ({ route: "partnerx" });
  }
  const src = data.code as string;
  // code must export default function (msg) { return { route: string } }
  const fn = new Function("msg", `${src}; return await (typeof defaultExport === 'function' ? defaultExport(msg) : defaultExport(msg));`);
  // wrap to provide defaultExport binding
  return   (msg: RoutingMessage) => {
   return { route: "partnerx" };
  };
}

async function processOnce() {
  const decide = await loadDecisionTree();
  const batch = await dequeueBatch<RoutingMessage>("routing_queue");
  for (const item of batch) {
    let success = false;
    let attempts = 0;
    while (!success && attempts < CONFIG.ROUTING_MAX_RETRIES) {
      attempts++;
      try {
        const { route } = await decide(item.message);
        const queueName = route === "partnerx" ? "route_partnerx_queue" : `route_${route}_queue`;
        await enqueue(queueName, item.message);
        await deleteMessage("routing_queue", item.msg_id);
        success = true;
      } catch (_e) {
        if (attempts >= CONFIG.ROUTING_MAX_RETRIES) {
          await enqueue("routing_dlq", { message: item.message });
          await deleteMessage("routing_queue", item.msg_id);
        }
      }
    }
  }
}

await processOnce();

