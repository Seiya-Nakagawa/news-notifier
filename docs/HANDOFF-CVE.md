# 引継ぎ: 脆弱性(CVE)自動通知機能

作成日: 2026-08-05

本ファイルは、news-notifier への CVE 通知機能追加作業を別セッションへ引き継ぐためのものです。
**実装はコード上完了しており、残っているのはデプロイと動作確認です。**

## 1. 背景・目的

副業でサーバ保守を受注している依頼元（motosaka氏）から、Nginx の脆弱性
（CVE-2026-42533 / CVE-2026-60005 / CVE-2026-56434）を把握していたかを問われ、
把握できていなかった。今後同様の見落としを防ぐため、保守対象サーバのミドルウェアに
関連する CVE を自動収集・通知する仕組みを構築する。

依頼元は社内 Slack の `#security_info` チャンネルで脆弱性情報を流しているが、
そこへは直接アクセスできないため、**自分側で独立して監視できる仕組み**が必要。

新規インフラは立てず、既に稼働している GAS 製ニュース通知に相乗りする方針を採用した。

## 2. 調査で判明した既存システムの実態（重要）

**元の引継ぎコンテキストに書かれていた前提は古く、以下が正しい。**

| 項目 | 実態 |
|---|---|
| GAS プロジェクト | 本リポジトリと clasp 連携済み（`.clasp.json` の `scriptId`） |
| 通知先 | **Slack ではなくメール**（`GmailApp.sendEmail` / スクリプトプロパティ `NOTIFICATION_EMAIL`） |
| 要約エンジン | **Claude API ではなく Gemini API**（REST を `UrlFetchApp` で直叩き） |
| トリガー | 時間主導型・毎朝 7〜8 時に `notifyMorningNews` |
| 既存のセキュリティ情報源 | JPCERT/CC RSS + AWS ALAS RSS（要約の「セキュリティ」カテゴリに含む） |
| ミドルウェア一覧の管理場所 | 存在しなかった → `src/config.js` に新設 |

Slack 連携や Claude API を前提にした提案はしないこと。

## 3. ユーザーが決定した方針

1. **監視対象一覧の管理場所:** スプレッドシートではなく `src/config.js` に定義する（通知済み CVE-ID はスクリプトプロパティで管理）。
2. **通知方法:** 既存の朝ニュースメールとは**別メール**で送る。実行は既存トリガー内（`notifyMorningNews`）で行い、トリガーは増やさない。
3. **CVSS 閾値:** 7.0 以上（HIGH 以上）。スコア未評価の CVE は通知しない。
4. **NVD API キー:** 取得して使う方針。

## 4. 実装済みの内容

すべて未コミット。`git status` で `README.md` / `docs/DESIGN.md` / `src/config.js` / `src/main.js` が変更済み。

### 4.1 src/config.js

- `CONFIG.PROPS` に `NVD_API_KEY` と `NOTIFIED_CVE_IDS` を追加。
- `CONFIG.CVE` を新設（`TARGETS` / `MIN_CVSS_SCORE: 7.0` / `LOOKBACK_DAYS: 30` / レート制限待機時間など）。
- `CONFIG.NVD_API_URL` を追加。

### 4.2 src/main.js

- `notifyMorningNews()` を、ニュース通知と CVE 通知を**それぞれ独立した try/catch** で呼ぶ形に変更。片方が失敗してももう片方は通知される。ニュース処理は `runNewsNotification()` に切り出した（元は早期 return が CVE 処理までスキップしてしまうため）。
- Gemini のリトライ処理を `callGemini()` に共通化し、`summarizeNews()` もこれを使う形にリファクタした。
- CVE 通知一式を追加（`notifyCveAlerts` / `runCveNotification` / `fetchCveList` / `requestNvd` / `matchesTarget` / `collectCpeProducts` / `extractCvss` / `severityOfScore` / `cveDescription` / `cveReferences` / `formatNvdDate` / `loadNotifiedCveIds` / `saveNotifiedCveIds` / `translateCveDescriptions` / `sendCveEmailNotification` / `testCveFetch`）。

### 4.3 ドキュメント

- `docs/DESIGN.md`: CVE 通知の設計を追記。§1 に残っていた Slack 記述のドリフトも修正。
- `README.md`: `NVD_API_KEY` の設定手順、監視対象の設定方法、実行できる関数の一覧を追記。

## 5. 該当判定ロジックの設計理由（最重要・変更時は必ず読むこと）

NVD のキーワード検索は **CVE の説明文**を対象とする。そのため素直に実装すると
「その製品に言及しているだけ」の無関係な CVE を大量に拾う。過去 30 日の実データで測定した結果が以下。

