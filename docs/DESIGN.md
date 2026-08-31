# 設計書 - News Notifier

## 1. システム概要

以下の2つを毎朝まとめて実行し、それぞれ別のメールで通知するシステムです。

1. **ニュース通知:** 各種RSSフィードから最新ニュースを取得し、Gemini APIで要約して通知する。
2. **脆弱性通知:** 保守対象サーバのミドルウェアに関連する新規CVEをNVDから取得し、通知する。

## 2. 構成

- **実行環境:** Google Apps Script (GAS)
- **ニュース取得:** Google News RSS (トップニュース、テクノロジー), JPCERT/CC RSS, ALAS RSS
- **脆弱性取得:** NVD (National Vulnerability Database) API 2.0
- **AIエンジン:** Gemini API (Google AI SDKを使用せず、REST APIをUrlFetchAppで呼び出し)
- **通知先:** メール (Gmail)

## 3. 処理フロー

エントリポイントは `notifyMorningNews()` で、時間主導型トリガーから毎朝実行されます。
ニュース通知と脆弱性通知はそれぞれ独立した `try/catch` で実行し、片方が失敗しても
もう片方は通知されるようにしています。

### 3.1 ニュース通知

1. **ニュース取得 (`fetchNews`):**
   - `src/config.js` に定義された複数のRSS URLから `UrlFetchApp.fetchAll` で並列取得。(通常のRSS 2.0に加え、RDF/RSS 1.0形式もサポート)
   - 重複するニュース（同じURL）を除外。
   - 各カテゴリから最大 `NEWS_FETCH_COUNT` 件のアイテムを抽出。
2. **要約作成 (`summarizeNews`):**
   - 取得したニュースリストをGemini APIに送信。
   - カテゴリ別（政治、経済、IT・AI、セキュリティ、その他）に箇条書きで要約するようにプロンプトを指定。
3. **メール通知 (`sendEmailNotification`):**
   - 生成された要約テキストをメールで送信。

### 3.2 脆弱性通知

1. **CVE取得 (`fetchCveList`):**
   - `CONFIG.CVE.TARGETS` の監視キーワードごとにNVD APIを検索する。
   - 対象は直近 `LOOKBACK_DAYS` 日間に公開されたCVE。
   - 該当判定 (`matchesTarget`) とCVSS閾値 (`MIN_CVSS_SCORE`) で絞り込む。
   - 複数のキーワードに一致したCVEは1件にまとめ、該当ミドルウェアを集約する。
2. **重複排除:**
   - 通知済みCVE-IDをスクリプトプロパティ `NOTIFIED_CVE_IDS` にJSON配列で保持し、未通知のものだけを対象にする。
   - メール送信に成功した場合のみ記録するため、送信失敗時は次回実行で再通知される。
3. **日本語要約 (`translateCveDescriptions`):**
   - NVDの説明文は英語のみのため、Gemini APIで日本語に要約する。
   - 失敗しても英文のまま通知を継続する（要約は付加価値であり、通知自体を止めない）。
4. **メール通知 (`sendCveEmailNotification`):**
   - CVSSスコアの降順で、CVE-ID・スコア・該当ミドルウェア・概要・NVDリンク・参考リンクを送信する。
   - CVE-IDやリンクはNVDのレスポンスから直接組み立て、AIの生成結果に依存させない。

## 4. CVEの該当判定ロジック

NVDのキーワード検索は**説明文**を対象とするため、そのままでは「その製品に言及して
いるだけ」の無関係なCVEを大量に拾ってしまいます（例: `openssl` の検索で
「OpenSSLを利用しているWordPressプラグイン」の脆弱性が一致する）。

そのため `matchesTarget()` は以下の3段階で判定します。

