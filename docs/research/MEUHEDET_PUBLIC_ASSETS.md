# Meuhedet public portal observations (2026-09-29)

All requests below were unauthenticated GETs for public pages/assets. No patient ID, phone, date of birth, OTP, or patient API was submitted. The exact authenticated response schemas, login challenge/OTP step, and lab POST bodies are **not observed**.

## Provenance

- `https://www.meuhedet.co.il/24928` links to `https://online.meuhedet.co.il/הבדיקות-שלי/בדיקות-מעבדה/`, `https://online.meuhedet.co.il/התרופות-שלי/`, and other protected services. The lab route redirects an unauthenticated viewer to `https://login.meuhedet.co.il/connect/authorize` with `client_id=meuhedet.web.owin.prod`, `redirect_uri=https://online.meuhedet.co.il/signin-oidc`, `response_mode=form_post`, `response_type=id_token`, `scope=openid profile email address phone meuhedet`, transient `state` and `nonce`, and `type=1`.
- `https://login.meuhedet.co.il/account/login` saved as `login.html`; links to `/Account/FirstStepLogin` and `/Account/LoginWithoutPassword`.
- `https://login.meuhedet.co.il/Account/FirstStepLogin` saved as `FirstStepLogin.html` (SHA-256 `183ca1753a29ae155355532f9689107b80618fae952425a07c223a2edc226de2`). Its form is `POST /Account/FirstStepLogin`, fields `Username`, `MobilePhoneNumber`, `ReturnUrl`, `__RequestVerificationToken`; button text sends code to mobile. Its public script `/js/login-first-step.min.js?v=qnFteM4xNCdrt2KKw6vBYLITyxAAQJYES_jKswOsrzM` saved as `login-first-step.js`, validates Israeli ID or alternate IdType 9, and `^05[0-9][0-9]{7}$` phone. Script only validates/disables submit, so HTML form is the actual POST.
- `https://login.meuhedet.co.il/Account/LoginWithoutPassword` saved as `LoginWithoutPassword.html`; form is `POST /Account/LoginWithoutPassword`, fields `Username`, `BirthDateFormatted`, `ReturnUrl`, `__RequestVerificationToken`. Its script validates date like dd/mm/yyyy or eight digits. This alternate flow has not been followed.
- `https://online.meuhedet.co.il/` saved as `online.html` (SHA-256 `a9bba020c4e54c39f45ddbbcb69c19a8ba50400672cf63855907a684cf2b1103`), loads `https://online.meuhedet.co.il/bundles/eservices?v=WfPoxH1z9xXDX22cDVUVOPqcag7VjLJ5-jYvKgOqA3c1`. Downloaded as `eservices.js` (10,070,922 bytes, SHA-256 `dbd093533b9602fdffbb01f80cb42b37954bc371592edabbdad87ad80636fd15`). Relevant service wrapper appears near byte offsets 69,883–77,383; axios configuration near 97,845. This is public first-party code, not a captured authenticated exchange.

## Observed API service wrappers

All relative paths below resolve against `https://online.meuhedet.co.il/umbraco/api/`, as specified by the bundle's axios `baseURL=window.location.origin+"/umbraco/api/"`; it sets a 30 s timeout. A request interceptor appends `uniq_param=Date.now()` and sets `locale=window._mApp.MiscConfiguration.Locale`, `x-node-id=window._mApp.Node.Id`, `X-requested-with=XMLHttpRequest`, and `x-platform=1`. The home bootstrap uses public `configurationapi/NodeVars?nodeId=37538270-5ef9-424c-ba74-e26eee0aae9d` (saved `node.json`) for home `Node.Id=2327`; target pages may use distinct node IDs. `configurationapi/Vars?nodeId=...` gives locale and other configuration (saved `nodevars.json`).

