# News Notifier (GAS版)

毎日のニュースをGoogle News RSSから取得し、Gemini APIで要約して、Slackへ自動通知するGoogle Apps Script (GAS) ツールです。

## 特徴
- **マルチソース取得:** Google Newsの「トップニュース」と「テクノロジー」の両方から情報を収集し、IT・AI関連のニュースを逃さずキャッチします。
- **Geminiによる高度な要約:** 取得したニュースをカテゴリ別（政治、経済、IT・AI、その他）に整理し、簡潔な箇条書きで要約します。
- **GASで完結:** サーバーレスで動作し、メンテナンスコストがほぼかかりません。

## セットアップ手順

### 1. 依存関係のインストール
ローカルで型定義やclaspを利用するために、npmモジュールをインストールします。
```bash
cd /home/seiya/git/news-notifier
npm install
```

### 2. GASプロジェクトの作成とリンク
claspを使用してGASプロジェクトを新規作成するか、既存のプロジェクトにリンクします。

**新規作成の場合:**
```bash
npm run create
```
（または `clasp create --type standalone --rootDir src`）
作成されると自動的に `.clasp.json` の `scriptId` が更新されます。

### 3. コードのデプロイ (プッシュ)
```bash
npm run push
```
（または `clasp push`）

### 4. GASのスクリプトプロパティ設定
デプロイ後、GASのエディタ画面 (ブラウザ) を開きます。
1. 左側の歯車アイコン（プロジェクトの設定）を開く。
2. 「スクリプト プロパティを追加」をクリックし、以下の3つを設定する。
   - プロパティ: `GEMINI_API_KEY`, 値: あなたのGemini APIキー
   - プロパティ: `GEMINI_MODEL_NAME`, 値: 使用するモデル名 (例: `gemini-1.5-flash`)
   - プロパティ: `SLACK_WEBHOOK_URL`, 値: SlackのIncoming Webhook URL
3. 保存します。

### 5. 動作確認とトリガー設定
1. GASエディタ上で `src/main.js`（GAS上では `main.gs`）を開く。
2. ツールバーの関数プルダウンから `notifyMorningNews` を選択し、「実行」をクリックします。
3. 初回実行時は承認フローが表示されるため、許可します。
4. Slackに通知が届けば成功です。
5. エディタ左側の時計アイコン（トリガー）を開き、「トリガーを追加」から以下の設定を行います。
   - 実行する関数: `notifyMorningNews`
   - イベントのソース: `時間主導型`
   - トリガーのタイプ: `日付ベースのタイマー`
   - 時刻を選択: `午前7時～8時` (お好みの時間帯)

## 設計ドキュメント
詳細な設計については [docs/DESIGN.md](./docs/DESIGN.md) を参照してください。

