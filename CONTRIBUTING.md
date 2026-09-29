# Contributing

This is an unofficial, experimental Meuhedet adaptation of Maccabi Health by Oren Yomtov. The source is MIT-licensed and retains the upstream copyright notice. Keep that attribution in source redistributions.

## Local checks

Use Node.js 22 or later. From the repository root:

```sh
npm install
npm run check
```

Tests use synthetic fixtures and local or mocked responses. Do not add tests that require real member credentials, OTPs, or live health data. Never put personal identifiers, cookies, session JSON, or clinical records in fixtures, logs, issues, or commits.

## API work

Ground endpoint paths, request fields, and response shapes in public first-party frontend assets or a consenting account holder's own redacted observation. Record source and confidence in `docs/API-SOURCES.md`. Distinguish frontend-derived assumptions, offline-tested behavior, and live-account validation explicitly. Do not invent request bodies or imply that empty results establish complete history.

Keep reads read-only and bound requests to the observed Meuhedet origins. Never include credentials in command arguments or MCP tool inputs. Errors must not disclose cookies, raw upstream bodies, or clinical content. Treat serialized sessions as credentials.

## Release status

This checkout has no configured release automation or verified npm identity. Do not publish, create registry metadata, or add repository URLs until an owner supplies verified destination details. The package version is `0.1.0`; local source installation is the documented path.
