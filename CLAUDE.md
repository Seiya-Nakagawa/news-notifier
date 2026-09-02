# CLAUDE.md

このファイルは、本リポジトリ固有の事情を記録したものです。

基本方針・機密情報の取り扱い・Git 運用・コーディング規約・Markdown 記法などの共通規約は
グローバル規約（`~/.claude/CLAUDE.md`、`~/.gemini/GEMINI.md`、`~/.claude/rules/`）に従います。
**本ファイルに共通規約を重複定義しないこと。**

## Overview

Google Apps Script (GAS) project that fetches daily news (Google News RSS + JPCERT/CC + AWS ALAS security advisories), summarizes it with the Gemini API, and emails the summary via Gmail. There is no build step, package manager runtime, or test suite — this is plain GAS JavaScript pushed directly to the Apps Script editor via `clasp`.

## Commands

```bash
npm install     # install clasp + GAS type defs (dev-only, for editor support)
npm run login   # clasp login (one-time, browser OAuth)
npm run create  # clasp create --type standalone --rootDir src (only for a brand-new GAS project)
npm run push    # clasp push — pushes src/ to the linked GAS project
```

There is no lint, build, or test command — verification happens by running functions directly in the Apps Script editor (see Deploy/Verify flow below).

## Architecture

- `src/config.js` — single `CONFIG` object: script property key names, the list of RSS feed URLs (`CONFIG.NEWS_RSS_URLS`), fetch count per feed, and the Gemini API base URL. Add new RSS sources here.
- `src/main.js` — all logic, in one file with no dependencies between multiple files:
  - `notifyMorningNews()` — entry point (this is the function wired to the time-driven trigger in the GAS UI). Reads script properties, calls the three steps below, and only ever throws internally (errors are caught and logged, never re-thrown).
  - `fetchNews()` — iterates `CONFIG.NEWS_RSS_URLS`, parses each feed with `XmlService`, and dedupes items by link across all feeds. Handles **two feed shapes**: standard RSS 2.0 (`<channel><item>`) and RSS 1.0/RDF (`<rdf:RDF><item>`, used by JPCERT/CC) — the RDF branch looks up `title`/`link` in the default namespace and `pubDate` via `dc:date`. When adding a new feed, check which shape it uses before assuming the RSS 2.0 path works.
  - `summarizeNews(newsList, apiKey, modelName)` — builds a fixed Japanese prompt (5 fixed categories: 政治/経済/IT・AI/セキュリティ/その他) and calls the Gemini REST API directly via `UrlFetchApp` (no Google AI SDK). The security category prompt specifically asks for CVE numbers for AWS/Linux/EC-CUBE-related vulnerabilities.
  - `sendEmailNotification(text, emailAddress)` — sends via `GmailApp.sendEmail`, no HTML formatting.
  - `testProperties()` — debug helper to confirm which script properties are set without printing their values (logs key name + character count only).
- `src/appsscript.json` — GAS manifest (timezone `Asia/Tokyo`, V8 runtime, Stackdriver exception logging).

## Configuration (GAS Script Properties, not files)

Secrets and per-environment config live in the GAS project's Script Properties (set via the Apps Script editor UI, gear icon → Script Properties), never in the repo:

- `GEMINI_API_KEY` — required
- `GEMINI_MODEL_NAME` — required (e.g. `gemini-1.5-flash`)
- `NOTIFICATION_EMAIL` — optional; falls back to `Session.getActiveUser().getEmail()` if unset

## Deploy / verify flow

Follow the global GAS deploy rule (`~/.claude/rules/gas-deploy-flow.md`): push with `clasp push`, then run `notifyMorningNews` (or `testProperties`) from the Apps Script editor to verify, check the trigger under the clock icon, and only push to git / open a PR after the user confirms it works — never push to git before that confirmation.

This is a standalone, time-driven-trigger script rather than a web app, so the `clasp deploy -i` step in that rule does not apply here — `clasp push` alone makes the new code live for the trigger.

## Notes on doc drift

`README.md`'s setup steps still mention a `SLACK_WEBHOOK_URL` script property from a prior version of this project; the current code (`src/main.js`, `docs/DESIGN.md`) sends email via Gmail instead. When touching notification logic, prefer `docs/DESIGN.md` as the source of truth and update `README.md` to match (see the global docs-sync rule).
