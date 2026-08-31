/**
 * エントリポイント: 毎朝のニュース通知と脆弱性通知を実行する
 */
function notifyMorningNews() {
  const props = PropertiesService.getScriptProperties();
  const geminiApiKey = props.getProperty(CONFIG.PROPS.GEMINI_API_KEY);
  const geminiModelName = props.getProperty(CONFIG.PROPS.GEMINI_MODEL_NAME);
  let newsEmailAddress = props.getProperty(CONFIG.PROPS.NOTIFICATION_EMAIL);
  let cveEmailAddress = props.getProperty(CONFIG.PROPS.CVE_NOTIFICATION_EMAIL);

  if (!geminiApiKey || !geminiModelName) {
    console.error('Required Script Properties (GEMINI_API_KEY or GEMINI_MODEL_NAME) are not set.');
    return;
  }

  const defaultUserEmail = Session.getActiveUser().getEmail();

  if (!newsEmailAddress) {
    newsEmailAddress = defaultUserEmail;
    console.log(`NOTIFICATION_EMAIL property is not set. Defaulting to active user: ${newsEmailAddress}`);
  }

  if (!cveEmailAddress) {
    cveEmailAddress = defaultUserEmail;
    console.log(`CVE_NOTIFICATION_EMAIL property is not set. Defaulting to active user: ${cveEmailAddress}`);
  }

  try {
    runNewsNotification(geminiApiKey, geminiModelName, newsEmailAddress);
  } catch (error) {
    console.error('Error occurred in news notification:', error.toString());
  }

  // 脆弱性通知はニュース通知と独立して実行し、片方の失敗がもう片方を巻き込まないようにする
  try {
    runCveNotification(geminiApiKey, geminiModelName, cveEmailAddress);
  } catch (error) {
    console.error('Error occurred in CVE notification:', error.toString());
  }
}

/**
 * ニュースを取得・要約してメール通知する
 * @param {string} geminiApiKey Gemini APIキー
 * @param {string} geminiModelName Gemini モデル名
 * @param {string} emailAddress 送信先メールアドレス
 */
function runNewsNotification(geminiApiKey, geminiModelName, emailAddress) {
  // 1. ニュース取得
  const fetchStart = Date.now();
  const newsList = fetchNews();
  console.log(`fetchNews: ${newsList.length} items in ${Date.now() - fetchStart}ms`);
  if (newsList.length === 0) {
    console.log('No news found.');
    return;
  }

  // 2. Geminiで要約
  const summarizeStart = Date.now();
  const summary = summarizeNews(newsList, geminiApiKey, geminiModelName);
  console.log(`summarizeNews: done in ${Date.now() - summarizeStart}ms`);

  // 3. メールに通知
  sendEmailNotification(summary, emailAddress);

  console.log(`Successfully notified news to email: ${emailAddress}`);
}

/**
 * Google News RSSからニュースを取得する
 * @returns {Array<string>} ニュース情報の文字列配列
 */
