import type { PartnerMessage } from "../_types/PartnerMessage.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { deleteMessage, dequeueBatch, enqueue } from "../_shared/queue.ts";
import { getServiceClient } from "../_shared/db.ts";
import { RoutingMessage } from "../_types/RoutingMessage.ts";
import { retry } from "jsr:@std/async/retry";
import { wrapWorker } from "../_shared/worker.ts";
import { captureException, captureMessage } from "../_shared/sentry.ts";

wrapWorker("dealer-worker", process);

async function process(options: Record<string, unknown> | undefined) {
  const dealer_name = options?.dealer_name as string;
  if (!dealer_name) {
    throw new Error("dealer_name is required");
  }
  const queueName = `${dealer_name}_queue`;
  const dlqName = `${dealer_name}_dlq`;
  const { dedupe, handler } = await loadPartnerArtifacts(dealer_name);
  const batch = await dequeueBatch<PartnerMessage>(queueName);
  const supabase = getServiceClient();
  for (const item of batch) {
    const dedupeKey = String(dedupe(item.message));
    let { data: record, error: recordErr } = await supabase
      .from("leads")
      .select("id, status, updated_at, attempts")
      .eq("dedupe_key", dedupeKey)
      .maybeSingle();
    if (recordErr) throw recordErr;
    if (
      record && (
        record.status === "completed" ||
        (record.status === "pending" &&
          (new Date(record.updated_at).getTime() + 1000 * 60 <
            new Date().getTime()))
      )
    ) {
      await deleteMessage(queueName, item.msg_id);
      captureMessage("duplicate lead skipped", "info", {
        dealer_name,
        dedupe_key: dedupeKey,
      });
      continue;
    }
    if (record) {
      const { error: updateErr } = await supabase
        .from("leads")
        .update({ status: "pending", updated_at: new Date().toISOString() })
        .eq("id", record.id);
      record.status = "pending";
      if (updateErr) throw updateErr;
    } else {
      const { data: leadRow, error: leadErr } = await supabase
        .from("leads")
        .insert({
          person_id: item.message.person_id,
          alias_id: item.message.alias_id ?? null,
          dealer_name,
          dedupe_key: dedupeKey,
          status: "pending",
          attempts: 0,
          form_data: item.message.payload,
        })
        .select("id, status, updated_at, attempts")
        .single();
      if (leadErr) throw leadErr;
      record = leadRow;
    }
    try {
      const res = await retry(() => handler(item.message, supabase), {
        maxAttempts: 3,
        minTimeout: 10,
        multiplier: 2,
        jitter: 0,
      });
      if (!res) {
        throw new Error("No response from handler");
      }
      if (res.error) {
        throw new Error(res.error as string);
      }
      captureMessage("lead delivered", "info", { dealer_name, dedupe_key: dedupeKey });
      await supabase
        .from("leads")
        .update({ status: "completed", updated_at: new Date().toISOString() })
        .eq("id", record.id);
      await deleteMessage(queueName, item.msg_id);
    } catch (e) {
      console.error(e);
      captureException(e, { stage: "dealer-worker", dealer_name, dedupe_key: dedupeKey });
      (await supabase
        .from("leads")
        .update({
          status: "failed",
          attempts: (record?.attempts ?? 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", record!.id)
        .then((res) => {
          if (res.error) throw res.error;
        }) as Promise<{ error?: unknown }>).catch((e) => {
          captureException(e, { stage: "dealer-worker", op: "update-lead" });
          console.error(e);
        });
      await enqueue(dlqName, {
        message: item.message,
        error: String((e as Error).message),
      }).catch((e) => {
        captureException(e, { stage: "dealer-worker", op: "enqueue-dlq" });
        console.error(e);
      });
      await deleteMessage(queueName, item.msg_id).catch((e) => {
        captureException(e, { stage: "dealer-worker", op: "delete-msg" });
        console.error(e);
      });
    }
  }
}

async function loadPartnerArtifacts(partnerName: string) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("dynamic_functions")
    .select("name, code")
    .or(`name.eq.${partnerName}_dedupe,name.eq.${partnerName}_handler`);
  if (error || !data?.length || data.length !== 2) {
    throw new Error("Missing partner artifacts");
  }
  let dedupe: Function | undefined = undefined;
  let handler: Function | undefined = undefined;
  for (const item of data) {
    if (item.name.endsWith("_dedupe")) {
      dedupe = new Function("msg", item.code as string) as (
        msg: RoutingMessage,
      ) => { route: string };
    } else {
      handler = new Function("msg", item.code as string) as (
        msg: RoutingMessage,
      ) => { route: string };
    }
  }
  return { dedupe, handler } as {
    dedupe: (msg: PartnerMessage) => string;
    handler: (msg: PartnerMessage, supabase: SupabaseClient) => Promise<{
      status: string;
      error?: unknown;
    }>;
  };
}
