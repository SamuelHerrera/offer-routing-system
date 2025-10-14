import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { RulePayload } from "../_types/RulePayload.ts";
import { getServiceClient } from "../_shared/db.ts";
import { enqueue } from "../_shared/queue.ts";
import { buildDecisionTree } from "../_shared/rules.ts";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE",
  "Content-Type": "application/json",
};

Deno.serve(async (req) => {
  try {
    const { method } = req;
    const body = await req.json();
    if (method === "OPTIONS") {
      return new Response("ok", { headers });
    } else if (method === "POST") {
      return await handleBuildDecisionTree(body);
    } else if (method === "PATCH") {
      return await handleUpsert(body);
    } else if (method === "GET") {
      return await handleGet();
    } else {
      return new Response(JSON.stringify({ error: "Invalid method" }), {
        headers,
        status: 400,
      });
    }
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      {
        headers,
        status: 400,
      },
    );
  }
});

async function handleUpsert(body: Record<string, unknown>) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("rules")
    .insert(body)
    .select("id")
    .single();
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers,
    });
  }
  await enqueue("compile_queue", { created_at: new Date().toISOString() });
  return new Response(
    JSON.stringify({ id: data?.id }),
    {
      headers,
      status: 200,
    },
  );
}

async function handleGet() {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("rules")
    .select("*");
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers,
    });
  }
  return new Response(JSON.stringify({ data }), {
    headers,
    status: 200,
  });
}

async function handleBuildDecisionTree(body: Record<string, unknown>) {
  const rules = (body.rules ?? []) as RulePayload[];
  const tree = await buildDecisionTree(rules);
  return new Response(JSON.stringify({ tree }), {
    headers,
    status: 200,
  });
}
