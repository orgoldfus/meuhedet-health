# Authentication and sessions

## Agent-managed sign-in

A connected MCP Apps host can show `meuhedet_sign_in` directly inside the chat. Credentials go through an app-only tool using a widget-only flow capability; they are never included in model-facing tool results. See [native sign-in setup](MCP.md). The local browser form is the fallback when native components are unavailable.

The agent runs `node dist/cli.js login --browser` and opens the returned local URL for the user. No user-run scripts, terminal input, credential arguments, or chat messages are required. The user enters their ID and mobile number in the local form, then the SMS code. The agent waits for `sessionSaved: true` before attempting reads. The process exits with a safe error on failure, cancellation, or expiry.

This is an unofficial local form, not Meuhedet's website. It uses the same experimental `MeuhedetAuth` flow as terminal sign-in; OTP/OIDC and appointment-focused validation completed a private live run on 2026-10-14. It does not extract a browser's cookies or bypass browser security policies. A successful offline test alone does not establish live account access.

The listener binds only to `127.0.0.1` on a random port and expires after ten minutes. The URL fragment contains a random capability for this one flow; treat the complete sign-in link as private and open it directly, without forwarding it to another service. The page removes the fragment from its current URL and keeps the capability in memory. Requests require the capability, an exact Host, and a same-origin Origin for submissions. No external scripts, fonts, analytics, or assets are loaded. Credential fields are cleared after submission, and the listener closes when sign-in ends. Only the authenticated session is persisted; ID, phone, and OTP are not saved.

The agent should check `status` first and reuse an existing session. If a read reports expiry, initiate a new local sign-in. Users may still choose terminal `login`, but agents must not ask users to run it.

## Terminal sign-in and session storage

The CLI `login` command prompts interactively for an ID number, mobile number, and SMS code. It parses the known first-step login form and dynamically looks for OTP controls rather than assuming a fixed OTP endpoint or field name. The implementation completes the OIDC callback and checks that `POST AppointmentApi/FutureAppointmentsOnly` returns authenticated JSON before saving a session. Private browser sign-in completed this appointment-focused flow on 2026-10-14 after the singleton-control correction, without opening laboratory data. Portal changes or an unfamiliar form may still cause login to fail closed.

Login starts at the portal root and verifies via future appointments, without reading laboratory data. The public first-step form fields have been observed in Meuhedet's public page source. The OTP parser supports six distinct labeled unnamed digit inputs or one explicitly labeled OTP digit input in the raw response. In either shape, a hidden combined code field must be supplied unambiguously by that exact response; the client never invents its name or action. A subsequent private live sign-in succeeded after correcting singleton support. Neither the actual hidden field name, user credentials/code nor full challenge HTML is stored in research notes or fixtures. See [API source notes](API-SOURCES.md).

The session file contains cookies and is a credential. It is stored under `~/.config/meuhedet-health/session.json` by default (or the platform config directory). Set `MEUHEDET_CONFIG_DIR` or `XDG_CONFIG_HOME` to select another location. Files are created with owner-only permissions where supported. `status` reports whether a local session file exists; it does not verify that Meuhedet still accepts it. A 401 response clears the saved session.

`session-import` accepts serialized session JSON from a private file or stdin. Use only a session for your own account. Keep it outside shell history and never paste it into a chat, issue, or commit. Do not share raw HAR files: they can contain cookies, identifiers, and health data. `logout` deletes the local session; it does not revoke the portal session.

## Session updates and reauthentication

The transport imports the saved cookie jar and applies every response `Set-Cookie` to that in-memory jar. CLI readers and MCP appointment readers save `exportSession()` after successful reads. A direct library integration must also persist the updated session privately; discarding it can lose cookie rotation or renewal. This is distinct from a refresh-token flow: no refresh token is stored, no token-renewal method is implemented, and the inspected public appointment bundle did not expose a verified refresh-token endpoint. This does not establish that the server has no other renewal mechanism.

A later saved-session read returned 401 on 2026-10-14 after successful sign-in and appointment reads. Filtered cookie metadata showed session cookies with no explicit expiry timestamp; the lifetime of their opaque server ticket cannot be derived from that metadata. Cookie rotation lost by a direct library caller is possible but was not proven. A 401 is treated as invalid authentication, without retry or bypass, and requires a new private sign-in under the user's authorization.

## Booking state

Appointment proposals are kept in memory for five minutes and are invalid after a fresh login or restart. Owner-only attempt markers contain a provider/date/time hash and outcome state, not account identifiers, contacts or medical responses. See [appointment workflow](APPOINTMENTS.md).

## Safe OTP-form failure diagnostics

`LOGIN_NOT_ADVANCED` means the returned response is still the first-step form with no verified OTP candidate. `OTP_FORM_UNVERIFIED` means a single safe OTP submission could not be established. Diagnostics expose only capped form/field counts and booleans, never HTML, text, field names or values, identifiers, phone numbers, codes, cookies or URLs. `hiddenCodeFieldCount` counts empty named hidden code candidates before the labeled-control check, making a missing field distinguishable from an unsupported control shape without exposing its name. An anti-forgery field is never an OTP field even if its input type is omitted. The browser CLI emits these structural diagnostics after failure; no response capture is saved. Failure closes the flow, and no SMS retry is automatic.
