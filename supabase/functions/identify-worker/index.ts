import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SubmissionMessage } from "../_types/SubmissionMessage.ts";
import { deleteMessage, dequeueBatch, enqueue } from "../_shared/queue.ts";
import { getServiceClient } from "../_shared/db.ts";
import { retry } from "jsr:@std/async/retry";

EdgeRuntime.waitUntil(process());
Deno.serve(() => {
  return new Response(JSON.stringify({ message: "ok" }));
});
addEventListener("beforeunload", (ev) => {
  console.log("Function will be shutdown due to", ev.detail);
});

async function process() {
  const batch = await dequeueBatch<SubmissionMessage>("submission_queue");
  for (const item of batch) {
    try {
      const { personId, aliasId } = await retry(
        () => identifyLead(item.message),
        {
          maxAttempts: 3,
          minTimeout: 10,
          multiplier: 2,
          jitter: 0,
        },
      );
      await enqueue("routing_queue", {
        ...item.message,
        person_id: personId,
        alias_id: aliasId,
      });
      await deleteMessage("submission_queue", item.msg_id);
    } catch (e) {
      await enqueue("submission_dlq", {
        error: (e as Error).message,
        message: item.message,
      }).catch((e) => {
        // todo: send to sentry
        console.error(e);
      });
      await deleteMessage("submission_queue", item.msg_id).catch((e) => {
        // todo: send to sentry
        console.error(e);
      });
    }
  }
}

async function identifyLead(msg: SubmissionMessage) {
  const supabase = getServiceClient();
  const email = (msg.email ?? undefined)?.toLowerCase();
  const phone = msg.phone ?? undefined;
  const fullName = (msg.full_name ?? undefined)?.toLowerCase();

  if (!email && !phone && !fullName) {
    throw new Error("No identifiers provided");
  }

  const orFilters = [
    email ? `email.eq.${email}` : "",
    phone ? `phone.eq.${phone}` : "",
    name ? `name.eq.${name}` : "",
  ].filter(Boolean).join(",");

  const { data, error } = await supabase
    .from("lead_identities")
    .select("id")
    .or(orFilters)
    .limit(10);

  if (error) throw error;

  const candidates = (data ?? []).map((r) => r.id);

  let personId: string | null = null;
  let aliasId: string | null = null;

  // Try to find a record with two-of-three match by querying combinations
  if (
    [email ?? null, phone ?? null, fullName ?? null].filter((v) =>
      !!(v && String(v).trim())
    ).length >= 2
  ) {
    const { data } = await supabase.rpc("find_two_of_three_match", {
      p_email: email ?? null,
      p_phone: phone ?? null,
      p_full_name: fullName ?? null,
    });
    if (data && data.id) {
      personId = data.id as string;
    }
  }

  if (!personId) {
    // Create a base record
    const { data, error } = await supabase
      .from("lead_identities")
      .insert({ email, phone, full_name: fullName })
      .select("id")
      .single();
    if (error) throw error;
    personId = data!.id as string;
  } else {
    // If third prop differs, create alias and link to main via alias_of
    const { data: existing } = await supabase
      .from("lead_identities")
      .select("email, phone, full_name")
      .eq("id", personId)
      .single();
    const differs = (
      prop: string | undefined | null,
      got: string | undefined,
    ) => !!(got && prop && got !== prop);
    if (
      differs(existing?.email, email) || differs(existing?.phone, phone) ||
      differs(existing?.full_name, fullName)
    ) {
      const { data, error } = await supabase
        .from("lead_identities")
        .insert({ email, phone, full_name: fullName, alias_of: personId })
        .select("id")
        .single();
      if (error) throw error;
      aliasId = data!.id as string;
    }
  }

  return { personId: personId!, aliasId };
}
