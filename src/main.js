/**
 * エントリポイント: 毎朝のニュース通知を実行する
 */
function notifyMorningNews() {
  const props = PropertiesService.getScriptProperties();
  const claudeApiKey = props.getProperty(CONFIG.PROPS.CLAUDE_API_KEY);
  const slackWebhookUrl = props.getProperty(CONFIG.PROPS.SLACK_WEBHOOK_URL);

  if (!claudeApiKey || !slackWebhookUrl) {
    console.error('Claude API Key or Slack Webhook URL is not set in Script Properties.');
    return;
  }

  try {
    // 1. ニュース取得
    const newsList = fetchNews();
    if (newsList.length === 0) {
      console.log('No news found.');
      return;
    }

    // 2. Claudeで要約
    const summary = summarizeNews(newsList, claudeApiKey);

    // 3. Slackに通知
    postToSlack(summary, slackWebhookUrl);
    
    console.log('Successfully notified news to Slack.');
  } catch (error) {
    console.error('Error occurred:', error.toString());
  }
}

/**
 * Google News RSSからニュースを取得する
 * @returns {Array<string>} ニュース情報の文字列配列
 */
function fetchNews() {
  const response = UrlFetchApp.fetch(CONFIG.NEWS_RSS_URL);
  const xml = response.getContentText();
  const document = XmlService.parse(xml);
  const root = document.getRootElement();
  const channel = root.getChild('channel');
  const items = channel.getChildren('item');
  
  const newsList = [];
  const limit = Math.min(items.length, CONFIG.NEWS_FETCH_COUNT);
  for (let i = 0; i < limit; i++) {
    const item = items[i];
    const title = item.getChild('title').getText();
    const link = item.getChild('link').getText();
    newsList.push(`- [${title}](${link})`);
  }
  return newsList;
}

/**
 * Claude APIを呼び出してニュースを要約する
 * @param {Array<string>} newsList ニュース情報のリスト
 * @param {string} apiKey Claude APIキー
 * @returns {string} 要約結果テキスト
 */
function summarizeNews(newsList, apiKey) {
  const prompt = `以下の最新ニュースのリストを読み、今日の主要なトピックとして簡潔に要約してください。
ビジネスパーソン向けに、分かりやすくポジティブなトーンでまとめてください。

【ニュース一覧】
${newsList.join('\n')}

出力形式:
* 冒頭の挨拶 (例: おはようございます！本日の主要ニュースです。)
* トピックの要約 (箇条書きで分かりやすく)
* 各ニュースのタイトルとリンク (参考情報として末尾に付与)
`;

  const payload = {
    model: CONFIG.CLAUDE_MODEL,
    max_tokens: 1024,
    messages: [
      { role: 'user', content: prompt }
    ]
  };

  const options = {
    method: 'post',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    payload: JSON.stringify(payload)
  };

  const response = UrlFetchApp.fetch(CONFIG.CLAUDE_API_URL, options);
  const json = JSON.parse(response.getContentText());
  return json.content[0].text;
}

/**
 * SlackのWebhookにテキストを投稿する
 * @param {string} text 投稿するテキスト
 * @param {string} webhookUrl Slack Incoming Webhook URL
 */
function postToSlack(text, webhookUrl) {
  const payload = {
    text: text
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload)
  };

  UrlFetchApp.fetch(webhookUrl, options);
}