1. **CPE（影響製品）一致:** `cve.configurations` のCPEからベンダー名・製品名を取り出して照合する。最も確実だが、NVDの解析が完了したCVEにしか付与されない。
2. **採番元CNA一致:** `cve.sourceIdentifier` が `TARGETS[].sources` に含まれるか判定する。製品ベンダー自身がCNAとして採番したCVEを拾う経路。公開直後のCVEは `Awaiting Analysis` 状態でCPEが未割当のため、**取りこぼしを防ぐ主線はこの経路**となる。
3. **説明文一致（任意）:** `TARGETS[].descriptionMatch` が `true` かつCPE未割当の場合のみ、説明文での一致を許す。

`sources` が正しく設定されていれば 3 は通常不要です。採番元CNAが不明な製品を追加する
場合の保険として用意しています。

なお `sources` は**直近のCVE**で確認する必要があります。古いCVEは製品ベンダーではなく
MITRE (`cve@mitre.org`) が採番していることが多く、古い実績だけを見て指定すると
主線として機能しません。ベンダー自身のCNAを持たない製品（Laravel 等）は
`sources` を空配列にし、CPE経路のみに委ねます。

`LOOKBACK_DAYS` を長めに取っているのは、公開直後のCVEがCVSS未評価・CPE未割当のまま
数週間放置されることがあり、後日スコアやCPEが付いた時点で拾い直すためです。重複排除が
効くため、期間を延ばしても再通知は発生しません。

### 監視対象と採番元CNA

保守対象4台（`suzuki-ma` / `suzuki-ec` および同STG）で稼働するミドルウェアを対象と
しています。採番元CNAはいずれもNVDの実データで確認したものです。

| キーワード | 採番元CNA (`sources`) | 備考 |
|---|---|---|
| `nginx` | `f5sirt@f5.com` | 見落とし事例（CVE-2026-42533 等）はこの経路で検出 |
| `php` | `security@php.net` | PHP処理系本体のCVEは全てこのCNA |
| `mysql` | `secalert_us@oracle.com` | Oracle四半期パッチ(CPU)でまとまって公開される |
| `openssl` | `openssl-security@openssl.org` | |
| `openssh` | `cve@mitre.org` | ベンダーCNAを持たない。キーワードが固有でノイズは実測0件 |
| `laravel` | （なし） | CNAがGitHub/VulDB/MITREに分散し、GitHubは「Laravel製の別パッケージ」を大量採番するためCPE経路のみで判定 |

OS（Amazon Linux 2023）のセキュリティ更新は `CONFIG.NEWS_RSS_URLS.ALAS`（AWS ALAS）
として朝ニュース側に取り込み済みのため、CVE監視の対象には含めていません。

## 5. 設定

`src/config.js` およびスクリプトプロパティで管理します。

### スクリプトプロパティ

- `GEMINI_API_KEY`: Gemini APIを利用するためのキー
- `GEMINI_MODEL_NAME`: 使用するモデル名 (例: `gemini-1.5-flash` など)
- `NOTIFICATION_EMAIL`: 朝ニュース要約の送信先メールアドレス（未設定時は実行ユーザーのアドレス）
- `CVE_NOTIFICATION_EMAIL`: 脆弱性通知の送信先メールアドレス（未設定時は実行ユーザーのアドレス）
- `NVD_API_KEY`: NVD APIキー（未設定でも動作するが、レート制限が 5リクエスト/30秒 と厳しくなる）
- `NOTIFIED_CVE_IDS`: 通知済みCVE-IDの記録。スクリプトが自動で更新するため手動設定は不要

### 監視対象ミドルウェアの追加

`src/config.js` の `CONFIG.CVE.TARGETS` に行を追加し、`clasp push` します。

| フィールド | 内容 |
|---|---|
| `keyword` | NVDの検索語かつCPE照合に使う製品名（英小文字） |
| `sources` | その製品を採番するCNAのID。NVDで該当製品の**直近**のCVEを開き「Source」欄を確認して指定する。該当がなければ空配列 |
| `descriptionMatch` | CPE未割当時に説明文一致を許すか。通常は `false` |
