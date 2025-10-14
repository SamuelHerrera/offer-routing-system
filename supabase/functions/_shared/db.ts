import { createClient } from "npm:@supabase/supabase-js@2";
import { getEnv } from "./env.ts";

export function getServiceClient() {
  const supabaseUrl = getEnv("SUPABASE_URL");
  const serviceKey = getEnv("SUPABASE_ANON_KEY");
  return createClient(supabaseUrl, serviceKey);
}