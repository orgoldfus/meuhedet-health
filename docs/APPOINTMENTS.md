# Doctor search and appointment workflow

## Availability and validation

`MeuhedetDirectory.searchDoctors({query, city?, page?, limit?})` searches the public professional directory. The implementation fetches the site's published configuration, uses its read-only Algolia configuration in memory, and returns only doctor/location fields. Portal cookies never reach Algolia. The API key is neither hard-coded nor returned. Only an app-ID-derived Algolia host is allowed; redirects are refused. City is an exact filter, not a distance radius.

`MeuhedetAppointmentClient.availability(providerId, date, appointmentType, scope)` reads monthly dates or daily slots. Modern types are 0 clinic, 1 video, 2 phone; they differ from some legacy wizard values. The timezone is Asia/Jerusalem. Dates must be real calendar dates and IDs must come from returned providers. Unknown response structures are rejected rather than presented as empty availability.

Public doctor search, appointment-focused private sign-in, and authenticated monthly/daily availability were exercised live on 2026-10-14. Public directory results alone never prove available slots or clinical suitability. A later authenticated read returned HTTP 401 and stopped without initiating another SMS. Null contact fields, live preparation and booking remain unverified. All mutation tests use synthetic responses; no real appointment has been created, changed or cancelled.

Preparation accepts the observed ordinary clinic block sequence `details.block`, `datepicker.block`, `summary.block`. Explicit null prevalidation means no alert, matching the official frontend; a non-null result must be affirmative, unblocked and message-free. A missing or unknown prevalidation value fails closed. Restricted visits, required/unknown billing, nonempty or unknown message categories, disclaimers, extra/reordered/duplicate blocks and external providers also stop before slot revalidation. This adapter is tested with synthetic values reflecting the observed shape; it has not been live-validated as a complete proposal flow.

## MCP tools

| Tool | Inputs | Effect |
|---|---|---|
| `meuhedet_search_doctors` | `query`, optional `city`, `page` and `limit` | Public search, without an account session |
| `meuhedet_appointment_availability` | `providerId`, `date`, `scope`, optional `appointmentType` | Authenticated read of dates or slots |
| `meuhedet_prepare_appointment` | `providerId`, `date`, exact returned `fromTime`, `toTime` | Read/revalidate and create an in-memory proposal; no reservation |
| `meuhedet_execute_appointment` | `proposalId` only | Host confirmation followed by at most one create request |
| `meuhedet_booking_status` | `bookingKey` | Read a local attempt marker; does not verify an appointment |

The existing `meuhedet_future_appointments` remains the account reader. No update/cancel endpoints or tools have been added. The CLI has no booking command; use the MCP workflow or a developer-controlled library integration implementing the same approval/attempt boundary.

## Human approval and duplicate prevention

Execution is off by default. An operator must deliberately set `MEUHEDET_ENABLE_BOOKING=1` only after reviewing and privately validating the authenticated contracts. A development or read-only request never authorizes this change or a real booking.

Execution requires an MCP host supporting form elicitation. The current standalone stdio server is tested through the SDK legacy adapter, which obtains real host elicitation responses before re-entry. Native rendering in the user's host remains unverified. The server returns an exact doctor/location/date/time confirmation through the protocol; it does not accept a `confirmed` argument. The approval envelope uses a per-process HMAC key, a five-minute lifetime, method/transport binding, a proposal ID and a single-use nonce. It is verified before the handler sees it. A new process invalidates old proposals and approval envelopes.

After approval, the server rechecks the login marker, provider/conditions and returned slot. A changed proposal, expiry, cancellation or unsupported questionnaire/disclaimer stops before submission. The initial supported scope is a basic in-person visit with a Meuhedet doctor; other flows are rejected. No reminders, calendar messages, contact updates or replacement of existing appointments are triggered.

Before sending a create request, an exclusive `wx` file claim is written and synced under the owner-only `~/.config/meuhedet-health/booking-attempts/` directory (or configured config directory). Only a hash of provider/date/time and an outcome state are persisted. The claim blocks duplicate attempts across processes and restarts; even a crash before POST remains blocked conservatively. The marker is not a backend idempotency key and does not prove exactly-once delivery at Meuhedet.

The create request uses manual redirect handling and is never automatically retried. Timeout, network failure, unexpected content, redirects or an unreadable/torn journal yield uncertainty and block replay. `submitted_unverified` reports an accepted request, requiring a future-appointment check before claiming booking. `existing_appointment` is a conflict; no update is attempted. Marker deletion or retry after independent reconciliation requires a separate, explicit operator decision; there is no automatic reset tool.

## Source-derived contracts

The contemporary first-party bundle also contains an older `AppointmentApi/CreateAppointment` wrapper. This implementation uses the modern `/api/appointment/` wizard instead. See [research provenance](research/MEUHEDET_APPOINTMENTS.md) for the exact public source and observed field mappings. These are unofficial frontend contracts, not a supported public API.
