# API source notes

These notes distinguish public first-party source inspection from authenticated service validation. They do not imply support by Meuhedet or a stable public API.

## Public sources inspected

On 2026-09-29, unauthenticated requests were made to public pages and assets only; no patient ID, phone number, date of birth, OTP, or patient data was submitted. Research notes and hashes are recorded in [the public asset observations](research/MEUHEDET_PUBLIC_ASSETS.md).

- `https://www.meuhedet.co.il/24928` links to protected online services, including the lab and medication pages.
- `https://login.meuhedet.co.il/Account/FirstStepLogin` exposes a login form with `Username`, `MobilePhoneNumber`, `ReturnUrl`, and an anti-forgery token. Its public JavaScript performs client-side input checks.
- `https://online.meuhedet.co.il/` loads the first-party `eservices` bundle. Its axios configuration sets a base URL under `/umbraco/api/` and adds portal request metadata.

The bundle contains wrappers for a larger set of services, with the implemented paths listed in [capabilities](CAPABILITIES.md). Other wrapper names are not treated as supported functions. Several still include opaque request bodies whose shape was not observed. Lab list/detail contracts were subsequently traced in their dedicated bundles; see the additional frontend contracts below.

## What is not validated

- Whether the current dynamic OTP form parsing and OIDC callback work for a real member account.
- Any authenticated patient API response or the exact response schema for implemented reads.
- Data retention, completeness, pagination, localization behavior, and stability of the endpoints.
- Behavior with a real account or the effect of portal-side changes.

The offline suite covers only synthetic fixtures and mocked/local responses. Treat the code as experimental until a consenting account holder independently validates the flow. Do not infer that an empty or missing field means a record does not exist.

## Additional frontend contracts

The following contracts come from first-party frontend assets. They are not captured patient API responses or proof that this package authenticated successfully.

The publicly retrievable `sticker` and `lab-stickers` bundles establish additional contracts:

- `POST /umbraco/api/LabApi/Stickers`: `FromDate` and `ToDate`, serialized as local wall-clock ISO timestamps by the frontend. The component reads `Items`, `HiddenItems`, and `TotalCount`. The default UI window is twelve months; it is not full history.
- `GET /api/labs/{labCode}/stickers/{stickerId}?date={YYYYMMDD}`: the current detail component calls `GetLabSticker` using the three route values. It reads `detailsSection`, `testSections`, and `pregnancySection`.
- The legacy `POST LabApi/Sticker` wrapper is not used for the new detail reader; its body remains unverified.

Live API schemas, required headers, CLI OTP/OIDC behavior, and record completeness remain to be validated in a private local run. Detail and medication readers use page node IDs 8414 and 41057 observed in DOM links; the lab-list reader still uses dashboard node 2327 because the list page node was not established. These header choices are unverified against actual requests.

## Medication frontend contracts

The public medication bundle is `/bundles/medicines-dashboard?v=UoZBPwJWLTclX9mTkOaXwKtldN30sNba5--l6Z2MoqI1`, downloaded without cookies. Its tab components call:

| Endpoint | Collection consumed by frontend |
|---|---|
| `GET /api/medications/active/all` | Top-level array |
| `GET /api/medications/meds/approvals` | `Approvals` |
| `GET /api/medications/meds/purchased` | `Items` |
| `GET /api/medications/prescriptions` | `prescriptions` |

These are root-relative API routes. The prescription-history model includes doctor metadata, prescription dates/number/source, a file key, and medicines; it is distinct from the dashboard summary. Wrapper definitions occur near byte 84,276; component calls near bytes 6,173,181, 6,181,652, 6,192,395, and 6,198,579.

## Focused next validation

Run the CLI login privately on the account holder's machine, then a date-filtered lab query and one detail read. Compare the result structure with the same portal page. Keep credentials, session files, and patient responses private; only redacted structural observations should enter tests. The live OTP hidden combined field and submitted exchange remain unverified. The parser's hidden-field support is conservative and tested with synthetic forms only.
