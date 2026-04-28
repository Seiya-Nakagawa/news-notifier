## 概要

プロジェクトの初期構造の構築と、メイン機能であるニュース通知ロジックの実装を行いました。

## 変更内容

- **README.md**: プロジェクト概要、セットアップ・デプロイ手順を追加。
- **package.json**: 開発用依存関係（clasp, types）とスクリプトを定義。
- **.clasp.json**: GAS連携用の設定ファイルを追加。
- **src/appsscript.json**: タイムゾーンやランタイムなどのGAS設定を定義。
- **src/config.js**: APIエンドポイント、モデル名、スクリプトプロパティ名などの定数を集約。
- **src/main.js**:
  - `notifyMorningNews`: エントリポイント
  - `fetchNews`: Google News RSSからのニュース取得
  - `summarizeNews`: Claude APIによる要約生成
  - `postToSlack`: Slack Incoming Webhookへの投稿

## 関連Issue

Close #1
