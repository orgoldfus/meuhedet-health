---
name: meuhedet-health
description: Use the local meuhedet-health checkout or an already configured Meuhedet MCP server to read the user's own dashboard lab stickers, current prescription summary, future appointments, visit approvals, or visit referrals. The project is unofficial and experimental; it does not provide numeric lab results or full lab history.
license: MIT
metadata:
  version: "0.1.0"
---

# Meuhedet Health

Use only the local `meuhedet-health` implementation or a Meuhedet MCP server already configured by the user. This project has no verified npm registry installation path. Do not install or invoke the upstream Maccabi Health package as a substitute.

Before reading records, explain that the implementation is experimental and that its authenticated reads have not been live-validated. The lab command returns dashboard stickers only, not individual numeric results or complete lab history. Other record retention and completeness are unknown. An empty response does not establish that no record exists.

Use an existing local session when available. If sign-in is needed, have the user run `node dist/cli.js login` in their own private terminal so they enter their ID, phone number, and SMS code directly. Do not ask them to put these values in chat or pass them as command arguments. The flow parses the known first-step login form and looks for OTP controls dynamically, but the OTP form and OIDC exchange have only been tested with synthetic fixtures; a changed portal form may cause it to fail closed. Do not retry codes or guess portal fields.

Read only the record category the user requests, using the CLI command or already configured MCP tool matching that category. Keep results private and return a concise, faithful summary. Do not expose raw session data, cookies, identifiers, HAR files, or unnecessary clinical details. Never save health data to files or send it to another service unless the user explicitly asks.

Available CLI reads are `lab-stickers`, `prescriptions`, `future-appointments`, `visit-approvals`, and `visit-referrals`. `status` reports local session-file presence only; it does not verify the session with Meuhedet. See the repository's [capabilities](../../docs/CAPABILITIES.md), [authentication notes](../../docs/AUTH.md), and [CLI reference](../../docs/CLI.md) for current limits and behavior.
