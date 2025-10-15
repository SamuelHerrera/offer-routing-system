import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SubmissionMessage } from "../_types/SubmissionMessage.ts";
import { deleteMessage, dequeueBatch, enqueue } from "../_shared/queue.ts";
import { getServiceClient } from "../_shared/db.ts";
import { retry } from "jsr:@std/async/retry";
import { wrapWorker } from "../_shared/worker.ts";
import { captureException } from "../_shared/sentry.ts";

wrapWorker("identify-worker", process);

async function process() {
  const batch = await dequeueBatch<SubmissionMessage>("submission_queue");
  for (const item of batch) {
    try {
      const { person_id, alias_id } = await retry(
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
        person_id,
        alias_id,
      });
      await deleteMessage("submission_queue", item.msg_id);
    } catch (e) {
      captureException(e, { stage: "identify-worker", queue: "submission_queue" });
      await enqueue("submission_dlq", {
        ...item.message,
        error: (e as Error).message,
      }).catch((e) => {
        captureException(e, { stage: "identify-worker", op: "enqueue-dlq" });
        console.error(e);
      });
      await deleteMessage("submission_queue", item.msg_id).catch((e) => {
        captureException(e, { stage: "identify-worker", op: "delete-msg" });
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
  const { data: candidates, error } = await supabase
    .from("lead_identities")
    .select("id, alias_of, email, phone, full_name")
    .or(
      [
        email ? `email.eq.${email}` : "",
        phone ? `phone.eq.${phone}` : "",
      ].filter(Boolean).join(","),
    );
  if (error) throw error;
  const candidate = candidates?.[0] ?? null;
  let person_id: string | null = candidate?.alias_of ?? candidate?.id;
  let alias_id: string | null = candidate?.alias_of ?? null;
  if (person_id) {
    let needsAlias = false;
    const entries = [
      ["email", differs(candidate.email, email)],
      ["phone", differs(candidate.phone, phone)],
      ["full_name", differs(candidate.full_name, fullName)],
    ] as [string, boolean][];
    const aliasEntry = entries.reduce((acc, [key, value]) => {
      if (value) {
        needsAlias = true;
        acc[key] = msg[key as keyof SubmissionMessage];
      }
      return acc;
    }, {} as Record<string, unknown>);
    if (needsAlias) {
      aliasEntry.alias_of = person_id;
      const { data, error } = await supabase
        .from("lead_identities")
        .insert(aliasEntry)
        .select("id")
        .single();
      if (error) throw error;
      alias_id = data!.id as string;
    }
  } else {
    const { data, error } = await supabase
      .from("lead_identities")
      .insert({ email, phone, full_name: fullName })
      .select("id")
      .single();
    if (error) throw error;
    person_id = data!.id as string;
  }
  return { person_id, alias_id } as {
    person_id: string;
    alias_id?: string | null;
  };
}

const differs = (
  prop: string | undefined | null,
  got: string | undefined,
) => !!(got && prop && got !== prop);
