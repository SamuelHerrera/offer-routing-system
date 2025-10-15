import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SubmissionMessage } from "../_types/SubmissionMessage.ts";
import { enqueue } from "../_shared/queue.ts";
import { captureException, initSentry, flushSentry } from "../_shared/sentry.ts";
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE",
  "Content-Type": "application/json",
};
Deno.serve(async (req) => {
  initSentry({ name: "api-submit" });
  const { method } = req;
  if (method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  let message: SubmissionMessage = {};
  try {
    const body = await req.json();
    if (!validateSubmission(body)) {
      return new Response(
        JSON.stringify({ error: "Invalid body" }),
        { headers, status: 400 },
      );
    }
    message = {
      email: body.email ?? null,
      full_name: body.full_name ?? null,
      phone: body.phone ?? null,
      payload: body.payload ?? {},
    };
    await enqueue("submission_queue", message);
    return new Response(
      JSON.stringify({ status: "queued" }),
      { headers, status: 200 },
    );
  } catch (e) {
    captureException(e, { route: "api-submit" });
    await enqueue("submission_dlq", {
      ...message,
      error: (e as Error).message,
    }).catch((e) => {
      captureException(e, { route: "api-submit", op: "enqueue-dlq" });
      console.error(e);
    });
    return new Response(
      JSON.stringify({ error: message }),
      { headers, status: 400 },
    );
  }
  finally {
    await flushSentry();
  }
});

function validateSubmission(body: unknown): boolean {
  if (!body || typeof body !== "object") {
    return false;
  }
  const b = body as Record<string, unknown>;
  if (!b.email && !b.full_name && !b.phone) {
    return false;
  }
  return true;
}
