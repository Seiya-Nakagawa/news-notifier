/**
 * エントリポイント: 毎朝のニュース通知を実行する
 */
function notifyMorningNews() {
  const props = PropertiesService.getScriptProperties();
  const geminiApiKey = props.getProperty(CONFIG.PROPS.GEMINI_API_KEY);
  const geminiModelName = props.getProperty(CONFIG.PROPS.GEMINI_MODEL_NAME);
  const slackWebhookUrl = props.getProperty(CONFIG.PROPS.SLACK_WEBHOOK_URL);

  if (!geminiApiKey || !geminiModelName || !slackWebhookUrl) {
    console.error('Required Script Properties (GEMINI_API_KEY, GEMINI_MODEL_NAME, or SLACK_WEBHOOK_URL) are not set.');
    return;
  }

  try {
    // 1. ニュース取得
    const newsList = fetchNews();
    if (newsList.length === 0) {
      console.log('No news found.');
      return;
    }

    // 2. Geminiで要約
    const summary = summarizeNews(newsList, geminiApiKey, geminiModelName);

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
  const limit = Math.min(items.length, 10);
  for (let i = 0; i < limit; i++) {
    const item = items[i];
    const title = item.getChild('title').getText();
    const link = item.getChild('link').getText();
    const pubDate = item.getChild('pubDate') ? item.getChild('pubDate').getText() : '';
    newsList.push(`タイトル: ${title}\nリンク: ${link}\n公開日時: ${pubDate}`);
  }
  return newsList;
}

/**
 * Gemini APIを呼び出してニュースを要約する
 * @param {Array<string>} newsList ニュース情報のリスト
 * @param {string} apiKey Gemini APIキー
 * @param {string} modelName Gemini モデル名
 * @returns {string} 要約結果テキスト
 */
function summarizeNews(newsList, apiKey, modelName) {
  const prompt = `あなたは優秀なニュースキュレーターです。提供されたニュースリストを読み、以下の指示に従って「今日の重要ニュース」を作成してください。

【重要：禁止事項】
- 参考リンクやURLの出力は一切不要です。
- リスト形式の羅列ではなく、背景や影響を読み解いた文章を作成してください。

【指示】
1. 以下の4つのカテゴリについて、関連するトピックを抽出して深く要約してください。
   - 政治
   - 経済
   - IT・AI
   - その他重要トピック
2. ビジネスパーソンが知っておくべき「なぜこれが重要か」という視点を必ず含めてください。
3. トーンは「前向きで知的」なものにしてください。

【ニュースリスト】
${newsList.join('\n---\n')}

【出力フォーマット】
おはようございます！本日の主要ニュースをお届けします。

(ここに導入文：世界情勢や国内の概況を1-2文で記載)

■ 今日の要約
(ここにカテゴリごとの要約を記載。各カテゴリ名は太字にし、箇条書きで分かりやすく説明してください)
`;

  const payload = {
    contents: [{
      parts: [{
        text: prompt
      }]
    }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 2048
    }
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload)
  };

  const url = `${CONFIG.GEMINI_BASE_URL}${modelName}:generateContent?key=${apiKey}`;
  const response = UrlFetchApp.fetch(url, options);
  const json = JSON.parse(response.getContentText());
  
  if (json.candidates && json.candidates[0] && json.candidates[0].content) {
    return json.candidates[0].content.parts[0].text;
  } else {
    throw new Error('Unexpected response from Gemini API: ' + response.getContentText());
  }
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
