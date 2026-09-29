# Capabilities and limitations

This fork provides read-only client methods, CLI commands, and local stdio MCP tools. Contracts come from Meuhedet first-party frontend source. This package has not completed a live authenticated API run; tests use synthetic fixtures.

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

The CLI also supports `login`, `session-import`, and `logout`. MCP exposes no login, network listener, or record-changing tools. See [authentication](AUTH.md), [CLI](CLI.md), and [MCP](MCP.md).

## Validation boundary

- Browser UI access is confirmed; standalone CLI login, API response schemas, headers, pagination, retention, and completeness remain unverified with a real account.
- `lab-stickers` is only the dashboard summary. `lab-results` queries a specified date window; it does not fetch every historical record or paginate automatically.
- `lab-result` preserves the source response and its numeric or qualitative values. It does not interpret medical results or reconstruct missing fields.
- Prescription history and medication lists use separate endpoints from the dashboard prescription summary. Their relative coverage is unknown.
- The parser may reject an unfamiliar OTP form. Synthetic fixtures test behavior without copying member data.
- An empty result never establishes absence of care. No appointments, prescriptions, messages, or records can be created or changed by these tools.

See [API source notes](API-SOURCES.md) for the evidence and remaining local validation steps.
