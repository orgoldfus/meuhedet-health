# Appointment frontend observations — 2026-10-14

Initial research used unauthenticated public assets/configuration and public professional-directory searches. Later, user-authorized private sign-in and appointment-only reads verified availability and structural metadata. No account IDs, phone numbers, cookies, OTPs, raw authenticated responses or clinical results are included here or saved as fixtures. Public search configuration keys are kept in memory and are not included here.

Source: `https://online.meuhedet.co.il/bundles/eservices?v=WfPoxH1z9xXDX22cDVUVOPqcag7VjLJ5-jYvKgOqA3c1` (10,070,922 bytes), SHA-256 `dbd093533b9602fdffbb01f80cb42b37954bc371592edabbdad87ad80636fd15`.

| Contract | Public-source evidence (approximate byte offset) |
|---|---|
| Public search configuration | `AlgoliaConfiguration.Aid`, `RoKey`, `Env`, `Idx` used by the search client near 102,899; index selection near 5,653,700 |
| Configuration bootstrap | `GET /umbraco/api/configurationapi/Vars?nodeId=37538270-5ef9-424c-ba74-e26eee0aae9d`, observed in the earlier bootstrap research |
| Provider record | `IndexSearchApi/RecordIndexSearch?poiType={type}&id={id}&calcDistance={boolean}` near 70,244 |
| Creation metadata | `GET /api/appointment/start/{type}/{id}/{aptType}/create` near 82,650 |
| Monthly dates | `GET /api/appointment/monthly/{type}/{id}/{aptType}?month={month}&year={year}`; wrappers near 82,900, consumption near 5,955,744 reads `day`, `available` |
| Daily slots | `GET /api/appointment/daily/{type}/{id}/{aptType}?month={month}&day={day}&year={year}`; consumption near 5,956,160 reads `fromTime`, `toTime` |
| Create | `POST /api/appointment/create?session={preVisitSession}`; wrapper near 83,300, call near 5,964,756 |
| Creation body | `createParams` near 5,966,227 emits `{New:{PoiId,PoiType,Type,DoctorOrganizationCode,Platform,Date,StartTime,EndTime,Email,Phone,PrefId}}` |
| Date formatting | `formatDate` / `adjusteToTimezone` near 5,711,216 and 5,713,129, using moment's default ISO formatting with local offset |
| Existing-appointment conflict | `onSuccess` near 5,966,000 branches on `existingAppointment`, routing to a separate switch-existing confirmation |

`AptCreate` interpolates an absent `preVisitSession` as the literal query value `undefined`; the basic create implementation mirrors that source behavior. The New phone/email/pref fields are nullable in the frontend expression. This implementation keeps them null and restricts clinic visits to internal organization code 0. Acceptance of this payload has not been live-tested.

Live unauthenticated directory queries returned HTTP 200 and professional records with `Id`, `Type`, `Name`, `City`, `Specialization`, `DoctorOrganizationCode` and `AvailabileForOnLine`. Later authenticated monthly/daily reads verified `day`/`available` and `fromTime`/`toTime`. No create request was made. Synthetic fixtures model structural observations using invented values, not captured member responses.

## Ordinary clinic metadata observed live

Three general-orthopedist clinic contexts returned null `session.prevalidation`, null `meta.disclaimer`, false `markers.restricted`, and the ordered block sequence `details.block`, `datepicker.block`, `summary.block`. The public frontend's `hasPrevalidationAlert` is `session.prevalidation && !session.prevalidation?.valid`, so null is an absence of an alert rather than a failed result. The previous adapter required an affirmative object and unobserved block names; that assumption was corrected. The source also displays `meta.messages.group`, `meta.billing.required`, and restricted-visit messages. Preparation refuses nonempty/unknown messages, required/unknown billing and restricted visits instead of omitting them from approval. Exact billing/message shapes and the complete preparation flow still need private live validation. Execution stays disabled.
