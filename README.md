# News Notifier (GAS版)

毎日のニュースをGoogle News RSSから取得し、Claude APIで要約して、Slackへ自動通知するGoogle Apps Script (GAS) ツールです。

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
2. 「スクリプト プロパティを追加」をクリックし、以下の2つを設定する。
   - プロパティ: `CLAUDE_API_KEY`, 値: あなたのClaude APIキー
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
