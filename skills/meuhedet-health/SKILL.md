---
name: meuhedet-health
description: Use the local Meuhedet client or configured MCP server to search doctors, read appointment availability, prepare an appointment proposal, or retrieve the user's own labs, prescriptions, appointments, approvals, or referrals. Initiate local browser sign-in when no valid session exists; never require user-run scripts.
license: MIT
metadata:
  version: "0.2.0"
---

# Meuhedet Health

Use the local checkout or an already configured Meuhedet MCP server. The implementation is unofficial and experimental; public doctor search, appointment-focused private sign-in and monthly/daily availability were live-validated on 2026-10-14. Preparation was adapted to filtered clinic-metadata observations and tested offline; complete live preparation and booking remain unverified. Never substitute the upstream Maccabi package or assume a verified npm installation exists.

The agent handles dependency installation, building, sign-in initiation, and data retrieval. Check `node dist/cli.js status` first. With no usable session and a connected MCP Apps host, call `meuhedet_sign_in` and let the user enter credentials in its inline component. Never call the app-only `meuhedet_sign_in_action` from the model. Without a native component, start `node dist/cli.js login --browser` as a running process. Open the returned private local `url` directly for the user. Ask them only to enter their ID, phone number, and SMS code in that form. Never ask them to run a script or place credentials in chat, command arguments, or MCP inputs. Treat the complete sign-in link as private; never forward it to another service. Wait for `sessionSaved: true` and exit code 0 before reads. On failure, cancellation, or expiry, report the safe error; do not retry OTPs, guess portal fields, claim success, or bypass browser security controls.

Use a saved session for subsequent reads. `status` reports local file presence only, not upstream validity. If a read reports expiry, initiate a fresh sign-in. `logout` removes the local session but does not revoke Meuhedet's portal session.

## Doctor search and appointments

A request to inspect capabilities, search, or develop code is not permission to book. Start with `meuhedet_search_doctors` using the requested doctor name or specialty and optional exact `city`; public directory search needs no sign-in. Never include patient identifiers, symptoms, clinical records, or account credentials in the public query. Respect `page`, `pages`, and `total`; do not treat one page as the whole directory. Nearby cities require the user's location preference or a clearly stated assumption.

For availability, use a `providerId` returned by search, `date: YYYY-MM-DD`, `scope: month` or `day`, and modern `appointmentType`: 0 clinic, 1 video, 2 phone. Reuse the saved session; a 401 needs private sign-in. Login now starts at the portal root and validates through `FutureAppointmentsOnly`, without opening laboratory data. Availability is not a reservation.

Prepare with `meuhedet_prepare_appointment`, passing the exact `fromTime` and `toTime` from a returned daily slot. The proposal lasts five minutes and does not reserve anything. Present the returned doctor, specialty, location, date, Israel time, visit type and any conditions before asking the user to select the appointment. The ordinary clinic shape uses `details.block`, `datepicker.block`, `summary.block` in that order and explicit null or affirmative, unblocked, message-free prevalidation. Missing/unknown validation, restricted visits, required/unknown billing, nonempty/unknown messages, questionnaires/disclaimers, external providers and nonstandard flows fail closed. Only ordinary in-person Meuhedet doctor visits are eligible for execution. The current payload sends null additional phone/email values; acceptance of this choice needs live validation.

Never call `meuhedet_execute_appointment` without explicit user intent to book this appointment. Execution is disabled unless the operator deliberately sets `MEUHEDET_ENABLE_BOOKING=1`; do not enable it during research or development. Execution also needs a compatible MCP host supporting form elicitation through protocol 2026-07-28 or the SDK legacy adapter. The host must obtain human approval of the exact proposal; a model-supplied `confirmed` flag is not accepted. Signed approval state, proposal expiry, account binding, fresh slot/conditions checks and a durable exclusive attempt marker protect the final step. Never bypass an unavailable confirmation interface with a direct API call.

`submitted_unverified` means the server accepted the request, not that a booked appointment has been independently confirmed. `outcome_uncertain`, `attempting`, and `existing_appointment` require inspecting future appointments and reporting uncertainty or conflict; never retry, replace, cancel, or erase attempt markers automatically. `meuhedet_booking_status` reads only a local marker. After restart, proposals expire but attempt markers remain. Do not claim live booking from synthetic tests.

Read only the category requested. Lab commands include `lab-stickers` (dashboard summary), `lab-results --from YYYY-MM-DD --to YYYY-MM-DD` (date-filtered list), and `lab-result --lab-code CODE --sticker-id ID --date YYYYMMDD` (individual details). Choose detail references from the returned list, never guessed identifiers. Check the result's date, units, reference ranges, and completeness before analysis. Other commands and MCP tools are listed in [capabilities](../../docs/CAPABILITIES.md).

Keep results private. Do not expose session data, cookies, identifiers, HAR files, or unnecessary clinical details. Never save medical results to files or send them to another service unless the user explicitly requests it. Public medical research must not include patient identifiers or raw patient results in search queries. Empty or missing records do not establish complete history or absence of care.

See [authentication](../../docs/AUTH.md) and [CLI reference](../../docs/CLI.md) for lifecycle and limitations.
