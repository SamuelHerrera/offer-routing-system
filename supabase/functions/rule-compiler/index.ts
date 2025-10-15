import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { deleteMessage, dequeueBatch } from "../_shared/queue.ts";
import { getServiceClient } from "../_shared/db.ts";
import {
  buildDecisionTree,
  generateFunctionFromTree,
} from "../_shared/rules.ts";

Deno.serve(() => {
  EdgeRuntime.waitUntil(compile());
  return new Response(JSON.stringify({ message: "ok" }));
});
addEventListener("beforeunload", (ev) => {
  console.log("Function will be shutdown due to", ev.detail);
});

async function compile() {
  const batch = await dequeueBatch<{
    created_at: string;
  }>("compile_queue");
  if (!batch.length) return;
  const supabase = getServiceClient();

  const { data: rules, error } = await supabase
    .from("rules").select("name, priority, predicate_json, route_name, enabled")
    .eq("enabled", true)
    .order("priority", { ascending: true });

  if (error) throw error;
  if (!rules || !rules.length) {
    throw new Error("No rules to compile");
  }

  const tree = buildDecisionTree(rules);
  const code = generateFunctionFromTree(tree);

  await supabase.from("dynamic_functions").upsert({
    name: "router_function",
    code,
  }, {
    onConflict: "name",
  });
  for (const item of batch) {
    await deleteMessage("compile_queue", item.msg_id);
  }
}