| Purpose | Method/path | Explicit arguments in wrapper |
|---|---|---|
| Lab sticker list | `POST LabApi/Stickers` | body argument `t`, shape unobserved |
| Lab sticker detail | `POST LabApi/Sticker` | body argument `t`, shape unobserved |
| Lab history | `POST LabApi/HistoryTests` | body argument `t`, shape unobserved |
| Lab list search metadata | `GET LabApi/StickersSearchBarData` | no body |
| Lab history search metadata | `GET LabApi/HistoryTestsSearchBarData` | no body |
| Dashboard lab stickers | `GET PersonalDashboardApi/LabStickers` | no body; public component reads `response.data.Stickers`, renders `TestDate`, `InstituteName`, `DoctorFirstName`, `DoctorLastName`; builds detail URL using `LabCode`, `StickerId`, `TestDate` |
| Dashboard prescription history | `GET PersonalDashboardApi/Prescriptions` | no body; public component reads `response.data.Items`, renders `FormDate`, `DoctorName`, `DoctorSpecification` |
| Digital prescriptions | `POST MedicationsApi/PrescriptionsData` | body argument `t`, shape unobserved |
| Medicines | `POST MedicationsApi/Medicines` | body argument `t`, shape unobserved |
| Medication approvals | `POST MedicationsApi/MedicationsApprovalsData` | body argument `t`, shape unobserved |
| Future appointments | `POST AppointmentApi/FutureAppointmentsOnly` | literal empty object `{}` body |
| Past appointments | `POST AppointmentApi/PastAppointmentsOnly` | body `t`, optional headers `e`, shape unobserved |
| Visit approvals | `GET OnlineCommunicationApi/GetVisitsApprovals` | no body |
| Visit referrals | `GET OnlineCommunicationApi/GetVisitsRefs` | no body |
| Online reference requests | `GET OnlineCommunicationApi/OnlineReferences` | header `x-support-online-references: 1`; optional overridden URL |
| Reference list | `GET v2/reference/list` | no body |
| Reference detail | `GET v2/reference/${id}` | optional `x-uid` header |

An unauthenticated GET to both `PersonalDashboardApi/LabStickers` and `PersonalDashboardApi/Prescriptions` with homepage headers returned HTTP 401 JSON `{"Message":"Authorization has been denied for this request."}`. There is no observed authenticated patient response or example lab body in the public homepage bundle. A reliable lab list/detail integration needs a consenting user to sign in and capture/redact their own requests, or discovery of the protected page's exact first-party bundle. Avoid constructing filters/identifiers from guesses. No claim is made about a public supported API or stability.


## Additional page bundles (2026-09-29)

The following public first-party frontend assets were fetched without cookies. No raw page HTML, member identifiers, clinical results, or session material is included here.

| Asset | SHA-256 |
|---|---|
| `https://online.meuhedet.co.il/bundles/lab-stickers?v=bQ8US5tWNHgoiH_NBIHva5z0kILUhFgtSKDiEuCA7JU1` | `97a9e36946ed7f544bd22bcaf2895a2edfb58db90983fa2d1f4faa75b29775e0` |
| `https://online.meuhedet.co.il/bundles/sticker?v=VYXQBVUZlMhvNppXGd-eizDsRsc5m2Vpw00tVcz9Erc1` | `a4c0eb10e48ddd4a4742a3e9e052e5cb00ae7cc631e3bc2ee335bb8638c9c936` |
| `https://online.meuhedet.co.il/bundles/medicines-dashboard?v=UoZBPwJWLTclX9mTkOaXwKtldN30sNba5--l6Z2MoqI1` | `88f5eded94f3134725bd371105ac267a17b25f78da72571ea88e39fe7496c7c1` |

The lab list serializer (`lab-stickers`, around byte 5,861,436) emits `FromDate` and `ToDate` after subtracting each Date's timezone offset and calling `toISOString`. The component's default window is twelve months; the new client takes explicit calendar dates at midnight. Backend endpoint inclusivity remains unverified. List items expose `LabCode`, `StickerId`, and `TestDate` for detail references; the model reads `Items`, `HiddenItems`, and `TotalCount`.

The detail component (`sticker`, around byte 6,241,340) invokes `GetLabSticker(labCode, stickerId, stickerDate)`. Its wrapper is `GET /api/labs/{labCode}/stickers/{stickerId}?date={date}`, separate from the legacy POST wrapper. Rendered data uses `detailsSection`, `testSections`, and `pregnancySection`. Response 406/412 receives special handling in the portal; this client reports HTTP errors without clinical interpretation.

The medicines page wrappers are around byte 84,276. Actual tab calls are around 6,173,181 (active), 6,181,652 (approvals), 6,192,395 (prescription history), and 6,198,579 (purchased). See [API source notes](../API-SOURCES.md) for route/collection mappings. Source-derived schema checks are still not validated against captured member API responses.
