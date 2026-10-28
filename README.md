# Meuhedet Health

An unofficial, experimental, TypeScript client, CLI, and local stdio MCP server for account reads, public doctor search and approval-gated appointment proposals.

This is an adaptation of [Maccabi Health by Oren Yomtov](https://github.com/orenyomtov/maccabi-health), licensed under MIT and based on upstream commit `1df6d615c952351fec1eb598bdcc8a3b43563b49`. The original copyright notice is retained. This project is not affiliated with Meuhedet.

## Current scope

The implemented reads are dashboard lab stickers, a date-filtered lab list, individual lab-result details, the dashboard prescription summary, prescription history, active/purchased medicines, medicine approvals, future appointments, visit approvals, and visit referrals. Lab details preserve the source response, including numeric or qualitative results when supplied. This is not a guarantee of full history or completeness. Prescription retention is also unknown. Request contracts come from Meuhedet's first-party frontend assets. The new appointment workflow is documented in [appointment workflow](docs/APPOINTMENTS.md). Public doctor search and authenticated availability were live-validated on 2026-10-14. Preparation is tested against filtered live metadata observations; complete live preparation and booking remain unverified. Execution is disabled by default and requires host-mediated human confirmation.

The login flow parses the observed first-step login form, dynamically looks for OTP controls, and verifies an authenticated future-appointment response without opening laboratory records before saving a session. Appointment-focused private browser sign-in completed a live run on 2026-10-14 after correcting singleton OTP-control parsing; unfamiliar portal changes still fail closed. `session-import` is also available for a serialized Meuhedet session obtained for your own account. Never share raw HAR files, cookies, session JSON, or unredacted health data in chat, issues, or commits.

Use this only with your own account. An empty result does not establish that no record exists. See [validation status and next steps](docs/API-SOURCES.md) and [privacy and sessions](docs/AUTH.md).

## Run from a checkout

Use Node.js 24 or Node.js 22.18 or later to build and test locally. CI is configured to smoke-test the packed runtime artifact on Node.js 22.0. No npm registry package is documented; run from a local checkout:

```sh
npm install
npm run build
node dist/cli.js help
```

A connected MCP Apps host can display the sign-in form inside the chat using `meuhedet_sign_in`; see [setup](docs/MCP.md). Without native UI support, the agent starts `login --browser`, opens the returned private local link, and waits while you enter your sign-in details and SMS code. You do not need to run commands yourself. The current login protocol remains experimental despite the successful appointment-focused live validation; future 401 responses require another private sign-in.

Commands include:

```sh
node dist/cli.js login --browser
node dist/cli.js lab-stickers
node dist/cli.js lab-results --from 2026-01-01 --to 2026-09-29
# Use LabCode, StickerId and TestDate from a returned record:
node dist/cli.js lab-result --lab-code CODE --sticker-id ID --date YYYYMMDD
node dist/cli.js prescriptions
node dist/cli.js future-appointments
node dist/cli.js visit-approvals
node dist/cli.js visit-referrals
node dist/cli.js logout
```

See the [CLI reference](docs/CLI.md), [MCP setup](docs/MCP.md), and [capabilities](docs/CAPABILITIES.md).

## TypeScript client

After building, import from the local package entry point:

```ts
import { MeuhedetAuth, MeuhedetClient } from "meuhedet-health";
```

The library API is experimental. Read the docs before using it with a real account.
