# Authentication and sessions

## Agent-managed sign-in

A connected MCP Apps host can show `meuhedet_sign_in` directly inside the chat. Credentials go through an app-only tool using a widget-only flow capability; they are never included in model-facing tool results. See [native sign-in setup](MCP.md). The local browser form is the fallback when native components are unavailable.

The agent runs `node dist/cli.js login --browser` and opens the returned local URL for the user. No user-run scripts, terminal input, credential arguments, or chat messages are required. The user enters their ID and mobile number in the local form, then the SMS code. The agent waits for `sessionSaved: true` before attempting reads. The process exits with a safe error on failure, cancellation, or expiry.

This is an unofficial local form, not Meuhedet's website. It uses the same experimental `MeuhedetAuth` flow as terminal sign-in; live OTP/OIDC compatibility remains unverified. It does not extract a browser's cookies or bypass browser security policies. A successful offline test does not establish live account access.

The listener binds only to `127.0.0.1` on a random port and expires after ten minutes. The URL fragment contains a random capability for this one flow; treat the complete sign-in link as private and open it directly, without forwarding it to another service. The page removes the fragment from its current URL and keeps the capability in memory. Requests require the capability, an exact Host, and a same-origin Origin for submissions. No external scripts, fonts, analytics, or assets are loaded. Credential fields are cleared after submission, and the listener closes when sign-in ends. Only the authenticated session is persisted; ID, phone, and OTP are not saved.

The agent should check `status` first and reuse an existing session. If a read reports expiry, initiate a new local sign-in. Users may still choose terminal `login`, but agents must not ask users to run it.

## Terminal sign-in and session storage

The CLI `login` command prompts interactively for an ID number, mobile number, and SMS code. It parses the known first-step login form and dynamically looks for OTP controls rather than assuming a fixed OTP endpoint or field name. OTP form parsing and success/failure handling have only been tested with synthetic fixtures. The implementation then completes the OIDC callback and checks that the lab-sticker endpoint returns JSON with the expected `Stickers` collection before saving a session. No live account run of this CLI has been performed; portal changes or an unfamiliar form may cause login to fail closed.

The public first-step form fields have been observed in Meuhedet's public page source. The CLI OTP exchange, callback, and authenticated read remain unverified. The OTP parser supports six unnamed digit inputs; a hidden combined code field is accepted by the parser only when the returned form supplies it unambiguously alongside those controls. Its actual field name was not captured. See [API source notes](API-SOURCES.md).

The session file contains cookies and is a credential. It is stored under `~/.config/meuhedet-health/session.json` by default (or the platform config directory). Set `MEUHEDET_CONFIG_DIR` or `XDG_CONFIG_HOME` to select another location. Files are created with owner-only permissions where supported. `status` reports whether a local session file exists; it does not verify that Meuhedet still accepts it. A 401 response clears the saved session.

`session-import` accepts serialized session JSON from a private file or stdin. Use only a session for your own account. Keep it outside shell history and never paste it into a chat, issue, or commit. Do not share raw HAR files: they can contain cookies, identifiers, and health data. `logout` deletes the local session; it does not revoke the portal session.
