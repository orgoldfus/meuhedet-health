# Local stdio MCP server

Build the project from a local checkout, sign in with the CLI, then configure your MCP client to launch the built file:

```sh
npm install
npm run build
node dist/cli.js login
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

The server uses the CLI's local session file. It communicates over stdio only; it does not open a network listener or accept credentials as tool arguments. Tools are read-only and include `meuhedet_session_status`, `meuhedet_lab_stickers`, `meuhedet_lab_results`, `meuhedet_lab_result`, `meuhedet_prescriptions`, `meuhedet_active_medicines`, `meuhedet_medicine_approvals`, `meuhedet_purchased_medicines`, `meuhedet_prescription_history`, `meuhedet_future_appointments`, `meuhedet_visit_approvals`, and `meuhedet_visit_referrals`.

`meuhedet_lab_results` requires `{ "fromDate": "YYYY-MM-DD", "toDate": "YYYY-MM-DD" }`, a valid date window with `fromDate` no later than `toDate`; backend boundary inclusion is unverified. `meuhedet_lab_result` requires `{ "labCode": "CODE", "stickerId": "ID", "date": "YYYYMMDD" }`; both identifiers must be numeric strings and the detail date should come from a sticker listing. These inputs are strictly validated, with no arbitrary path or URL argument. Results pass through the clinical privacy filter and a 128 KiB output cap. Reads are serialized so a refreshed session is saved before the next read.

The reads use public-frontend-derived endpoint paths. Authenticated response behavior and completeness are unverified. Empty results do not prove absence of records. Review [privacy and authentication notes](AUTH.md) before sharing results with an assistant.
