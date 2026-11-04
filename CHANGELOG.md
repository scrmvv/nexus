# Changelog

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