| キーワード | 素朴な実装（説明文一致） | 最終実装 |
|---|---|---|
| nginx | 9 件（うち 4 件ノイズ） | **5 件（ノイズ 0）** |
| php | **110 件** | **4 件** |
| openssl | 7 件（**全てノイズ**） | 0 件 |

ノイズの正体は、`php` が「PHP で書かれた別製品」（Composer, Guzzle, Vtiger CRM 等）、
`openssl` が「OpenSSL を呼び出している WordPress プラグイン」だった。
CVSS 閾値や除外語リストでは分離できない（案として測定したが php は 110→75 までしか減らなかった）。

決め手は **採番元 CNA（`cve.sourceIdentifier`）が製品ベンダー自身かどうか**。
真の PHP 処理系の脆弱性は全て `security@php.net`、nginx は `f5sirt@f5.com` から採番されていた。

`matchesTarget()` はこの知見に基づき 3 段階で判定する。

1. **CPE（影響製品）一致** — 最も確実だが、NVD の解析完了後にしか付与されない。
2. **採番元 CNA 一致** — `TARGETS[].sources` と照合。**取りこぼしを防ぐ主線。**
3. **説明文一致** — `TARGETS[].descriptionMatch: true` かつ CPE 未割当のときのみ。

### 特に重要な発見

**CVE-2026-42533 は公開から約 1 ヶ月経っても `Awaiting Analysis` で CPE が未割当だった。**
つまり CPE 照合だけでは、今回の見落とし事例そのものを検出できない。
CNA 経路（2）を主線に据えているのはこのため。ここを削ると要件を満たさなくなる。

`LOOKBACK_DAYS: 30` と長めなのも、公開直後の CVE が CVSS 未評価・CPE 未割当のまま
数週間放置されることがあり、後日スコアや CPE が付いた時点で拾い直すため。
通知済み ID による重複排除が効くので、期間を延ばしても再通知は起きない。

## 6. 検証済みのこと / 未検証のこと

### 検証済み（ローカル、実データ）

- NVD API 2.0 への到達性とレスポンス構造。
- `matchesTarget` / `extractCvss` / `cveDescription` / `cveReferences` の実データでの挙動。
- **問題の 3 件（CVE-2026-42533 / 56434 / 60005）を全て検出**し、42533 が通知メールの最上位に来ること。
- `sendCveEmailNotification` が組み立てる件名と本文（Gemini 翻訳が失敗した場合の英文フォールバック経路）。
- `node --check` による構文チェック。

検証は GAS のグローバル（`PropertiesService` 等）をスタブ化し、Node の `vm` で
`src/config.js` と `src/main.js` を読み込んで実施した。
なお `src/` 配下は `clasp push` の対象なので、**検証用スクリプトを `src/` に置かないこと**。

2026-08-06 に、実態へ差し替えた `TARGETS` で同じ手法の再検証を実施した。

- `testCveFetch` 相当の実行で直近 30 日 **26 件**（初回通知想定件数）。
- **問題の 3 件（CVE-2026-42533 / 56434 / 60005）を全て検出**し、42533 が CVSS 9.2 で上位に来ることを確認。
- `sendCveEmailNotification` が組み立てる件名・本文（英文フォールバック経路）を確認。
- `node --check` による構文チェック。

### 未検証（次セッションの作業）

- GAS 実環境での動作（`clasp push` が 403 で未実施。7.2 参照）。
- `translateCveDescriptions()` の Gemini 呼び出し（`responseMimeType: 'application/json'` を使用）。API キーがなくローカル検証できていない。失敗しても英文のまま通知が継続する設計にはなっている。
- NVD API キー使用時のヘッダ認証（`headers: { apiKey: ... }`）。

## 7. 残作業

### 7.1 完了済み（2026-08-06）

1. **`CONFIG.CVE.TARGETS` を実態に置き換えた。** 根拠は
   `teiz/スズキインフラ検証/04_保守・運用/202607_サーバ定期監視/作業報告書.md`（4.2.8 / 4.2.9）。
   対象4台（`suzuki-ma` / `suzuki-ec` および同STG）の実構成は
   **nginx 1.26.3 / PHP 8.3.x / MySQL 8.4.5 / Laravel / Amazon Linux 2023** であり、
   引継ぎ時点の仮置きにあった **EC-CUBE は稼働していない**（EC サイトも Laravel 製）。
   最終的な監視対象は nginx / php / mysql / openssl / openssh / laravel の 6 件。
   OS（Amazon Linux 2023）は AWS ALAS の RSS が既に朝ニュース側に入っているため対象外とした。
2. **`project` フィールドを廃止した。** ユーザー判断により案件を分ける必要がないため、
   `TARGETS` から `project` を削除し、メール本文の「対象案件」行も削除した。
