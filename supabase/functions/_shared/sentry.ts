// Sentry initialization for Deno / Supabase Edge Functions
import * as Sentry from "npm:@sentry/deno";

export function initSentry(context: {
  name: string; // service/function name
  environment?: string;
  release?: string;
}): void {
  const dsn = Deno.env.get("SENTRY_DSN") ?? "";
  if (!dsn) return; // no-op if DSN is not provided
  const environment = context.environment ?? Deno.env.get("SENTRY_ENV") ?? Deno.env.get("ENV") ?? "development";
  const release = context.release ?? Deno.env.get("SENTRY_RELEASE") ?? undefined;
  // Safe to call init multiple times; SDK deduplicates
  Sentry.init({
    dsn,
    environment,
    release,
    tracesSampleRate: Number(Deno.env.get("SENTRY_TRACES_SAMPLE_RATE") ?? 0),
  });
  Sentry.setTag("service", context.name);
}

export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!Deno.env.get("SENTRY_DSN")) return;
  if (context) {
    Sentry.captureException(err, { extra: context });
  } else {
    Sentry.captureException(err);
  }
}

export function captureMessage(
  message: string,
  level: "info" | "warning" | "error" = "info",
  extra?: Record<string, unknown>,
): void {
  if (!Deno.env.get("SENTRY_DSN")) return;
  Sentry.captureMessage(message, { level, extra } as unknown as Parameters<typeof Sentry.captureMessage>[1]);
}

export async function flushSentry(timeoutMs = 1000): Promise<void> {
  if (!Deno.env.get("SENTRY_DSN")) return;
  await Sentry.flush(timeoutMs);
}


