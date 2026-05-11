const CONFIG = {
  // スクリプトプロパティから取得するキー名
  PROPS: {
    GEMINI_API_KEY: 'GEMINI_API_KEY',
    GEMINI_MODEL_NAME: 'GEMINI_MODEL_NAME', // モデル名（例: gemini-3.1-flash-lite-preview）
    SLACK_WEBHOOK_URL: 'SLACK_WEBHOOK_URL',
    SLACK_CHANNEL: 'SLACK_CHANNEL'
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
  GEMINI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/models/'
};
