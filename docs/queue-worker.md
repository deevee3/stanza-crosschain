# Queue worker — live :8003 service

The deposit → watcher → settle loop runs on the queue. Without a worker,
`RequestLicenseQuote` / `WatchSettlement` / `SettleLicense` jobs pile up
in the `jobs` table and no quote ever completes on live.

## The unit

Systemd user unit `stanza-queue-worker.service` on the iMac (homelab),
next to `stanza-crosschain.service`:

```
ExecStart=/home/housedv/.local/bin/php artisan queue:work database --tries=0 --sleep=3 --timeout=600
Restart=always
RestartSec=5
```

Enabled + started. `~/.local/bin/php` is a docker wrapper (same
`thinktank-os-app` image as the web service), so the worker runs the same
environment as the app.

## Standing rules (Nov 9 lessons — do not change casually)

- **`--tries=0` (unlimited) is REQUIRED.** `WatchSettlement` release(5)-polls
  itself until the swap reaches a terminal status. With the default
  `--tries=1`, the second run dies `MaxAttemptsExceeded` and the job lands
  in `failed_jobs`. `RequestLicenseQuote` (`$tries = 3`) and `SettleLicense`
  (`$tries = 5`) bound themselves at the job level, so only the watcher
  rides the unlimited setting.
- **Exactly ONE worker for the live service.** A duplicate worker caused
  confusion on Nov 9. The `:8004` demo worktree runs its own worker inside
  its own container against its own database — leave it alone; it is not
  the live worker.
- **Expiry guard, not infinite polling.** `WatchSettlement` retires a
  quote whose deposit window closed (deadline + 30 min, or 2 h old with
  no deposit) by marking the license `failed`. Abandoned quotes self-clean
  instead of polling forever.

## Safety notes

- The worker runs with live credentials (1Click JWT, NEAR MPC key). It
  only acts on jobs the app queues: quotes (free), status polls (free),
  and — after a real deposit confirms — an MPC `recordLicense` settle.
- A live settle reverts `UnknownWork` until the work is registered
  on-chain (see the Phase 1 gap audit). Registering works is a mainnet
  gas spend and needs D'Vaughn.
- Check health with: `systemctl --user status stanza-queue-worker` and
  `sqlite3 database/database.sqlite "SELECT count(*) FROM jobs;"` from
  the live checkout. An empty `jobs` table with no recent failures is
  the healthy idle state.
