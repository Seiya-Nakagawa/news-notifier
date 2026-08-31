# News Notifier (GAS版)

毎日のニュースをGoogle News RSS等から取得し、Gemini APIで要約して、メールへ自動通知するGoogle Apps Script (GAS) ツールです。
あわせて、保守対象サーバのミドルウェアに関連する脆弱性（CVE）をNVDから収集し、別メールで通知します。

## 特徴
- **マルチソース取得:** Google Newsの「トップニュース」と「テクノロジー」に加え、JPCERT/CCおよびAWS ALASのセキュリティ情報も収集し、IT・AI・セキュリティ関連のニュースを逃さずキャッチします。
- **Geminiによる高度な要約:** 取得したニュースをカテゴリ別（政治、経済、IT・AI、セキュリティ、その他）に整理し、簡潔な箇条書きで要約します。
- **脆弱性の自動監視:** 保守対象ミドルウェアに関する新規CVEをNVDから取得し、CVSSスコアの高い順に通知します。一度通知したCVEは再通知しません。英語の説明文はGeminiが日本語に要約します。
- **誤検知の抑制:** 影響製品(CPE)と採番元CNAで該当判定を行い、「その製品に言及しているだけ」の無関係なCVEを除外します（詳細は[設計書](./docs/DESIGN.md)を参照）。
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
2. 「スクリプト プロパティを追加」をクリックし、以下を設定する。
   - プロパティ: `GEMINI_API_KEY`, 値: あなたのGemini APIキー
   - プロパティ: `GEMINI_MODEL_NAME`, 値: 使用するモデル名 (例: `gemini-1.5-flash`)
   - プロパティ: `NOTIFICATION_EMAIL`, 値: 朝ニュース要約を受け取りたいメールアドレス（未設定の場合、実行ユーザーのアドレス宛に送信されます）
   - プロパティ: `CVE_NOTIFICATION_EMAIL`, 値: 脆弱性通知を受け取りたいメールアドレス（未設定の場合、実行ユーザーのアドレス宛に送信されます）
   - プロパティ: `NVD_API_KEY`, 値: NVDのAPIキー（[申請フォーム](https://nvd.nist.gov/developers/request-an-api-key)から取得）
3. 保存します。

`NVD_API_KEY` は未設定でも動作しますが、レート制限が 5リクエスト/30秒 と厳しくなり、
リクエスト間の待機時間が延びます（キーがある場合は 50リクエスト/30秒）。

### 5. 監視対象ミドルウェアの設定
`src/config.js` の `CONFIG.CVE.TARGETS` に、保守契約先で稼働しているミドルウェアを登録します。

```js
{ keyword: 'nginx', sources: ['f5sirt@f5.com'], descriptionMatch: false }
```

- `keyword`: NVDの検索語かつCPE照合に使う製品名（英小文字）。
- `sources`: その製品を採番するCNAのID。NVDで該当製品の**直近**のCVEを開き「Source」欄で確認できます。**公開直後のCVEを取りこぼさない主経路のため、原則必ず設定してください**（ベンダー自身のCNAが存在しない製品のみ空配列にします）。
- `descriptionMatch`: CPE未割当時に説明文一致を許すか。通常は `false`。採番元CNAが不明な製品の保険としてのみ `true` にします。

初期状態では nginx / PHP / MySQL / OpenSSL / OpenSSH / Laravel を対象にしています。
OS（Amazon Linux 2023）は AWS ALAS のRSSを朝ニュース側で取り込んでいるため対象外です。

編集後は `npm run push` で反映します。CVSS閾値や対象期間は `CONFIG.CVE.MIN_CVSS_SCORE`、`CONFIG.CVE.LOOKBACK_DAYS` で調整できます。

### 6. 動作確認とトリガー設定
1. GASエディタ上で `src/main.js`（GAS上では `main.gs`）を開く。
2. ツールバーの関数プルダウンから `notifyMorningNews` を選択し、「実行」をクリックします。
3. 初回実行時は承認フローが表示されるため、許可します。
4. ニュース要約と脆弱性情報の2通のメールが届けば成功です（対象期間内に新規CVEがない場合、脆弱性メールは送信されません）。
5. エディタ左側の時計アイコン（トリガー）を開き、「トリガーを追加」から以下の設定を行います。
   - 実行する関数: `notifyMorningNews`
   - イベントのソース: `時間主導型`
   - トリガーのタイプ: `日付ベースのタイマー`
   - 時刻を選択: `午前7時～8時` (お好みの時間帯)

## 実行できる関数

| 関数名 | 用途 |
|---|---|
| `notifyMorningNews` | エントリポイント。ニュース通知と脆弱性通知をまとめて実行（トリガー登録対象） |
| `notifyCveAlerts` | 脆弱性通知のみを実行 |
| `testCveFetch` | メール送信も通知済み記録も行わず、CVE取得結果だけをログに出力（設定の確認用） |
| `testProperties` | スクリプトプロパティの設定状況を確認 |

## 設計ドキュメント
詳細な設計については [docs/DESIGN.md](./docs/DESIGN.md) を参照してください。