function fetchNews() {
  const newsList = [];
  const seenLinks = new Set();

  const keys = Object.keys(CONFIG.NEWS_RSS_URLS);
  const requests = keys.map((key) => ({
    url: CONFIG.NEWS_RSS_URLS[key],
    muteHttpExceptions: true
  }));
  // 各フィードを並列取得し、逐次取得による待ち時間の積み上がりを防ぐ
  const responses = UrlFetchApp.fetchAll(requests);

  keys.forEach((key, index) => {
    const response = responses[index];
    try {
      if (response.getResponseCode() !== 200) {
        console.warn(`Failed to fetch news from ${key}: HTTP ${response.getResponseCode()}`);
        return;
      }
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
  });

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

  return callGemini(prompt, apiKey, modelName, {
    temperature: 0.7,
    maxOutputTokens: 2048,
    // thinking対応モデルでの内部推論による遅延を避け、実行時間超過(6分上限)を防ぐ
    thinkingConfig: {
      thinkingBudget: 0
    }
  });
}

/**
 * Gemini APIを呼び出してテキストを生成する
 * @param {string} prompt プロンプト
 * @param {string} apiKey Gemini APIキー
 * @param {string} modelName Gemini モデル名
 * @param {Object} generationConfig 生成パラメータ
 * @returns {string} 生成されたテキスト
 */
function callGemini(prompt, apiKey, modelName, generationConfig) {
  const payload = {
    contents: [{
      parts: [{
        text: prompt
      }]
    }],
    generationConfig: generationConfig
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const url = `${CONFIG.GEMINI_BASE_URL}${modelName}:generateContent?key=${apiKey}`;

  // 503(過負荷)/429(レート制限)は一時的なことが多いため、指数バックオフでリトライする
  // RSS取得の並列化で実行時間に余裕ができたため、粘り強く待てるよう回数・上限を拡大
  const maxRetries = 5;
  const maxWaitMs = 30000;
  let response;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();
    if (code === 200) break;

    const retryable = code === 503 || code === 429;
    if (retryable && attempt < maxRetries) {
      const waitMs = Math.min(2000 * Math.pow(2, attempt), maxWaitMs); // 2s, 4s, 8s, 16s, 30s
      console.warn(`Gemini API returned ${code} (attempt ${attempt + 1}/${maxRetries + 1}). Retrying in ${waitMs}ms...`);
      Utilities.sleep(waitMs);
      continue;
    }
    throw new Error(`Gemini API returned ${code}: ${response.getContentText()}`);
  }

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

// ============================================================
// 脆弱性(CVE)通知
// ============================================================

/**
 * 手動実行用のエントリポイント: 脆弱性通知のみを実行する
 */
function notifyCveAlerts() {
  const props = PropertiesService.getScriptProperties();
  const geminiApiKey = props.getProperty(CONFIG.PROPS.GEMINI_API_KEY);
  const geminiModelName = props.getProperty(CONFIG.PROPS.GEMINI_MODEL_NAME);
  let emailAddress = props.getProperty(CONFIG.PROPS.CVE_NOTIFICATION_EMAIL);

  if (!emailAddress) {
    emailAddress = Session.getActiveUser().getEmail();
  }

  runCveNotification(geminiApiKey, geminiModelName, emailAddress);
}

/**
 * 保守対象ミドルウェアに関する新規CVEを取得し、未通知のものだけをメールで通知する
 * @param {string} geminiApiKey Gemini APIキー（未設定なら英文のまま通知する）
 * @param {string} geminiModelName Gemini モデル名
 * @param {string} emailAddress 送信先メールアドレス
 */
function runCveNotification(geminiApiKey, geminiModelName, emailAddress) {
  const cveList = fetchCveList();
  console.log(`fetchCveList: ${cveList.length} items matched (CVSS >= ${CONFIG.CVE.MIN_CVSS_SCORE})`);

  // 一度通知したCVEは再通知しない
  const notifiedIds = loadNotifiedCveIds();
  const notifiedSet = {};
  notifiedIds.forEach((id) => { notifiedSet[id] = true; });
  const newCves = cveList.filter((cve) => !notifiedSet[cve.id]);

  if (newCves.length === 0) {
    console.log('No new CVEs to notify.');
    return;
  }

  // CVSSスコアの高い順に並べ、対応の優先度が上から分かるようにする
  newCves.sort((a, b) => b.score - a.score);

  const translations = translateCveDescriptions(newCves, geminiApiKey, geminiModelName);
  sendCveEmailNotification(newCves, translations, emailAddress);

  // 通知に成功した場合のみ記録する（送信失敗時は次回の実行で再通知される）
  saveNotifiedCveIds(notifiedIds, newCves.map((cve) => cve.id));
  console.log(`Successfully notified ${newCves.length} CVEs to email: ${emailAddress}`);
}

/**
 * NVD APIから監視対象ミドルウェアに関連するCVEを取得する
 * @returns {Array<Object>} 閾値を満たしたCVE情報の配列
 */
function fetchCveList() {
  const apiKey = PropertiesService.getScriptProperties().getProperty(CONFIG.PROPS.NVD_API_KEY);
  if (!apiKey) {
    console.warn('NVD_API_KEY is not set. Falling back to unauthenticated access (5 requests / 30s).');
  }
  const intervalMs = apiKey ? CONFIG.CVE.REQUEST_INTERVAL_MS : CONFIG.CVE.REQUEST_INTERVAL_MS_NO_KEY;

  const now = new Date();
  const from = new Date(now.getTime() - CONFIG.CVE.LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const pubStartDate = formatNvdDate(from);
  const pubEndDate = formatNvdDate(now);

  // 複数のキーワードに一致したCVEは1件にまとめ、該当ミドルウェアを集約する
  const cveMap = {};
  let unscoredCount = 0;

  CONFIG.CVE.TARGETS.forEach((target, index) => {
    // NVDのレート制限に掛からないよう、2件目以降のリクエスト前に待機する
    if (index > 0) {
      Utilities.sleep(intervalMs);
    }

    let items;
    try {
      items = requestNvd(target.keyword, pubStartDate, pubEndDate, apiKey);
    } catch (e) {
      console.warn(`Failed to fetch CVEs for keyword "${target.keyword}": ${e.toString()}`);
      return;
    }

    items.forEach((item) => {
      const cve = item.cve;
      if (!cve || !cve.id) return;
      if (!matchesTarget(cve, target)) return;

      const metric = extractCvss(cve);
      if (!metric) {
        // CVSS未評価（採番直後で解析待ち）。後日スコアが付けば次回以降の実行で拾える
        unscoredCount++;
        return;
      }
      if (metric.score < CONFIG.CVE.MIN_CVSS_SCORE) return;

      if (!cveMap[cve.id]) {
        cveMap[cve.id] = {
          id: cve.id,
          score: metric.score,
          severity: metric.severity,
          cvssVersion: metric.version,
          published: cve.published || '',
          description: cveDescription(cve),
          references: cveReferences(cve),
          keywords: []
        };
      }
      const entry = cveMap[cve.id];
      if (entry.keywords.indexOf(target.keyword) === -1) entry.keywords.push(target.keyword);
    });
  });

  if (unscoredCount > 0) {
    console.log(`Skipped ${unscoredCount} CVE match(es) without a CVSS score (pending NVD analysis).`);
  }

  return Object.keys(cveMap).map((id) => cveMap[id]);
}

/**
 * NVD APIに1キーワード分のリクエストを送る
 * @param {string} keyword 検索キーワード
 * @param {string} pubStartDate 公開日の下限 (ISO-8601)
 * @param {string} pubEndDate 公開日の上限 (ISO-8601)
 * @param {string} apiKey NVD APIキー（未設定可）
 * @returns {Array<Object>} vulnerabilities 配列
 */
function requestNvd(keyword, pubStartDate, pubEndDate, apiKey) {
  const url = CONFIG.NVD_API_URL
    + '?keywordSearch=' + encodeURIComponent(keyword)
    + '&pubStartDate=' + encodeURIComponent(pubStartDate)
    + '&pubEndDate=' + encodeURIComponent(pubEndDate)
    + '&resultsPerPage=' + CONFIG.CVE.RESULTS_PER_PAGE;

  const options = {
    method: 'get',
    muteHttpExceptions: true,
    headers: apiKey ? { apiKey: apiKey } : {}
  };

  // NVDはレート超過や高負荷時に403/503を返すため、指数バックオフでリトライする
  const maxRetries = 3;
  let response;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();
    if (code === 200) break;

    const retryable = code === 403 || code === 429 || code === 503;
    if (retryable && attempt < maxRetries) {
      const waitMs = Math.min(6000 * Math.pow(2, attempt), 30000); // 6s, 12s, 24s
      console.warn(`NVD API returned ${code} for "${keyword}" (attempt ${attempt + 1}/${maxRetries + 1}). Retrying in ${waitMs}ms...`);
      Utilities.sleep(waitMs);
      continue;
    }
    throw new Error(`NVD API returned ${code}: ${response.getContentText().slice(0, 300)}`);
  }

  const json = JSON.parse(response.getContentText());
  const vulnerabilities = json.vulnerabilities || [];

  if (json.totalResults > vulnerabilities.length) {
    console.warn(`NVD returned ${vulnerabilities.length} of ${json.totalResults} results for "${keyword}". Consider raising CONFIG.CVE.RESULTS_PER_PAGE.`);
  }

  return vulnerabilities;
}

/**
 * CVEが監視対象に本当に該当するか判定する
 *
 * NVDのキーワード検索は説明文が対象のため、そのままでは「その製品に言及しているだけ」の
 * 無関係なCVEを大量に拾ってしまう（例: php検索で「PHPで書かれた別製品」の脆弱性）。
 * 以下の3段階で絞り込む。
 *
 * @param {Object} cve NVDのcveオブジェクト
 * @param {Object} target CONFIG.CVE.TARGETS の1要素
 * @returns {boolean}
 */
function matchesTarget(cve, target) {
  const kw = target.keyword.toLowerCase();
  const products = collectCpeProducts(cve);

  // 1. 影響製品(CPE)が割り当て済みなら、製品名の一致が最も確実
  if (products.some((product) => product.indexOf(kw) !== -1)) {
    return true;
  }

  // 2. 採番元CNAが製品ベンダー自身なら該当とみなす。公開直後でNVDの解析待ち
  //    (Awaiting Analysis) の状態はCPEが未割当のため、この経路が取りこぼしを防ぐ主線になる
  const sources = target.sources || [];
  if (sources.indexOf(cve.sourceIdentifier) !== -1) {
    return true;
  }

  // 3. 製品名が固有で誤検知が少ない場合のみ、説明文での判定にフォールバックする
  if (target.descriptionMatch && products.length === 0) {
    return cveDescription(cve).toLowerCase().indexOf(kw) !== -1;
  }

  return false;
}

/**
 * CVEの影響製品(CPE)からベンダー名・製品名を抽出する
 * @param {Object} cve NVDのcveオブジェクト
 * @returns {Array<string>} "vendor:product" 形式の小文字文字列
 */
function collectCpeProducts(cve) {
  const products = [];
  (cve.configurations || []).forEach((configuration) => {
    (configuration.nodes || []).forEach((node) => {
      (node.cpeMatch || []).forEach((match) => {
        if (!match.criteria) return;
        // cpe:2.3:{part}:{vendor}:{product}:{version}:... のうちvendor/productのみを対象とし、
        // バージョン番号への偶然の一致を避ける
        const parts = match.criteria.split(':');
        if (parts.length > 4) {
          products.push((parts[3] + ':' + parts[4]).toLowerCase());
        }
      });
    });
  });
  return products;
}

/**
 * CVEからCVSSベーススコアを抽出する
 * @param {Object} cve NVDのcveオブジェクト
 * @returns {Object|null} {score, severity, version} 形式。スコア未評価の場合はnull
 */
function extractCvss(cve) {
  const metrics = cve.metrics || {};
  // 新しいバージョンの評価を優先する
  const versionKeys = ['cvssMetricV40', 'cvssMetricV31', 'cvssMetricV30', 'cvssMetricV2'];

  for (let i = 0; i < versionKeys.length; i++) {
    const entries = metrics[versionKeys[i]];
    if (!entries || entries.length === 0) continue;

    // metricsにはssvc等 cvssData を持たない指標も混在するため取り除く
    const scored = entries.filter((entry) => entry && entry.cvssData && typeof entry.cvssData.baseScore === 'number');
    if (scored.length === 0) continue;

    // NVD自身の評価(Primary)を優先し、なければベンダー評価(Secondary)を使う
    const primary = scored.filter((entry) => entry.type === 'Primary');
    const chosen = primary.length > 0 ? primary[0] : scored[0];

    return {
      score: chosen.cvssData.baseScore,
      // CVSS v2は baseSeverity が cvssData ではなくエントリ側にあるためどちらも見る
      severity: chosen.cvssData.baseSeverity || chosen.baseSeverity || severityOfScore(chosen.cvssData.baseScore),
      version: versionKeys[i].replace('cvssMetric', 'CVSS ')
    };
  }
  return null;
}

/**
 * CVSSスコアから深刻度ラベルを求める
 * @param {number} score CVSSベーススコア
 * @returns {string}
 */
function severityOfScore(score) {
  if (score >= 9.0) return 'CRITICAL';
  if (score >= 7.0) return 'HIGH';
  if (score >= 4.0) return 'MEDIUM';
  if (score > 0.0) return 'LOW';
  return 'NONE';
}

/**
 * CVEの説明文（英語優先）を取得する
 * @param {Object} cve NVDのcveオブジェクト
 * @returns {string}
 */
function cveDescription(cve) {
  const descriptions = cve.descriptions || [];
  const english = descriptions.filter((d) => d.lang === 'en');
  const chosen = english.length > 0 ? english[0] : descriptions[0];
  return chosen ? chosen.value : '';
}

/**
 * CVEの参考リンクを取得する
 * @param {Object} cve NVDのcveオブジェクト
 * @returns {Array<string>} URLの配列
 */
function cveReferences(cve) {
  return (cve.references || [])
    .map((reference) => reference.url)
    .filter((url) => !!url)
    .slice(0, CONFIG.CVE.MAX_REFERENCES);
}

/**
 * NVD APIが要求するISO-8601形式の日時文字列に変換する
 * @param {Date} date 対象日時
 * @returns {string}
 */
function formatNvdDate(date) {
  // タイムゾーンを省略した場合はUTCとして解釈されるため、UTCで整形する
  return Utilities.formatDate(date, 'UTC', "yyyy-MM-dd'T'HH:mm:ss.SSS");
}

/**
 * 通知済みCVE-IDの一覧をスクリプトプロパティから読み込む
 * @returns {Array<string>} 通知済みCVE-IDの配列（古い順）
 */
function loadNotifiedCveIds() {
  const raw = PropertiesService.getScriptProperties().getProperty(CONFIG.PROPS.NOTIFIED_CVE_IDS);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn(`Failed to parse ${CONFIG.PROPS.NOTIFIED_CVE_IDS}. Treating it as empty: ${e.toString()}`);
    return [];
  }
}

/**
 * 通知済みCVE-IDの一覧を更新する
 * @param {Array<string>} existingIds 既存の通知済みID（古い順）
 * @param {Array<string>} newIds 今回通知したID
 */
function saveNotifiedCveIds(existingIds, newIds) {
  let ids = existingIds.concat(newIds);
  // スクリプトプロパティは1値あたり9KB上限のため、古いIDから捨てる。
  // 検索対象は直近 LOOKBACK_DAYS 日の公開分に限られるので、この上限で再通知は起きない
  if (ids.length > CONFIG.CVE.NOTIFIED_ID_LIMIT) {
    ids = ids.slice(ids.length - CONFIG.CVE.NOTIFIED_ID_LIMIT);
  }
  PropertiesService.getScriptProperties().setProperty(CONFIG.PROPS.NOTIFIED_CVE_IDS, JSON.stringify(ids));
}

/**
 * CVEの英語説明文をGeminiで日本語要約する
 * @param {Array<Object>} cveList CVE情報の配列
 * @param {string} apiKey Gemini APIキー
 * @param {string} modelName Gemini モデル名
 * @returns {Object} CVE-IDをキー、日本語要約を値とするオブジェクト（失敗時は空）
 */
function translateCveDescriptions(cveList, apiKey, modelName) {
  if (!apiKey || !modelName) {
    console.warn('Gemini is not configured. CVE descriptions will be sent in English.');
    return {};
  }

  const source = cveList
    .map((cve) => `${cve.id}\n${cve.description}`)
    .join('\n---\n');

  const prompt = `以下は脆弱性(CVE)の英語の説明文です。各CVEについて日本語で1〜2文の要約を作成してください。

【指示】
1. 影響を受ける製品・バージョンと、攻撃者が何を行えるようになるのかが分かるように記述してください。
2. 説明文に書かれていない情報を推測して補わないでください。
3. CVE-IDをキー、日本語要約を値とするJSONオブジェクトのみを出力してください。

【脆弱性リスト】
${source}
`;

  try {
    const text = callGemini(prompt, apiKey, modelName, {
      temperature: 0.2,
      // 初回実行では対象期間分のCVEがまとめて対象になるため、出力上限に余裕を持たせる
      maxOutputTokens: 8192,
      // 出力をJSONに固定し、パース失敗を防ぐ
      responseMimeType: 'application/json',
      thinkingConfig: {
        thinkingBudget: 0
      }
    });
    const parsed = JSON.parse(text);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (e) {
    // 翻訳は付加価値であり必須ではないため、失敗しても英文のまま通知を続ける
    console.warn(`Failed to translate CVE descriptions. Falling back to English: ${e.toString()}`);
    return {};
  }
}

/**
 * 脆弱性情報をメールで送信する
 * @param {Array<Object>} cveList 通知するCVE情報（CVSS降順）
 * @param {Object} translations CVE-IDをキーとする日本語要約
 * @param {string} emailAddress 送信先メールアドレス
 */
function sendCveEmailNotification(cveList, translations, emailAddress) {
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy/MM/dd');
  const subject = `【脆弱性】保守対象ミドルウェアの新規CVE ${cveList.length}件 (${today})`;

  const lines = [];
  lines.push(`保守対象ミドルウェアに関連する新規の脆弱性が ${cveList.length} 件見つかりました。`);
  lines.push(`条件: CVSS ${CONFIG.CVE.MIN_CVSS_SCORE} 以上 / 直近 ${CONFIG.CVE.LOOKBACK_DAYS} 日間に公開されたもの`);
  lines.push('');

  cveList.forEach((cve, index) => {
    lines.push('========================================');
    lines.push(`${index + 1}. ${cve.id}  [${cve.severity} ${cve.score} / ${cve.cvssVersion}]`);
    lines.push(`該当ミドルウェア: ${cve.keywords.join(', ')}`);
    lines.push(`公開日: ${cve.published}`);
    lines.push('');
    lines.push(`概要: ${translations[cve.id] || cve.description}`);
    lines.push('');
    lines.push(`NVD: https://nvd.nist.gov/vuln/detail/${cve.id}`);
    cve.references.forEach((url) => lines.push(`参考: ${url}`));
    lines.push('');
  });

  GmailApp.sendEmail(emailAddress, subject, lines.join('\n'));
}

/**
 * デバッグ用: メール送信も通知済み記録も行わずにCVE取得結果だけを確認する
 */
function testCveFetch() {
  const cveList = fetchCveList();
  console.log(`監視対象: ${CONFIG.CVE.TARGETS.map((t) => t.keyword).join(', ')}`);
  console.log(`該当CVE: ${cveList.length}件 (CVSS ${CONFIG.CVE.MIN_CVSS_SCORE}以上 / 直近${CONFIG.CVE.LOOKBACK_DAYS}日)`);

  const notifiedIds = loadNotifiedCveIds();
  cveList
    .sort((a, b) => b.score - a.score)
    .forEach((cve) => {
      const status = notifiedIds.indexOf(cve.id) === -1 ? '未通知' : '通知済み';
      console.log(`- ${cve.id} [${cve.severity} ${cve.score}] ${cve.keywords.join(',')} (${status})`);
    });
}

/**
 * デバッグ用: 取得したCVEの上位3件を使って、通知済み状態を無視してテストメールを送信する
 */
function testCveEmailSend() {
  const props = PropertiesService.getScriptProperties();
  const geminiApiKey = props.getProperty(CONFIG.PROPS.GEMINI_API_KEY);
  const geminiModelName = props.getProperty(CONFIG.PROPS.GEMINI_MODEL_NAME);
  let emailAddress = props.getProperty(CONFIG.PROPS.CVE_NOTIFICATION_EMAIL);

  if (!emailAddress) {
    emailAddress = Session.getActiveUser().getEmail();
  }

  const cveList = fetchCveList();
  if (cveList.length === 0) {
    console.log('No CVEs found to test.');
    return;
  }

  cveList.sort((a, b) => b.score - a.score);
  const testCves = cveList.slice(0, 3); // 上位3件をテスト送信
  console.log(`Sending test email with ${testCves.length} CVEs to ${emailAddress}...`);

  const translations = translateCveDescriptions(testCves, geminiApiKey, geminiModelName);
  sendCveEmailNotification(testCves, translations, emailAddress);
  console.log('Test email sent successfully.');
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

