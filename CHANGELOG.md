# Changelog

## Unreleased

- Forked the upstream Maccabi Health project as `meuhedet-health`, preserving its MIT license and upstream copyright attribution.
- Replaced provider-specific implementations with a limited Meuhedet client, CLI, and local stdio MCP surface.
- Documented that the current Meuhedet API paths are derived from public first-party frontend assets and have not been validated against a live member account.

- Added date-filtered lab lists and individual lab-result details, traced to dedicated first-party bundles, with CLI and MCP commands.
- Added conservative parsing for split OTP forms with a named hidden code field; actual CLI login remains unverified.
- Added the medication page’s separate active, purchased, approval, and prescription-history readers from its first-party bundle.
