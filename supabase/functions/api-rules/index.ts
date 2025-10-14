import { serve } from "std/http/server";
import { getServiceClient } from "../_shared/db.ts";
import { enqueue } from "../_shared/queue.ts";

function authorize(req: Request) {
  const adminToken = Deno.env.get("ADMIN_TOKEN");
  const header = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!adminToken) return false;
  return header === `Bearer ${adminToken}`;
}

type RulePayload = {
  name: string;
  priority: number;
  predicate_json: unknown;
  route_name: string;
  enabled?: boolean;
};

serve(async (req) => {
  if (!authorize(req)) return new Response("Unauthorized", { status: 401 });
  const supabase = getServiceClient();
  if (req.method === "POST") {
    const rules = await req.json() as RulePayload | RulePayload[];
    const list = Array.isArray(rules) ? rules : [rules];
    for (const r of list) {
      const { error } = await supabase
        .rpc("upsert_rule", {
          p_name: r.name,
          p_priority: r.priority,
          p_predicate: r.predicate_json as object,
          p_route: r.route_name,
          p_enabled: r.enabled ?? true,
        });
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400 });
    }
    await enqueue("compile_queue", { reason: "rules_updated" });
    return new Response(JSON.stringify({ status: "ok", updated: list.length }));
  }
  if (req.method === "GET") {
    const { data, error } = await supabase.from("rules").select("*").order("priority");
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400 });
    return new Response(JSON.stringify(data));
  }
  return new Response("Method Not Allowed", { status: 405 });
});

