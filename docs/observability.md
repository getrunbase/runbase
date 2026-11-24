# Observability

## Logs

- Shared logger: `@getrunbase/core/logger` (pino, one JSON line per event on stdout).
  Fields: `time` (ISO), `level`, `service` (`web`, `worker`), `msg`, and the correlation context
  `workspaceId`, `runId`, `requestId` through `withContext({...})`. Secrets are masked (`password`, `token`,
  `secret`, `authorization`, `cookie`). Level: `LOG_LEVEL` (default `info`, `silent` under `NODE_ENV=test`).
- Wired at the entry points: Next request errors (`apps/web/instrumentation.ts`, `onRequestError`),
  worker startup/shutdown, BullMQ job failures (queue, jobId, workspaceId, runId), trash purge.
  Existing `console.*` calls in services remain; they will be migrated over time.
- Rotation: Docker `json-file` driver, `max-size 10m`, `max-file 5` per container (`docker-compose.yml`).
- Persistence across deploys: before replacing the containers, archive
  `docker compose logs web worker` (gzip, retention chosen by the operator).

Reading:

    dc logs -f --since 10m web | jq 'select(.level=="error")'
    zcat logs/*.log.gz | grep '"runId":"<id>"'

## Probes

| Probe | Role | Response |
| --- | --- | --- |
| `GET /api/health` | web liveness (Docker healthcheck) | 200 `{status:"ok"}`, without touching the database or Redis |
| `GET /api/ready` | web readiness (rollout, uptime) | 200 if the database and Redis answer within 2 s, otherwise 503 with `checks` |
| `GET :7101/healthz` (worker) | worker liveness (Docker healthcheck) | 200 if all BullMQ workers are running, 503 on shutdown |

Checking the 503: `dc stop redis && curl -i localhost:7100/api/ready` then `dc start redis`.

## Alert rules

To be created by a human in the uptime tool and the log aggregator (logs are pino JSON lines on stdout):

| Alert | Source | Suggested threshold | Action |
| --- | --- | --- | --- |
| 5xx | web logs, `"msg":"request failed"` lines | any new issue, or > 5 events / 5 min | e-mail + Slack |
| Service down | external uptime check on `https://<domain>/api/ready` | 2 consecutive failures (1 min) | e-mail + Slack |
| Queue depth | Bull Board / `LLEN bull:runs:wait`, `bull:bus:wait` | > 1000 waiting jobs for 10 min | Slack |
| Stuck runs | SQL: runs `running` for > 30 min (`select count(*) from workflow_runs where status='running' and created_at < now() - interval '30 minutes'`) | > 0 | Slack |
| Failed jobs | worker logs, `"msg":"job failed"` lines | > 20 events / 10 min | Slack |
| Backup failure | `BACKUP_HEALTHCHECK_PING_URL` (healthchecks.io) | ping missing > 26 h | e-mail |
| Open errors | Errors page / `select count(*) from errors where status='open'` | > 50 open or +10 / h | Slack |

The queue, stuck run and open error thresholds rely on a scheduled query (server cron or SQL check in
the uptime tool); the app pushes no metric.
