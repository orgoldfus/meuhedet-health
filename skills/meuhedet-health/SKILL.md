---
name: meuhedet-health
description: Use the local Meuhedet client or configured MCP server to retrieve the user's own lab lists, individual lab results, prescriptions, appointments, approvals, or referrals. Initiate local browser sign-in when no valid session exists; never require user-run scripts.
license: MIT
metadata:
  version: "0.1.0"
---

# Meuhedet Health

Use the local checkout or an already configured Meuhedet MCP server. The implementation is unofficial and experimental; authenticated OTP/OIDC and API responses have not been live-validated. Never substitute the upstream Maccabi package or assume a verified npm installation exists.

The agent handles dependency installation, building, sign-in initiation, and data retrieval. Check `node dist/cli.js status` first. With no usable session and a connected MCP Apps host, call `meuhedet_sign_in` and let the user enter credentials in its inline component. Never call the app-only `meuhedet_sign_in_action` from the model. Without a native component, start `node dist/cli.js login --browser` as a running process. Open the returned private local `url` directly for the user. Ask them only to enter their ID, phone number, and SMS code in that form. Never ask them to run a script or place credentials in chat, command arguments, or MCP inputs. Treat the complete sign-in link as private; never forward it to another service. Wait for `sessionSaved: true` and exit code 0 before reads. On failure, cancellation, or expiry, report the safe error; do not retry OTPs, guess portal fields, claim success, or bypass browser security controls.

Use a saved session for subsequent reads. `status` reports local file presence only, not upstream validity. If a read reports expiry, initiate a fresh sign-in. `logout` removes the local session but does not revoke Meuhedet's portal session.

Read only the category requested. Lab commands include `lab-stickers` (dashboard summary), `lab-results --from YYYY-MM-DD --to YYYY-MM-DD` (date-filtered list), and `lab-result --lab-code CODE --sticker-id ID --date YYYYMMDD` (individual details). Choose detail references from the returned list, never guessed identifiers. Check the result's date, units, reference ranges, and completeness before analysis. Other commands and MCP tools are listed in [capabilities](../../docs/CAPABILITIES.md).

Keep results private. Do not expose session data, cookies, identifiers, HAR files, or unnecessary clinical details. Never save medical results to files or send them to another service unless the user explicitly requests it. Public medical research must not include patient identifiers or raw patient results in search queries. Empty or missing records do not establish complete history or absence of care.

See [authentication](../../docs/AUTH.md) and [CLI reference](../../docs/CLI.md) for lifecycle and limitations.
