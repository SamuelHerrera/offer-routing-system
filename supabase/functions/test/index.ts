/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/test' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/


// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { Submission } from "../_types/Submission.ts";
import { RetryError } from "jsr:@std/async/retry";
import { enqueue } from "../_shared/queue.ts";

console.log("Hello from Functions!");

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    validateSubmission(body);
    const message = {
      email: body.email ?? null,
      full_name: body.full_name ?? null,
      phone: body.phone ?? null,
      payload: body.payload ?? {},
    };
    await enqueue("submission_queue", message);

    return new Response(
      JSON.stringify({ status: "queued" }),
      { headers: { "Content-Type": "application/json" }, status: 200 },
    );
  } catch (e) {
    const message = (e as Error).message;
    await enqueue("submission_dlq", message).catch((e) => {
      console.error(e);
    });
    return new Response(
      JSON.stringify({ error: message }),
      { headers: { "Content-Type": "application/json" }, status: 400 },
    );
  }
});

function validateSubmission(body: unknown): asserts body is Submission {
  if (!body || typeof body !== "object") throw new Error("Invalid body");
  const b = body as Record<string, unknown>;
  if (!b.email && !b.full_name && !b.phone) {
    throw new Error(
      "At least one identifier required: email, full_name, phone",
    );
  }
}