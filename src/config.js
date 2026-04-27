const CONFIG = {
  // スクリプトプロパティから取得するキー名
  PROPS: {
    CLAUDE_API_KEY: 'CLAUDE_API_KEY',
    SLACK_WEBHOOK_URL: 'SLACK_WEBHOOK_URL'
  },
  // ニュースRSSのURL (Google News 日本語版 トップニュース)
  NEWS_RSS_URL: 'https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja',
  // 取得するニュースの件数
  NEWS_FETCH_COUNT: 5,
  // Claude API設定
  CLAUDE_API_URL: 'https://api.anthropic.com/v1/messages',
  CLAUDE_MODEL: 'claude-3-5-sonnet-20241022'
};
