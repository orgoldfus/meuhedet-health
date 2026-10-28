# Capabilities and limitations

This fork provides account reads, public doctor search and an approval-gated appointment workflow. Contracts come from first-party frontend source. Public directory search, appointment-focused private sign-in and monthly/daily availability were live-validated on 2026-10-14. Preparation is tested against filtered metadata observations; complete live preparation and booking remain unverified. Tests use synthetic fixtures.

| Data | CLI command | MCP tool | Endpoint |
|---|---|---|---|
| Dashboard lab summary | `lab-stickers` | `meuhedet_lab_stickers` | `GET /umbraco/api/PersonalDashboardApi/LabStickers` |
| Lab list in a date window | `lab-results` | `meuhedet_lab_results` | `POST /umbraco/api/LabApi/Stickers` |
| Individual lab-result details | `lab-result` | `meuhedet_lab_result` | `GET /api/labs/{labCode}/stickers/{stickerId}?date={YYYYMMDD}` |
| Dashboard prescription summary | `prescriptions` | `meuhedet_prescriptions` | `GET /umbraco/api/PersonalDashboardApi/Prescriptions` |
| Prescription history | `prescription-history` | `meuhedet_prescription_history` | `GET /api/medications/prescriptions` |
| Active medicines | `active-medicines` | `meuhedet_active_medicines` | `GET /api/medications/active/all` |
| Purchased medicines | `purchased-medicines` | `meuhedet_purchased_medicines` | `GET /api/medications/meds/purchased` |
| Medicine approvals | `medicine-approvals` | `meuhedet_medicine_approvals` | `GET /api/medications/meds/approvals` |
| Future appointments | `future-appointments` | `meuhedet_future_appointments` | `POST /umbraco/api/AppointmentApi/FutureAppointmentsOnly` |
| Visit approvals | `visit-approvals` | `meuhedet_visit_approvals` | `GET /umbraco/api/OnlineCommunicationApi/GetVisitsApprovals` |
| Visit referrals | `visit-referrals` | `meuhedet_visit_referrals` | `GET /umbraco/api/OnlineCommunicationApi/GetVisitsRefs` |
| Local session status | `status` | `meuhedet_session_status` | Local file check only; does not establish validity |

The CLI also supports `login`, `session-import`, and `logout`. MCP exposes native sign-in, the existing account readers and the five appointment tools documented in [appointment workflow](APPOINTMENTS.md). Booking execution is disabled by default, requires exact host-mediated approval, and is limited to basic clinic visits. No appointment update/cancel tools are exposed. See [authentication](AUTH.md), [CLI](CLI.md), and [MCP](MCP.md).

## Validation boundary

- Browser UI access and a prior standalone browser sign-in/dashboard read are confirmed. New appointment-focused login validation and authenticated appointment schemas still require private live validation.
- `lab-stickers` is only the dashboard summary. `lab-results` queries a specified date window; it does not fetch every historical record or paginate automatically.
- `lab-result` preserves the source response and its numeric or qualitative values. It does not interpret medical results or reconstruct missing fields.
- Prescription history and medication lists use separate endpoints from the dashboard prescription summary. Their relative coverage is unknown.
- The parser may reject an unfamiliar OTP form. Synthetic fixtures test behavior without copying member data.
- An empty result never establishes absence of care. Existing clinical readers cannot change records. The separately gated appointment workflow can submit one new appointment after human approval; it cannot update or cancel one.

See [API source notes](API-SOURCES.md) for the evidence and remaining local validation steps.
