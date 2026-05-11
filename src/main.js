/**
 * エントリポイント: 毎朝のニュース通知を実行する
 */
function notifyMorningNews() {
  const props = PropertiesService.getScriptProperties();
  const geminiApiKey = props.getProperty(CONFIG.PROPS.GEMINI_API_KEY);
  const geminiModelName = props.getProperty(CONFIG.PROPS.GEMINI_MODEL_NAME);
  const slackWebhookUrl = props.getProperty(CONFIG.PROPS.SLACK_WEBHOOK_URL);
  const slackChannel = props.getProperty(CONFIG.PROPS.SLACK_CHANNEL);

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
    postToSlack(summary, slackWebhookUrl, slackChannel);

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
  const newsList = [];
  const seenLinks = new Set();

  for (const key in CONFIG.NEWS_RSS_URLS) {
    const url = CONFIG.NEWS_RSS_URLS[key];
    try {
      const response = UrlFetchApp.fetch(url);
      const xml = response.getContentText();
      const document = XmlService.parse(xml);
      const root = document.getRootElement();
      const channel = root.getChild('channel');
      
      let items = [];
      let isRdf = false;
      let defaultNs = null;

      // 通常のRSS(2.0)の場合は channel の下に item がある
      if (channel && channel.getChildren('item').length > 0) {
        items = channel.getChildren('item');
      } else {
        // RSS 1.0 (RDF) の場合は root の直下に item がある
        defaultNs = root.getNamespace();
        items = root.getChildren('item', defaultNs);
        isRdf = true;
      }

      const limit = Math.min(items.length, CONFIG.NEWS_FETCH_COUNT);
      for (let i = 0; i < limit; i++) {
        const item = items[i];
        let title, link, pubDate;

        if (!isRdf) {
          title = item.getChild('title') ? item.getChild('title').getText() : '';
          link = item.getChild('link') ? item.getChild('link').getText() : '';
          pubDate = item.getChild('pubDate') ? item.getChild('pubDate').getText() : '';
        } else {
          title = item.getChild('title', defaultNs) ? item.getChild('title', defaultNs).getText() : '';
          link = item.getChild('link', defaultNs) ? item.getChild('link', defaultNs).getText() : '';
          const dcNs = XmlService.getNamespace('dc', 'http://purl.org/dc/elements/1.1/');
          pubDate = item.getChild('date', dcNs) ? item.getChild('date', dcNs).getText() : '';
        }
        
        if (seenLinks.has(link)) continue;
        seenLinks.add(link);

        newsList.push(`タイトル: ${title}\nリンク: ${link}\n公開日時: ${pubDate}`);
      }
    } catch (e) {
      console.warn(`Failed to fetch news from ${key}: ${e.toString()}`);
    }
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
- 箇条書きで簡潔に書いてほしい。

【指示】
1. 以下の5つのカテゴリについて、関連するトピックを抽出して深く要約してください。
   - 政治
   - 経済
   - IT・AI
   - セキュリティ (AWS、Linux、EC-CUBE等、システム開発・運用に関連する脆弱性情報を優先し、CVE番号がある場合は併記すること)
   - その他重要トピック

【ニュースリスト】
${newsList.join('\n---\n')}

【出力フォーマット】

■ 今日の要約
(ここにカテゴリごとの要約を記載。各カテゴリ名は太字にし、箇条書きで簡潔に書いてください)
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
 * @param {string} channel 投稿先のチャンネル名（任意）
 */
function postToSlack(text, webhookUrl, channel) {
  const payload = {
    text: text
  };

  if (channel) {
    payload.channel = channel;
  }

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload)
  };

  UrlFetchApp.fetch(webhookUrl, options);
}
