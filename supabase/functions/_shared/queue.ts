import { retry, type RetryOptions } from "jsr:@std/async";
import { getServiceClient } from "../_shared/db.ts";
import { getEnv } from "./env.ts";

export type QueueMessage<T = unknown> = {
  msg_id: number;
  vt: string;
  read_ct: number;
  enqueued_at: string;
  message: T;
};

const options: RetryOptions = {
  maxAttempts: parseInt(getEnv("QUEUE_MAX_RETRIES") ?? "3", 10),
  minTimeout: parseInt(getEnv("QUEUE_MIN_TIMEOUT") ?? "10", 10),
  multiplier: parseInt(getEnv("QUEUE_MULTIPLIER") ?? "2", 10),
  jitter: parseInt(getEnv("QUEUE_JITTER") ?? "0", 10),
};

export async function enqueue(
  queue: string,
  body: unknown,
  sleepSeconds: number = 0,
  retryOptions: RetryOptions = options,
): Promise<void> {
  await retry(async () => {
    const supabase = getServiceClient();
    const result = await supabase.schema("pgmq_public").rpc("send", {
      queue_name: queue,
      message: body,
      sleep_seconds: sleepSeconds,
    });
    if (result.error) throw result.error;
  }, retryOptions);
}

export async function dequeueBatch<T = unknown>(
  queue: string,
  n: number = 5,
  sleepSeconds: number = 0,
  retryOptions: RetryOptions = options,
): Promise<QueueMessage<T>[]> {
  const supabase = getServiceClient();
  return await retry(async () => {
    const result = await supabase.schema("pgmq_public")
      .rpc("read", {
        queue_name: queue,
        sleep_seconds: sleepSeconds,
        n: n,
      });
    if (result.error) throw result.error;
    return (result.data ?? []) as QueueMessage<T>[];
  }, retryOptions);
}

export async function deleteMessage(
  queue: string,
  msgId: number,
  retryOptions: RetryOptions = options,
): Promise<void> {
  const supabase = getServiceClient();
  await retry(async () => {
    const result = await supabase.schema("pgmq_public").rpc("delete", {
      queue_name: queue,
      msg_id: msgId,
    });
    if (result.error) throw result.error;
  }, retryOptions);
}

export async function metricsAll(): Promise<unknown> {
  const supabase = getServiceClient();
  const result = await supabase.schema("pgmq_public").rpc("metrics_all");
  if (result.error) throw result.error;
  return result.data;
}
