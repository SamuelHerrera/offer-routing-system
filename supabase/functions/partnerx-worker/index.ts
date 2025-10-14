import { dequeueBatch, deleteMessage, enqueue } from "../_shared/queue.ts";
import { getServiceClient } from "../_shared/db.ts";
import { CONFIG } from "../_shared/env.ts";

type PartnerMessage = {
  person_id: string;
  alias_id?: string | null;
  payload: Record<string, unknown>;
};

async function loadPartnerArtifacts(partnerName: string) {
  const supabase = getServiceClient();
  const { data: fn, error } = await supabase
    .from("partner_functions")
    .select("dedupe_js, handler_js, retry_max")
    .eq("name", partnerName)
    .single();
  if (error || !fn) throw new Error("Missing partner artifacts");
  const { data: cfg, error: cfgErr } = await supabase
    .from("partner_configs")
    .select("config")
    .eq("partner_name", partnerName)
    .single();
  if (cfgErr || !cfg) throw new Error("Missing partner config");
  return { fn, config: cfg.config } as any;
}

function compileFunction(src: string, exportName: string) {
  const wrapped = `const ${exportName} = (function(){ ${src}; return (typeof default !== 'undefined' ? default : (typeof defaultExport !== 'undefined' ? defaultExport : undefined)); })();`;
  // deno-lint-ignore no-explicit-any
  const g: any = globalThis;
  // deno-lint-ignore no-unused-vars
  const defaultExport = undefined;
  // run in this scope
  // deno-lint-ignore no-eval
  eval(wrapped);
  return (globalThis as any)[exportName] as Function;
}

async function processOnce() {
  const partnerName = "partnerx";
  const { fn, config } = await loadPartnerArtifacts(partnerName);
  const dedupe = compileFunction(fn.dedupe_js, "__dedupe");
  const handler = compileFunction(fn.handler_js, "__handler");
  const maxRetries = Number(fn.retry_max ?? CONFIG.PARTNERX_MAX_RETRIES);

  const batch = await dequeueBatch<PartnerMessage>("route_partnerx_queue");
  const supabase = getServiceClient();
  for (const item of batch) {
    const dedupeKey = String(dedupe(item.message));
    // check duplicate
    const { data: dup } = await supabase
      .from("leads")
      .select("id, status")
      .eq("partner_name", partnerName)
      .eq("dedupe_key", dedupeKey)
      .in("status", ["pending", "ok"]).limit(1);
    if (dup && dup.length) {
      // duplicate: log and drop
      await deleteMessage("route_partnerx_queue", item.msg_id);
      continue;
    }

    // persist as pending
    const { data: leadRow, error: leadErr } = await supabase
      .from("leads")
      .insert({
        person_id: item.message.person_id,
        alias_id: item.message.alias_id ?? null,
        partner_name: partnerName,
        dedupe_key: dedupeKey,
        status: "pending",
      })
      .select("id")
      .single();
    if (leadErr) throw leadErr;

    let success = false;
    let attempts = 0;
    while (!success && attempts < maxRetries) {
      attempts++;
      try {
        const res = await (handler as any)(item.message, config);
        await supabase
          .from("leads")
          .update({ status: "ok", response: res, attempts })
          .eq("id", leadRow!.id);
        await deleteMessage("route_partnerx_queue", item.msg_id);
        success = true;
      } catch (e) {
        if (attempts >= maxRetries) {
          await supabase
            .from("leads")
            .update({ status: "failed", error: { message: String((e as Error).message) }, attempts })
            .eq("id", leadRow!.id);
          await enqueue("route_partnerx_dlq", { message: item.message, error: String((e as Error).message) });
          await deleteMessage("route_partnerx_queue", item.msg_id);
        }
      }
    }
  }
}

await processOnce();

