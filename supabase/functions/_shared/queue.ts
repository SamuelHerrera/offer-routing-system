import { getServiceClient } from "../_shared/db.ts";
import { CONFIG } from "../_shared/env.ts";

export type QueueMessage<T = unknown> = {
  msg_id: number;
  vt: string;
  read_ct: number;
  enqueued_at: string;
  message: T;
};

export async function enqueue(queue: string, body: unknown): Promise<number> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .rpc("enqueue_message", { queue_name: queue, body });
  if (error) throw error;
  return data as number;
}

export async function dequeueBatch<T = unknown>(queue: string): Promise<QueueMessage<T>[]> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .rpc("dequeue_batch", {
      queue_name: queue,
      vt_seconds: CONFIG.WORKER_VT_SECONDS,
      batch_size: CONFIG.WORKER_BATCH_SIZE,
    });
  if (error) throw error;
  return (data ?? []) as QueueMessage<T>[];
}

export async function deleteMessage(queue: string, msgId: number): Promise<void> {
  const supabase = getServiceClient();
  const { error } = await supabase
    .rpc("delete_message", { queue_name: queue, msg_id: msgId });
  if (error) throw error;
}

