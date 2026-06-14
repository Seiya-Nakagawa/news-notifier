/**
 * エントリポイント: 毎朝のニュース通知を実行する
 */
function notifyMorningNews() {
  const props = PropertiesService.getScriptProperties();
  const geminiApiKey = props.getProperty(CONFIG.PROPS.GEMINI_API_KEY);
  const geminiModelName = props.getProperty(CONFIG.PROPS.GEMINI_MODEL_NAME);
  let emailAddress = props.getProperty(CONFIG.PROPS.NOTIFICATION_EMAIL);

  if (!geminiApiKey || !geminiModelName) {
    console.error('Required Script Properties (GEMINI_API_KEY or GEMINI_MODEL_NAME) are not set.');
    return;
  }

  if (!emailAddress) {
    emailAddress = Session.getActiveUser().getEmail();
    console.log(`NOTIFICATION_EMAIL property is not set. Defaulting to active user: ${emailAddress}`);
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

    // 3. メールに通知
    sendEmailNotification(summary, emailAddress);

    console.log(`Successfully notified news to email: ${emailAddress}`);
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
        defaultNs = root.getNamespace('');
        if (!defaultNs || defaultNs.getURI() === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#') {
          defaultNs = XmlService.getNamespace('http://purl.org/rss/1.0/');
        }
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

【指示】
1. 提供されたニュースリストから情報を抽出し、以下の5つのカテゴリに分類・要約してください：
   - 政治
   - 経済
   - IT・AI
   - セキュリティ (AWS、Linux、EC-CUBE等、システム開発・運用に関連する脆弱性情報を優先し、CVE番号がある場合は併記すること)
   - その他重要トピック
2. 各カテゴリの要約は、重要なトピックを箇条書きで簡潔に（1トピックあたり1〜2行程度で）記述してください。
3. 参考リンクやURLは出力しないでください。

【出力フォーマット】
■ 今日の要約

**政治**
* (トピックの要約)

**経済**
* (トピックの要約)

**IT・AI**
* (トピックの要約)

**セキュリティ**
* (トピックの要約)

**その他重要トピック**
* (トピックの要約)

【ニュースリスト】
${newsList.join('\n---\n')}
`;

  const payload = {
    contents: [{
      parts: [{
        text: prompt
      }]
    }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 8192
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

  if (json.candidates && json.candidates[0]) {
    const candidate = json.candidates[0];
    console.log('Gemini finishReason:', candidate.finishReason);
    if (candidate.content && candidate.content.parts && candidate.content.parts[0]) {
      return candidate.content.parts[0].text;
    }
  }
  throw new Error('Unexpected response from Gemini API: ' + response.getContentText());
}

/**
 * 指定したメールアドレスにニュースの要約を送信する
 * @param {string} text 送信するテキスト（要約）
 * @param {string} emailAddress 送信先メールアドレス
 */
function sendEmailNotification(text, emailAddress) {
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy/MM/dd');
  const subject = `【重要】今日のニュース要約 (${today})`;

  GmailApp.sendEmail(emailAddress, subject, text);
}

/**
 * デバッグ用: スクリプトプロパティの設定状態を確認する
 */
function testProperties() {
  const props = PropertiesService.getScriptProperties().getProperties();
  console.log("設定されているプロパティ一覧:");
  for (const key in props) {
    // セキュリティのため、値そのものではなくキー名と文字数を出力
    console.log("- " + key + ": " + (props[key] ? "設定あり (文字数: " + props[key].length + ")" : "空"));
  }
}