3. **採番元 CNA を直近 CVE の実データで確認し直した**（下記 7.3）。
4. **NVD API キーを取得**し、スクリプトプロパティ `NVD_API_KEY` に登録した。
5. **`clasp push` を実施した。**
   当初 403 (`The caller does not have permission`) で失敗したが、原因は clasp の
   ログインアカウント違いだった。**GAS プロジェクトの所有者は `aibdlnew1.work@gmail.com`**
   で、`aibdlnew1.sn@gmail.com` でログインしていたため権限がなかった。
   `npx clasp login` で切り替えて解決。以後 403 が出たら、まずログイン中のアカウントを
   `https://oauth2.googleapis.com/tokeninfo?access_token=...` で確認すること。

### 7.2 残っている作業

1. **`testCveFetch` を GAS エディタから実行**して設定を確認する。この関数はメール送信も
   通知済み記録も行わないため、安全に繰り返せる。
2. `notifyMorningNews` を実行し、2 通のメールが届くことを確認する。
3. 確認が取れてから**コミット・push**する（`GEMINI.md` により `main` へ直接コミット、
   Conventional Commits + 日本語）。

### 7.3 採番元 CNA の再確認結果（2026-08-06 実測）

引継ぎ時点の調査は直近 30 日のみだったため、CPE (`virtualMatchString`) 指定で
製品ごとの CVE を引き、**新しい方から** `sourceIdentifier` を集計し直した。
古い CVE はほぼ MITRE 採番のため、古い実績を見ると誤った CNA を設定してしまう。

| キーワード | `sources` | 直近 120 日の通知件数（CVSS 7.0 以上） |
|---|---|---|
| `nginx` | `f5sirt@f5.com` | 19 件（CPE 15 / CNA 4） |
| `php` | `security@php.net` | 15 件（CPE 15） |
| `mysql` | `secalert_us@oracle.com` | 19 件（CPE 17 / CNA 2） |
| `openssl` | `openssl-security@openssl.org` | 15 件（CPE 14 / CNA 1） |
| `openssh` | `cve@mitre.org` | 1 件（CPE 1） |
| `laravel` | （空配列） | 1 件（CPE 1） |

- **OpenSSH** はベンダー CNA を持たず MITRE 採番。キーワード自体が固有で、CVSS 閾値通過後の
  誤検知は実測 0 件だったため `cve@mitre.org` を指定している。
- **Laravel** は CNA が GitHub / VulDB / MITRE に分散する。特に `security-advisories@github.com`
  は「Laravel 製の別パッケージ」を大量に採番しており、直近 120 日のキーワード一致 56 件のうち
  CPE が `laravel:laravel` のものは 1 件だけだった。そのため `sources` を空にし、
  **CPE 経路のみ**で判定する。
- `fail2ban`（全期間で 9 件・直近は全てノイズ）、`certbot`（CPE 付き CVE が 0 件）は
  費用対効果がないため対象に含めていない。

## 8. 注意点・落とし穴

- **ユーザーの動作確認前に `git push` しないこと**（`.claude/rules/gas-deploy-flow.md`）。本作業はトリガー実行型で Web アプリの `/exec` を持たないため、`clasp deploy` は不要で `clasp push` のみでよい。
- **初回実行は 30 日分が対象**のため、2026-08-06 時点の実測で 26 件がまとめて届く。2 回目以降は重複排除が効く。異常ではない。
- MySQL は Oracle の四半期パッチ（CPU: 1月/4月/7月/10月）で数十件がまとめて公開されるため、その直後の実行は件数が増える。
- 通知済み ID は**メール送信に成功した場合のみ**記録する。送信失敗時は次回実行で再通知される（意図的な設計）。
- スクリプトプロパティは 1 値あたり 9KB 上限のため、通知済み ID は 500 件で古いものから捨てる（`NOTIFIED_ID_LIMIT`）。
- `cve.metrics` には `ssvcV203` のように `cvssData` を持たない指標が混在する。`extractCvss()` はこれをガードしている。
- CVSS v2 は `baseSeverity` が `cvssData` の外側にある。両方見るようにしてある。
- 新しい製品を `TARGETS` に追加する際は、NVD でその製品の**直近**の CVE を開き「Source」欄
  （API では `sourceIdentifier`）を確認して `sources` に指定すること。ここが精度の要。
  **古い CVE を見てはいけない**（MITRE 採番が多く、主線として機能しない `sources` を設定してしまう）。

## 9. 未確認のままの事項

- 依頼元 Slack `#security_info` との連携可否（現状は連携しない前提で構築）。
- `clasp push` を実行できるアカウント（GAS プロジェクトの所有者）。
