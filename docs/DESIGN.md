# 設計書 - News Notifier

## 1. システム概要
Google NewsのRSSフィードから最新ニュースを取得し、Gemini APIを使用して要約を作成した後、Slackの特定のチャンネルに通知するシステムです。

## 2. 構成
- **実行環境:** Google Apps Script (GAS)
- **ニュース取得:** Google News RSS (トップニュース、テクノロジー), JPCERT/CC RSS, ALAS RSS
- **AIエンジン:** Gemini API (Google AI SDKを使用せず、REST APIをUrlFetchAppで呼び出し)
- **通知先:** Slack (Incoming Webhook)

## 3. 処理フロー
1. **ニュース取得 (`fetchNews`):**
   - `src/config.js` に定義された複数のRSS URLからデータを取得。(通常のRSS 2.0に加え、RDF/RSS 1.0形式もサポート)
   - 重複するニュース（同じURL）を除外。
   - 各カテゴリから最大 `NEWS_FETCH_COUNT` 件のアイテムを抽出。
2. **要約作成 (`summarizeNews`):**
   - 取得したニュースリストをGemini APIに送信。
   - カテゴリ別（政治、経済、IT・AI、セキュリティ、その他）に箇条書きで要約するようにプロンプトを指定。
3. **Slack通知 (`postToSlack`):**
   - 生成された要約テキストをSlackのIncoming Webhook URLに送信。

## 4. 設定
`src/config.js` およびスクリプトプロパティで管理します。

### スクリプトプロパティ
- `GEMINI_API_KEY`: Gemini APIを利用するためのキー
- `GEMINI_MODEL_NAME`: 使用するモデル名 (例: `gemini-1.5-flash` など)
- `SLACK_WEBHOOK_URL`: Slack通知用のWebhook URL
