# Security policy

This project handles highly sensitive health data and authentication cookies. Do not include real IDs, phone numbers, SMS codes, session files, cookies, or clinical records in bug reports, commits, tests, or logs.

No private vulnerability-reporting endpoint is configured in this checkout. If you have a security report, contact the project maintainer through a private channel they have explicitly provided. Do not post exploit details or sensitive data publicly. Ordinary bugs should also omit credentials and patient information.

The project is an unofficial client. Report vulnerabilities in Meuhedet's own systems directly to Meuhedet through its security contact. This client currently documents frontend-derived endpoint paths, not a supported or stable public API. The authenticated flow has not been validated with a live account.

Local sessions are credentials. `logout` removes the local file only; it does not revoke a session at Meuhedet.
