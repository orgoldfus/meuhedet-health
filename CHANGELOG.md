# Changelog

## Unreleased

- Added public doctor search, modern monthly/daily appointment reads and five-minute appointment proposals.
- Added disabled-by-default, host-confirmed single-attempt booking with signed approval state and persistent duplicate prevention; authenticated contracts remain unverified.
- Changed login validation to future appointments, avoiding laboratory reads.

- Added native MCP Apps sign-in with app-only credential submissions and widget-only flow capabilities.

- Added agent-managed local browser sign-in with a ten-minute lifetime, protected local submissions, private session storage, and safe terminal output.

- Forked the upstream Maccabi Health project as `meuhedet-health`, preserving its MIT license and upstream copyright attribution.
- Replaced provider-specific implementations with a limited Meuhedet client, CLI, and local stdio MCP surface.
- Documented that the current Meuhedet API paths are derived from public first-party frontend assets and have not been validated against a live member account.

- Added date-filtered lab lists and individual lab-result details, traced to dedicated first-party bundles, with CLI and MCP commands.
- Added conservative parsing for split OTP forms with a named hidden code field; actual CLI login remains unverified.
- Added the medication page’s separate active, purchased, approval, and prescription-history readers from its first-party bundle.
