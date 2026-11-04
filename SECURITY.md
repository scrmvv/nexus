# Security policy

NEXUS is a private, self-hosted dashboard. Its HTTP API **does not have built-in authentication**; always place it behind an authenticated TLS reverse proxy and keep the Node.js listener bound to loopback.

Please do not post real access logs, credentials, API tokens, hostnames, or full client IPs in public issues. Report vulnerabilities privately to the repository maintainers using GitHub's private vulnerability reporting feature when enabled.

Scan-path classifications are heuristics and must not be interpreted as proof of an intrusion. NEXUS does not block malicious traffic or replace a WAF, firewall, or forensic audit.
