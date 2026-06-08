# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please open an issue with the label `security` rather than disclosing it publicly. If the issue is sensitive, email the maintainer directly (see commit history for contact).

You can expect:
- Acknowledgment within 48 hours
- An initial assessment within 5 business days
- A fix timeline based on severity

## Scope

- Authentication bypass
- Path traversal / unauthorized file access
- SQL injection
- XSS (cross-site scripting)
- Exposure of sensitive configuration

Out of scope: dependencies with known CVEs (update via `pnpm update`).
