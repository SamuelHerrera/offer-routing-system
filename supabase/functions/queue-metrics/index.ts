import { serve } from "std/http/server";
import { getServiceClient } from "../_shared/db.ts";

serve(async (_req: Request) => {
  const supabase = getServiceClient();
  const { data, error } = await supabase.rpc("queue_metrics");
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400 });
  return new Response(JSON.stringify(data));
});

