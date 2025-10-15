import { getServiceClient } from "./db.ts";

export function wrapWorker(
    workerName: string,
    handler: (body: Record<string, unknown> | undefined) => Promise<void>,
    heartbeatMs = 10_000,
) {
    Deno.serve(async (req) => {
        const body = await req.json();
        const dealer_name = body?.dealer_name as string;
        // for dealer-worker, the worker name is the dealer name
        if (workerName === "dealer-worker" && dealer_name) {
            workerName = `${dealer_name}-worker`;
        }
        EdgeRuntime.waitUntil(run(workerName, handler, heartbeatMs, body));
        return new Response(JSON.stringify({ ok: true }));
    });
}

async function run(
    workerName: string,
    handler: (body: Record<string, unknown> | undefined) => Promise<void>,
    heartbeatMs: number,
    body: Record<string, unknown>,
) {
    const supabase = getServiceClient();
    const upsertState = async (fields: Record<string, unknown>) =>
        await supabase.from("worker_states").upsert({
            name: workerName,
            ...fields,
            last_seen: new Date().toISOString(),
        });
    const getStatus = async () => {
        const { data } = await supabase
            .from("worker_states")
            .select("status")
            .eq("name", workerName)
            .single();
        return data?.status ?? "starting";
    };
    const status = await getStatus();
    if (status === "disabled") {
        console.log(`[${workerName}] Worker disabled. Exiting.`);
        await upsertState({
            status: "disabled",
            stopped_at: new Date().toISOString(),
        });
        return;
    }
    await upsertState({ status: "starting", stopped_at: null });
    const heartbeat = setInterval(() => {
        upsertState({ status: "busy" }).catch(console.error);
    }, heartbeatMs);
    addEventListener("beforeunload", () => {
        clearInterval(heartbeat);
        upsertState({ status: "dead", stopped_at: new Date().toISOString() })
            .catch(console.error);
    });
    try {
        await handler(body);
        await upsertState({ status: "idle" });
    } catch (err) {
        console.error(`Worker ${workerName} crashed:`, err);
        await upsertState({
            status: "dead",
            stopped_at: new Date().toISOString(),
        });
    } finally {
        clearInterval(heartbeat);
    }
}
