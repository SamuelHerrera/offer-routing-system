import { dequeueBatch, deleteMessage } from "../_shared/queue.ts";
import { getServiceClient } from "../_shared/db.ts";

type CompileTrigger = { reason: string };

function generateDecisionFunction(rules: Array<{ predicate_json: any; route_name: string }>): string {
  // naive ordered evaluation: first matching rule wins
  // export default async function defaultExport(msg) { ... }
  const cases = rules.map((r, i) => {
    const pred = JSON.stringify(r.predicate_json);
    return `if (evaluatePredicate(msg, ${pred})) return { route: ${JSON.stringify(r.route_name)} };`;
  }).join("\n");

  const helpers = `function evaluatePredicate(msg, pred){ if(pred.always) return true; if(pred.email && msg.payload && msg.payload.email){ if(pred.email.equals) return String(msg.payload.email).toLowerCase() === String(pred.email.equals).toLowerCase(); } return false; }`;

  const code = `${helpers}
export default async function defaultExport(msg){
  ${cases}
  return { route: 'partnerx' };
}`;
  return code;
}

async function compileOnce() {
  const batch = await dequeueBatch<CompileTrigger>("compile_queue");
  if (!batch.length) return;
  const supabase = getServiceClient();
  const { data: rules, error } = await supabase
    .from("rules").select("predicate_json, route_name").eq("enabled", true).order("priority", { ascending: true });
  if (error) throw error;
  const code = generateDecisionFunction(rules ?? []);
  // mark previous as not current
  await supabase.from("decision_trees").update({ current: false }).eq("current", true);
  await supabase.from("decision_trees").insert({ code, current: true, version: Date.now() });
  for (const item of batch) {
    await deleteMessage("compile_queue", item.msg_id);
  }
}

await compileOnce();

