import { serve } from "std/http/server";
import { enqueue } from "../_shared/queue.ts";

type Submission = {
  email?: string;
  full_name?: string;
  phone?: string;
  payload?: Record<string, unknown>;
};

function validateSubmission(body: unknown): asserts body is Submission {
  if (!body || typeof body !== "object") throw new Error("Invalid body");
  const b = body as Record<string, unknown>;
  if (!b.email && !b.full_name && !b.phone) {
    throw new Error("At least one identifier required: email, full_name, phone");
  }
}

serve(async (req: Request) => {
  try {
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    const body = await req.json();
    validateSubmission(body);

    const message = {
      email: body.email ?? null,
      full_name: body.full_name ?? null,
      phone: body.phone ?? null,
      payload: body.payload ?? {},
    };
    await enqueue("submission_queue", message);
    return new Response(JSON.stringify({ status: "queued" }), { status: 202 });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 400 });
  }
});

