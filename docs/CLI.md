# CLI reference

Build from a local checkout with Node.js 24 or Node.js 22.18 or later. The packed runtime artifact is smoke-tested on Node.js 22.0:

```sh
npm install
npm run build
node dist/cli.js help
```

The CLI has no published npm installation instructions yet. Do not use `npx meuhedet-health` unless a package is published and verified separately.

| Command | Behavior |
|---|---|
| `login` | Interactively asks for ID number, mobile number, and SMS code. Parses the known first-step form and dynamically looks for OTP controls, then checks for an authenticated lab-sticker response before saving. OTP form parsing uses synthetic fixtures only; no live account run was done, and unfamiliar portal changes may be rejected. |
| `session-import [--file PATH]` | Reads serialized session JSON from a private file or stdin and validates it before saving. |
| `status` | Reports whether a local session file exists; does not verify it upstream. |
| `logout` | Deletes the local session file. |
| `lab-stickers` | Reads the dashboard lab sticker summary. |
| `lab-results --from YYYY-MM-DD --to YYYY-MM-DD` | Reads lab stickers in the specified calendar date window. Both dates are required and must be valid, with `--from` no later than `--to`. Backend boundary inclusion is unverified. |
| `lab-result --lab-code CODE --sticker-id ID --date YYYYMMDD` | Reads one sticker detail using numeric identifiers and the detail date from a listing. All flags are required. |
| `prescriptions` | Reads the current prescription summary. |
| `active-medicines` | Reads active medicines. |
| `medicine-approvals` | Reads medicine approvals. |
| `purchased-medicines` | Reads purchased medicines. |
| `prescription-history` | Reads prescription history. |
| `future-appointments` | Reads future appointments. |
| `visit-approvals` | Reads online visit approvals. |
| `visit-referrals` | Reads online visit referrals. |
| `mcp` | Starts the local stdio MCP server. |
| `help` | Prints command usage. |

Read commands emit JSON. Clinical fields are passed through a privacy filter and output is size-limited. Errors omit upstream response bodies, credentials, and invalid argument values. The lab range and detail commands and medicine reads follow the public frontend's request shapes; standalone CLI authenticated response behavior and historical completeness remain unverified. Dashboard `lab-stickers` and `prescriptions` are summaries. Standalone CLI reads and login have not been tested against a live account. An empty result is not evidence of complete history.
