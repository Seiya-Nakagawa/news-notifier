const CONFIG = {
  // スクリプトプロパティから取得するキー名
  PROPS: {
    GEMINI_API_KEY: 'GEMINI_API_KEY',
    GEMINI_MODEL_NAME: 'GEMINI_MODEL_NAME', // モデル名（例: gemini-3.1-flash-lite-preview）
    NOTIFICATION_EMAIL: 'NOTIFICATION_EMAIL',
    CVE_NOTIFICATION_EMAIL: 'CVE_NOTIFICATION_EMAIL', // 脆弱性通知専用の送信先（未設定時は送信元自身: Session.getActiveUser()）
    NVD_API_KEY: 'NVD_API_KEY',             // NVD APIキー（未設定でも動作するがレート制限が厳しくなる）
    NOTIFIED_CVE_IDS: 'NOTIFIED_CVE_IDS'    // 通知済みCVE-IDの記録（JSON配列。手動編集不要）
  },
  // ニュースRSSのURL
  NEWS_RSS_URLS: {
    TOP: 'https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja',
    TECHNOLOGY: 'https://news.google.com/news/rss/headlines/section/topic/TECHNOLOGY?hl=ja&gl=JP&ceid=JP:ja',
    JPCERT_CC: 'https://www.jpcert.or.jp/rss/jpcert.rdf',
    ALAS: 'https://alas.aws.amazon.com/alas.rss'
  },
  // 取得するニュースの件数
  NEWS_FETCH_COUNT: 10,
  // Gemini API 基本設定 (プレビューモデルを使用するため v1beta を指定)
  GEMINI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/models/',

  // 脆弱性(CVE)通知の設定
  CVE: {
    // 保守対象サーバのミドルウェア一覧。監視対象が増えたらここに行を追加して clasp push する。
    //
    // keyword          : NVDの検索語かつCPE(影響製品)の照合に使う製品名。英小文字で指定する。
    // sources          : その製品を採番するCNAのID。公開直後でCPE未割当のCVEを取りこぼさない
    //                    ための主経路。新しい製品を追加する際は、NVDでその製品の既存CVEを開き
    //                    詳細ページの「Source」欄（APIでは sourceIdentifier）を確認して指定する。
    //                    古いCVEはMITRE採番のことが多いため、必ず直近のCVEで確認すること。
    //                    ベンダー自身のCNAが存在しない製品は空配列にし、CPE経路のみに任せる。
    // descriptionMatch : CPE未割当時に説明文での一致も許すか。sources が正しく設定されていれば
    //                    通常は false でよい（実データではノイズしか増えなかった）。
    //                    'openssl' を true にすると「OpenSSLを利用している別製品」、'php' なら
    //                    「PHPで書かれた別製品」のCVEを大量に拾ってしまう。
    //                    採番元CNAが不明な製品を追加する場合のみ、保険として true にする。
    //
    // 対象は suzuki-ma / suzuki-ec（本番）および同STGの4台で稼働するミドルウェア。
    // OS（Amazon Linux 2023）のセキュリティ更新は NEWS_RSS_URLS.ALAS（AWS ALAS）で
    // 既に朝ニュース側に取り込んでいるため、ここには含めない。
    TARGETS: [
      { keyword: 'nginx', sources: ['f5sirt@f5.com'], descriptionMatch: false },
      { keyword: 'php', sources: ['security@php.net'], descriptionMatch: false },
      { keyword: 'mysql', sources: ['secalert_us@oracle.com'], descriptionMatch: false },
      { keyword: 'openssl', sources: ['openssl-security@openssl.org'], descriptionMatch: false },
      // OpenSSH はベンダーCNAを持たずMITRE採番。キーワード自体が固有でノイズが少ないため
      // MITRE を sources に指定してもCVSS閾値通過後の誤検知は実測で0件だった
      { keyword: 'openssh', sources: ['cve@mitre.org'], descriptionMatch: false },
      // Laravel はCNAが GitHub/VulDB/MITRE に分散しており、特に GitHub は
      // 「Laravel製の別パッケージ」を大量に採番する（実測: 120日で56件中55件がノイズ）。
      // sources を空にしてCPE(laravel:laravel)一致のみで判定する
      { keyword: 'laravel', sources: [], descriptionMatch: false }
    ],
    // 通知するCVSSベーススコアの下限。これ未満はノイズとして除外する
    MIN_CVSS_SCORE: 7.0,
    // 何日前までに公開されたCVEを対象にするか（NVDの上限は120日）。
    // 通知済みIDで重複排除しているため、期間を長くしても同じCVEが再通知されることはない。
    // 長めに取っているのは、公開直後のCVEはCVSS未評価かつCPE未割当（Awaiting Analysis）で
    // 数週間放置されることがあり、後日スコアやCPEが付いた時点で拾い直す必要があるため。
    LOOKBACK_DAYS: 30,
    // 1キーワードあたりの取得上限件数（NVD APIのresultsPerPageの上限は2000）。
    // ページングせず1リクエストで取り切れるよう上限値を指定する
    RESULTS_PER_PAGE: 2000,
    // NVDのレート制限対策の待機時間（APIキーあり: 50req/30s、なし: 5req/30s）
    REQUEST_INTERVAL_MS: 700,
    REQUEST_INTERVAL_MS_NO_KEY: 6500,
    // 通知済みCVE-IDの保持上限（スクリプトプロパティは1値あたり9KB上限のため）
    NOTIFIED_ID_LIMIT: 500,
    // 1件のCVEについてメールに載せる参考リンクの最大数
    MAX_REFERENCES: 3
  },
  // NVD (National Vulnerability Database) API
  NVD_API_URL: 'https://services.nvd.nist.gov/rest/json/cves/2.0'
};
