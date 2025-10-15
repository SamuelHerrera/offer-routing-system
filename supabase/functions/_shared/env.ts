export function getEnv(name: string, fallback?: string): string {
  const v = Deno.env.get(name);
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

export const CONFIG = {
  IDENTIFY_MAX_RETRIES: parseInt(Deno.env.get("IDENTIFY_MAX_RETRIES") ?? "3", 10),
  ROUTING_MAX_RETRIES: parseInt(Deno.env.get("ROUTING_MAX_RETRIES") ?? "3", 10),
  PARTNERX_MAX_RETRIES: parseInt(Deno.env.get("PARTNERX_MAX_RETRIES") ?? "3", 10),
  WORKER_BATCH_SIZE: parseInt(Deno.env.get("WORKER_BATCH_SIZE") ?? "25", 10),
  WORKER_VT_SECONDS: parseInt(Deno.env.get("WORKER_VT_SECONDS") ?? "30", 10),
};

