# Local stdio MCP server

## In-chat sign-in

In a host that supports MCP Apps, call `meuhedet_sign_in` to display the native sign-in component inside the conversation. The user enters their ID, phone, and SMS code in the component. The app calls `meuhedet_sign_in_action`, which declares `_meta.ui.visibility: ["app"]`; the agent must never call this tool or supply credentials. A random flow capability is returned only in widget metadata, not model-facing content. The component uses no direct network requests, third-party assets, browser cookie exports, or browser storage. After successful authentication, the server saves the ID and phone number in `sign-in-profile.json` alongside the session, using the same owner-only file protection. Neither value is returned to the component or model. On later sign-ins, the user selects “Send SMS code” and enters only the new code. “Use different details” deletes the saved profile and restores the ID/phone form. SMS codes are never persisted; cancelling or failing the first sign-in does not save a profile. Session expiry does not erase the saved profile. This convenience currently applies to native MCP sign-in; browser and terminal sign-in do not save these details. The local MCP server uses the same `MeuhedetAuth` implementation and private session store as the browser sign-in flow.

The server must be connected to the host before the component can render. Registering a resource in this repository alone does not display it in an existing chat. In hosts without MCP Apps, agents can use the local `login --browser` fallback.

Native host rendering remains unverified; protocol tests use synthetic credentials and an in-memory MCP connection. The standalone browser login and dashboard lab read have completed a live authenticated run; this does not establish completeness or validate every API reader.

## Setup

Build the project from a local checkout, have the agent initiate local browser sign-in, then configure your MCP client to launch the built file:

```sh
npm install
npm run build
node dist/cli.js login --browser
node dist/cli.js mcp
```

Example MCP configuration (replace the path with the absolute path to your checkout):

```json
{
  "mcpServers": {
    "meuhedet-health": {
      "command": "node",
      "args": ["/absolute/path/to/meuhedet-health/dist/cli.js", "mcp"]
    }
  }
}
```

The server uses the CLI's local session file. It communicates over stdio only; it does not open a network listener or accept credentials as tool arguments. The existing account readers include `meuhedet_session_status`, `meuhedet_lab_stickers`, `meuhedet_lab_results`, `meuhedet_lab_result`, `meuhedet_prescriptions`, `meuhedet_active_medicines`, `meuhedet_medicine_approvals`, `meuhedet_purchased_medicines`, `meuhedet_prescription_history`, `meuhedet_future_appointments`, `meuhedet_visit_approvals`, and `meuhedet_visit_referrals`.

`meuhedet_lab_results` requires `{ "fromDate": "YYYY-MM-DD", "toDate": "YYYY-MM-DD" }`, a valid date window with `fromDate` no later than `toDate`; backend boundary inclusion is unverified. `meuhedet_lab_result` requires `{ "labCode": "CODE", "stickerId": "ID", "date": "YYYYMMDD" }`; both identifiers must be numeric strings and the detail date should come from a sticker listing. These inputs are strictly validated, with no arbitrary path or URL argument. Results pass through the clinical privacy filter and a 128 KiB output cap. Reads are serialized so a refreshed session is saved before the next read.

The reads use public-frontend-derived endpoint paths. Authenticated response behavior and completeness are unverified. Empty results do not prove absence of records. Review [privacy and authentication notes](AUTH.md) before sharing results with an assistant.

## Doctor search and guarded booking

The server additionally exposes `meuhedet_search_doctors`, `meuhedet_appointment_availability`, `meuhedet_prepare_appointment`, `meuhedet_execute_appointment` and `meuhedet_booking_status`. Search requires no session. Availability/preparation are read-only; execution is the only mutating tool and has explicit mutation annotations.

Booking is disabled unless `MEUHEDET_ENABLE_BOOKING=1` is deliberately configured. This task does not enable it. A compatible host must present form elicitation through protocol 2026-07-28 or the SDK legacy adapter and return human approval of the exact proposal. Unsupported hosts fail closed; adding a `confirmed` input cannot bypass approval. Local exclusive attempt markers prevent automatic replay across restarts, and response uncertainty never triggers a retry. See [appointment workflow](APPOINTMENTS.md) for schemas, states, limitations and private validation steps.
