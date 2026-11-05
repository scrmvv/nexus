# Changelog

## [0.2.2] — 2026-11-05

### Fixed

- Make Nginx access-log reading resilient to `rename/create` rotation, temporary missing paths and `copytruncate`.
- Track the file identity from an **opened descriptor** (`device + inode`) to eliminate the stat/open race.
- Drain the old descriptor before switching to a replacement log, preventing loss of final lines written during rotation.
- Preserve recent complete lines following a burst larger than 1 MiB instead of dropping the whole batch.
- Update the sample `logrotate` postrotate hook: validate Nginx configuration, use `systemctl reload nginx`, and **do not suppress failures**.
- Add regression tests for startup behavior, rotation, log replacement gaps, `copytruncate`, and large writes.

### Operations

- Upgrading NEXUS does **not** replace an existing `/etc/logrotate.d/*` file. Review the updated `deploy/nexus-logrotate.conf` and apply its `postrotate` change manually if needed.
- NEXUS cannot force Nginx to stop writing to an old `.1` file. If the active log remains empty while `.1` grows, fix Nginx's postrotate reload; see the README.
- No changes to `.env`, HTTP endpoints, Telegram settings, GeoIP, or analytics storage.


## [0.2.1] — 2026-11-04

### Fixed and improved

- Recognize single-, double- and triple-URL-encoded suspicious paths (`%2eenv`, `%252eenv`).
- Detect distributed scan bursts (15 suspicious HTTP requests from 3+ IPs within 60 seconds).
- Display distributed scan incidents in the dashboard.
- Keep Telegram cooldowns, local-only IP processing and the current environment config.
- Correct the dashboard footer version and add a regression test to keep the UI version synchronized with `package.json`.
- Keep the GeoIP attribution export intact (covered by tests) for deployments using DB-IP Lite.
- Existing historical aggregates are not recalculated.

All notable changes to NEXUS are documented here.

## [0.2.0] — 2026-11-04

### Added
- Persistent HTTP request analytics with 24-hour and 7-day charts (14-day local retention).
- Approximate distinct-source counts, status breakdowns, popular paths, client categories and GeoIP countries.
- Scan-burst detection with incidents and optional Telegram notifications, rate-limited per source.
- Site availability alerts and recovery notices.
- Extended sanitized request details (masked source, referer domain, response size, optional request duration).
- Local City MMDB lookup support, including optional DB-IP Lite attribution.
- Public repository materials: neutral example configuration, deploy templates, CI, documentation and security guidance.

### Security & privacy
- Raw IPs are not exposed to the browser; daily HMAC fingerprints are stored for approximate source counts.
- Query strings and likely secret-bearing path segments are redacted.
- The app listens on `127.0.0.1` and expects an HTTPS reverse proxy with authentication.

### Notes
- Existing installations should keep their `.env`, `data/`, systemd and active Nginx configuration.
- GitHub screenshots use synthetic demo data. No working GeoIP database, access log or secret is bundled.
