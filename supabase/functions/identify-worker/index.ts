import { dequeueBatch, deleteMessage, enqueue } from "../_shared/queue.ts";
import { getServiceClient } from "../_shared/db.ts";
import { CONFIG } from "../_shared/env.ts";

type SubmissionMessage = {
  email?: string | null;
  full_name?: string | null;
  phone?: string | null;
  payload?: Record<string, unknown>;
};

function atLeastTwoTruthy(values: (string | null | undefined)[]): boolean {
  return values.filter((v) => !!(v && String(v).trim())).length >= 2;
}

async function identifyLead(msg: SubmissionMessage) {
  const supabase = getServiceClient();
  const email = (msg.email ?? undefined)?.toLowerCase();
  const phone = msg.phone ?? undefined;
  const fullName = msg.full_name ?? undefined;

  if (!email && !phone && !fullName) {
    throw new Error("No identifiers provided");
  }

  // Find main record by at least two matching properties
  const candidates: string[] = [];
  if (email) {
    const { data } = await supabase
      .from("lead_identities")
      .select("id")
      .ilike("email", email)
      .limit(10);
    (data ?? []).forEach((r: any) => candidates.push(r.id));
  }
  if (phone) {
    const { data } = await supabase
      .from("lead_identities")
      .select("id")
      .eq("phone", phone)
      .limit(10);
    (data ?? []).forEach((r: any) => candidates.push(r.id));
  }
  if (fullName) {
    const { data } = await supabase
      .from("lead_identities")
      .select("id")
      .eq("full_name", fullName)
      .limit(10);
    (data ?? []).forEach((r: any) => candidates.push(r.id));
  }

  let personId: string | null = null;
  let aliasId: string | null = null;

  // Try to find a record with two-of-three match by querying combinations
  if (atLeastTwoTruthy([email ?? null, phone ?? null, fullName ?? null])) {
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
    const differs = (prop: string | undefined | null, got: string | undefined) => !!(got && prop && got !== prop);
    if (differs(existing?.email, email) || differs(existing?.phone, phone) || differs(existing?.full_name, fullName)) {
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

async function processOnce() {
  const batch = await dequeueBatch<SubmissionMessage>("submission_queue");
  for (const item of batch) {
    let success = false;
    let attempts = 0;
    while (!success && attempts < CONFIG.IDENTIFY_MAX_RETRIES) {
      attempts++;
      try {
        const { personId, aliasId } = await identifyLead(item.message);
        await enqueue("routing_queue", {
          person_id: personId,
          alias_id: aliasId,
          payload: item.message.payload ?? {},
        });
        await deleteMessage("submission_queue", item.msg_id);
        success = true;
      } catch (e) {
        if (attempts >= CONFIG.IDENTIFY_MAX_RETRIES) {
          await enqueue("submission_dlq", { error: (e as Error).message, message: item.message });
          await deleteMessage("submission_queue", item.msg_id);
        }
      }
    }
  }
}

// one-shot execution for cron/queue triggers
await processOnce();

