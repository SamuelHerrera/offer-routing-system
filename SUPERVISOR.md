# Worker Supervisor Cron

## Create vault secrets (only once)

```
select vault.create_secret('https://<project_id>-ref.supabase.co', 'project_url');
select vault.create_secret('<anon_key>', 'anon_key');
```

## Start supervisor

```
SELECT cron.schedule(
  'watchdog--all-workers',
  '15 seconds',
  $$
  DO $do$
  DECLARE w RECORD;
  BEGIN
    FOR w IN
      SELECT name FROM public.worker_states
      WHERE status != 'disabled'
        AND (status = 'dead' OR last_seen < NOW() - INTERVAL '30 seconds')
    LOOP
      PERFORM net.http_post(
        url := format((select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/%I', w.name),
        headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key'))
      );
    END LOOP;
  END;
  $do$;
  $$
);
```

## Stop supervisor

```
select cron.unschedule('watchdog--all-workers');
```

## Enable worker by name

```
UPDATE worker_states SET status = 'dead' WHERE name = '<name>-worker';
```

## Disable worker by name

```
UPDATE worker_states SET status = 'disabled' WHERE name = '<name>-worker';
```
