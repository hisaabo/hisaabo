# Fail2ban configuration for Hisaabo

Hisaabo emits a structured **security event log** that fail2ban can parse to
ban IPs that are attempting brute-force logins, hammering rate limits, or
sending requests from disallowed origins.

This directory contains drop-in config files for the **host** running
fail2ban (not the Docker containers). Copy them to the matching paths
under `/etc/fail2ban/` and reload.

## How it fits together

```
        +-----------------------+
        | Docker container(s)   |
        |  hisaabo-api          |  stdout (pino JSON)
        |  hisaabo-postgres     |  ──────────────────┐
        |  hisaabo-backup       |                    │
        +-----------------------+                    │
                                                     ▼
                                       +------------------------------+
                                       | systemd-journald (host)      |
                                       |  CONTAINER_TAG=hisaabo-api   |
                                       |  CONTAINER_TAG=hisaabo-...   |
                                       +--------------+---------------+
                                                      │
                                                      ▼
                                       +------------------------------+
                                       | fail2ban (host)              |
                                       |  backend = systemd           |
                                       |  filter = hisaabo-api        |
                                       |  jail   = hisaabo-api        |
                                       |  → iptables / nftables ban   |
                                       +------------------------------+
```

`docker-compose.prod.yml` is preconfigured to send container logs to
journald with stable `CONTAINER_TAG` labels (`hisaabo-api`,
`hisaabo-postgres`, `hisaabo-backup`). fail2ban's `systemd` backend reads
journald directly — no log files to tail, no logrotate to configure.

## Security events emitted by the API

Every ban-worthy event lands on stdout as a single-line pino JSON record
with this stable shape:

```json
{"level":40,"time":1742900000000,"sec":true,"event":"login_fail","ip":"203.0.113.42","path":"/api/trpc/auth.login","reason":"bad_password","msg":"sec login_fail"}
```

The fields fail2ban relies on:

| Field   | Meaning                                                          |
|---------|------------------------------------------------------------------|
| `sec`   | Always `true` for ban-worthy events. Filter sentinel.            |
| `event` | One of the values listed below — used to scope jails.            |
| `ip`    | Client IP as derived by the API from `TRUST_PROXY_HOPS` / `TRUST_CLOUDFLARE` (see below). |
| `path`  | Request path (helpful for triage; not part of the regex).        |
| `reason`| Free-form sub-reason (`bad_password`, `phone`, etc.).            |

**Event types (these are the contract — renaming them breaks installed jails):**

- `rate_limit` — generic tRPC rate limit tripped (per-IP, per-tier).
- `rate_limit_pdf` — PDF endpoint rate limit tripped.
- `rate_limit_store` — public storefront `GET` rate limit tripped.
- `rate_limit_store_post` — public storefront `POST` rate limit tripped.
- `rate_limit_order` — per-phone order rate limit tripped.
- `csrf_fail` — cookie-authed POST without the `X-Requested-With` header.
- `origin_block` — Origin/Referer not on the allow-list.
- `login_fail` — password login attempt failed.
- `login_lockout` — per-email lockout threshold hit.

If you add new event types in `packages/api/src/lib/logger.ts`, update
the regex in `filter.d/hisaabo-api.conf` to include them.

## Prerequisite: correct client IPs

fail2ban bans exactly the `ip` the API logs, so a wrong client IP means either
no protection (attacker spoofs a fresh IP per request) or banning the wrong
host (every client shows up as your proxy and one bad actor bans everyone).
The API only trusts forwarding headers as configured:

- `TRUST_PROXY_HOPS=N` (default `1`): number of trusted proxies appending to
  `X-Forwarded-For`; the client IP is the Nth entry from the right. Use `1` with
  a single nginx/Caddy/load balancer in front, `0` if the API port is exposed
  directly (forwarding headers are then ignored).
- `TRUST_CLOUDFLARE=true`: also honour `cf-connecting-ip`. Only when the origin
  is reachable exclusively through Cloudflare.

Verify after changing the proxy topology:
`curl -H 'X-Forwarded-For: 1.2.3.4' https://your-api/...` must NOT make `1.2.3.4`
appear as the `ip` in `journalctl CONTAINER_TAG=hisaabo-api`. Also see
`ignoreip` and the firewall-chain choice (INPUT vs DOCKER-USER) in
`jail.d/hisaabo.local`.

## Install (Debian/Ubuntu host)

1. Install fail2ban and (optionally) the systemd backend's helper:
   ```sh
   sudo apt-get install -y fail2ban
   ```

2. Copy filter and jail configs:
   ```sh
   sudo install -m 644 docs/fail2ban/filter.d/hisaabo-api.conf /etc/fail2ban/filter.d/hisaabo-api.conf
   sudo install -m 644 docs/fail2ban/jail.d/hisaabo.local      /etc/fail2ban/jail.d/hisaabo.local
   ```

3. Reload fail2ban and verify the jails are active:
   ```sh
   sudo systemctl reload fail2ban
   sudo fail2ban-client status
   sudo fail2ban-client status hisaabo-api-login
   ```

4. (Optional) Bound journald disk usage on the host. Edit
   `/etc/systemd/journald.conf` and set:
   ```ini
   SystemMaxUse=2G
   SystemMaxFileSize=128M
   MaxRetentionSec=30day
   ```
   Then `sudo systemctl restart systemd-journald`. Logs older than 30 days
   are discarded; the journal never exceeds 2 GB.

## Testing the filter without banning yourself

Dry-run the regex against the live journal:

```sh
sudo fail2ban-regex \
  "journalctl -u docker.service CONTAINER_TAG=hisaabo-api --output cat --since '1 hour ago'" \
  /etc/fail2ban/filter.d/hisaabo-api.conf
```

You should see the number of matches and the IPs that would be banned.

## Cloudflare in front?

If the API is behind Cloudflare, fail2ban's firewall rules see Cloudflare edge
IPs at the TCP layer, so an iptables/nftables ban of the *client* IP does not
stop traffic that arrives via Cloudflare (the packets come from Cloudflare, not
the banned address). With `TRUST_CLOUDFLARE=true` the **application** log line
carries the real client IP from `cf-connecting-ip`; to enforce bans, mirror them
into a Cloudflare WAF/IP-access rule with a custom fail2ban action using the
Cloudflare API (see fail2ban's `cloudflare` action). Without `TRUST_CLOUDFLARE`
the API ignores `cf-connecting-ip` and logs whatever `TRUST_PROXY_HOPS` yields.

## ONCE host (`Dockerfile.once`)

ONCE captures container stdout to its own log store. Two options:

1. **Run fail2ban on the ONCE host** the same way, but point the filter at
   the ONCE log path instead of journald (`backend = polling` +
   `logpath = /home/once/.../logs/app.log`). The regex in
   `filter.d/hisaabo-api.conf` works unchanged — it matches the JSON line,
   not the surrounding journald metadata.

2. **Let the ONCE platform handle it.** ONCE provides its own rate-limit
   and ban hooks; consult ONCE's docs.

Either way, the pino JSON on stdout is the contract — anything that can
grep that stream can ban offenders.
