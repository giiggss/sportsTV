// WTT 官方站 (worldtabletennis.com) 数据源
// 2026-09 起 liveeventsapi 动态接口(GetAllLiveOrActiveEvents/GetOfficialResult/GetBrackets)
// 对脚本请求返回 400，改用 wtt-web-frontdoor 静态缓存文件（无需鉴权）：
//   赛事列表   wtt_get_live_event.json
//   赛事详情   {id}_active_live_event_details.json（日期范围）
//   全部对阵   {id}/schedule/schedule.json（含时间/轮次/种子/上一轮连接）
//   进行中     {id}_livematchids.json
//   已完赛     {id}/officialresult/officialresult_minimal.json
//   单场比分   matchdata/{id}/{documentCode}.json（competitiors[].scores 每局分）

const CDN = 'https://wtt-web-frontdoor-withoutcache-cqakg0andqf5hchn.a01.azurefd.net/';
const CDN_CACHED = 'https://wtt-web-frontdoor-cthahjeqhbh6aqe3.a01.azurefd.net/';
const WTT_EVENTS_URL = CDN_CACHED + 'websitestaticapifiles/general/wtt_get_live_event.json';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const HEADERS = {
  'User-Agent': UA,
  'Accept': 'application/json',
  'Origin': 'https://www.worldtabletennis.com',
  'Referer': 'https://www.worldtabletennis.com/',
};
const wttEventDetailUrl = id => `${CDN_CACHED}websitestaticapifiles/${id}/${id}_active_live_event_details.json`;
const wttScheduleUrl = id => `${CDN}websitecacheddata/${id}/schedule/schedule.json`;
const wttLiveMatchUrl = id => `${CDN}websitestaticapifiles/running-events/${id}/${id}_livematchids.json`;
const wttOfficialUrl = id => `${CDN}websitecacheddata/${id}/officialresult/officialresult_minimal.json`;
const wttMatchDataUrl = (id, code) => `${CDN}matchdata/${id}/${code}.json`;

// 赛事名英->中映射（部分，未匹配的保留英文）
const EVENT_CN = {
  'Champions Yokohama': 'WTT冠军赛横滨站',
  'Champions Macao': 'WTT冠军赛澳门站',
  'Champions Frankfurt': 'WTT冠军赛法兰克福站',
  'Champions Chongqing': 'WTT冠军赛重庆站',
  'Champions Incheon': 'WTT冠军赛仁川站',
  'Champions Montpellier': 'WTT冠军赛蒙彼利埃站',
  'Europe Smash': '欧洲大满贯',
  'China Smash': '中国大满贯',
  'Singapore Smash': '新加坡大满贯',
  'Saudi Smash': '沙特大满贯',
  'US Smash': '美国大满贯',
  'Star Contender': 'WTT球星挑战赛',
  'Contender': 'WTT常规挑战赛',
  'Finals': 'WTT总决赛',
  'Cup Finals': 'WTT杯决赛',
};

// 球员名英->中映射（常见国乒+外协名将）
const PLAYER_CN = {
  'WANG Chuqin': '王楚钦', 'FAN Zhendong': '樊振东', 'MA Long': '马龙',
  'LIANG Jingkun': '梁靖崑', 'LIN Shidong': '林诗栋', 'LIN Gaoyuan': '林高远',
  'XIANG Peng': '向鹏', 'ZHOU Qihao': '周启豪', 'XUE Fei': '薛飞',
  'SUN Yingsha': '孙颖莎', 'WANG Manyu': '王曼昱', 'CHEN Meng': '陈梦',
  'WANG Yidi': '王艺迪', 'WANG Yudi': '王艺迪', 'CHEN Xingtong': '陈幸同', 'KUAI Man': '蒯曼',
  'QIAN Tianyi': '钱天一', 'HE Zhuojia': '何卓佳', 'SHI Xunyao': '石洵瑶',
  'ZHU Yuling': '朱雨玲', 'CHENG I-Ching': '郑怡静',
  'HARIMOTO Tomokazu': '张本智和', 'HARIMOTO Miwa': '张本美和',
  'HAYATA Hina': '早田希娜', 'ITO Mima': '伊藤美诚', 'OJIO Haruna': '大藤沙月',
  'ODO Satsuki': '大藤沙月',
  'OH Junsung': '吴晙诚', 'JANG Woojin': '张禹珍', 'AN Jaehyun': '安宰贤',
  'LIM Jonghoon': '林钟勋', 'SHIN Yubin': '申裕斌', 'JEON Jihee': '田志希',
  'LEBRUN Felix': 'F·勒布伦', 'LEBRUN Alexis': 'A·勒布伦',
  'MOREGARD Truls': '莫雷加德', 'KALLBERG Anton': '卡尔伯格',
  'OVTCHAROV Dimitrij': '奥恰洛夫', 'BOLL Timo': '波尔', 'QIU Dang': '邱党',
  'FRANZISKA Patrick': '弗朗西斯卡', 'DUDA Benedikt': '杜达',
  'GAUZY Simon': '西蒙·高茨', 'PITCHFORD Liam': '皮切福德',
  'CALDERANO Hugo': '雨果', 'ARUNA Quadri': '阿鲁纳',
  'LIN Yun-Ju': '林昀儒', 'CHUANG Chih-Yuan': '庄智渊', 'KAO Cheng-Jui': '高承睿',
  'TOGAMI Shunsuke': '户上隼辅', 'SHINOZUKA Hiroto': '篠塚大登', 'UDA Yukiya': '宇田幸矢',
  'YOSHIYAMA Ryoichi': '吉山僚一', 'MATSUSHIMA Sora': '松岛辉空',
  'HIRANO Miu': '平野美宇', 'KIHARA Miyuu': '木原美悠', 'NAGASAKI Miyu': '长崎美柚',
  'SATO Hitomi': '佐藤瞳', 'HASHIMOTO Honoka': '桥本帆乃香',
  'YOKOI Sakura': '横井咲樱', 'OJIO Yuna': '小盐悠菜',
  'PYON Song Gyong': '边松景', 'KIM Kum Yong': '金琴英',
  'BALAZOVA Barbora': '巴拉佐娃', 'POLCANOVA Sofia': '波尔卡诺娃',
  'SZOCS Bernadette': '斯佐科斯', 'SAMARA Elizabeta': '萨马拉',
  'HAN Ying': '韩莹', 'WAN Yuan': '万远', 'SHAN Xiaona': '单晓娜',
  'NI Xia Lian': '倪夏莲', 'YUAN Jia Nan': '袁嘉楠', 'PAVADE Prithika': '帕瓦德',
  'DIAZ Adriana': 'A·迪亚兹', 'ZHANG Lily': '张安', 'WANG Amy': '王艾米',
  'TAKAHASHI Bruna': '布鲁娜·高桥', 'BATRA Manika': '巴特拉',
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getJson(url, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (res.status === 200) {
        const text = await res.text();
        if (text && text.length > 2) return JSON.parse(text);
        return null;
      }
      if (res.status === 422 && i < retries) { await sleep(1000 * (i + 1)); continue; }
      return null;
    } catch (e) {
      if (i < retries) { await sleep(800); continue; }
      return null;
    }
  }
  return null;
}

// 赛事名中文化
function eventNameCN(name) {
  if (!name) return 'WTT赛事';
  // 去掉年份和赞助商后缀
  let clean = name.replace(/\s*20\d{2}.*$/, '').trim();
  for (const [en, cn] of Object.entries(EVENT_CN)) {
    if (name.includes(en)) {
      // 尝试提取城市名
      const cityMatch = clean.match(new RegExp(en.replace(/\s+/g, '\\s+') + '\\s+([A-Za-z]+)'));
      const city = cityMatch ? cityMatch[1] : '';
      return cn + (city ? city : '');
    }
  }
  return clean || name;
}

// 球员名中文化
function playerNameCN(name) {
  if (!name) return '';
  // 尝试直接匹配
  if (PLAYER_CN[name]) return PLAYER_CN[name];
  // 尝试首字母大写变体
  const normalized = name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  if (PLAYER_CN[normalized]) return PLAYER_CN[normalized];
  return name; // 未匹配保持英文
}

// 从 documentCode 解析轮次。格式混乱（FNL-000100 / SFNL000100 / 8FNL000600 / R32-001300 / RND3000700）
// 用关键词 includes 匹配最简单可靠
function parseRound(docCode) {
  if (!docCode) return '';
  const s = docCode.toUpperCase();
  if (s.includes('SFNL')) return '半决赛';
  if (s.includes('QFNL')) return '1/4决赛';
  if (s.includes('8FNL')) return '1/8决赛';
  if (s.includes('16FNL')) return '1/16决赛';
  if (s.includes('32FNL')) return '1/32决赛';
  if (s.includes('FNL')) return '决赛'; // 放最后，避免被 SFNL/QFNL 等误匹配
  if (s.includes('R128')) return '1/64决赛';
  if (s.includes('R64')) return '1/32决赛';
  if (s.includes('R32')) return '1/16决赛';
  if (s.includes('R16')) return '1/8决赛';
  if (s.includes('RND1')) return '小组赛第1轮';
  if (s.includes('RND2')) return '小组赛第2轮';
  if (s.includes('RND3')) return '小组赛第3轮';
  if (s.includes('QUAL')) return '资格赛';
  return '';
}

// 从 scores 字符串算局分: "7,11,11,11,11,0,0" -> 统计赢了几局
function calcGameScore(homeScores, awayScores, bestOf = 7) {
  const h = homeScores.split(',').map(Number);
  const a = awayScores.split(',').map(Number);
  let hWin = 0, aWin = 0;
  const need = Math.ceil(bestOf / 2); // 7局4胜需4, 5局3胜需3
  for (let i = 0; i < bestOf; i++) {
    if (hWin >= need || aWin >= need) break;
    if (h[i] === 0 && a[i] === 0) break; // 未打的局
    if (h[i] > a[i]) hWin++; else if (a[i] > h[i]) aWin++;
  }
  return `${hWin}-${aWin}`;
}

// 抓单个赛事：schedule.json 拿全部对阵，进行中/完赛的比赛再拉 matchdata 补比分
async function fetchEventMatches(eventId, eventName) {
  const sched = await getJson(wttScheduleUrl(eventId));
  if (!sched || !Array.isArray(sched) || sched.length === 0) return [];
  const units = [];
  for (const day of sched) {
    const u = day && day.Competition && day.Competition.Unit;
    if (Array.isArray(u)) units.push(...u);
  }
  // 只保留单打（MS/WS），双打/混双数据量大且关注度低
  const singles = units.filter(u => /Men's Singles|Women's Singles/i.test(u.SubEvent || ''));
  if (singles.length === 0) return [];
  // 需要抓比分的比赛：进行中 + 已完赛
  // 注意：schedule 的 Code 是截断格式(尾部横杠少)，official/live 的 documentCode 是完整格式，
  // 用前缀匹配（schedule Code 是完整 documentCode 的前缀）
  const live = (await getJson(wttLiveMatchUrl(eventId))) || [];
  const liveCodes = new Set((live.map(x => x && x.d) || []).filter(Boolean));
  const official = (await getJson(wttOfficialUrl(eventId))) || [];
  const officialCodes = new Set((official.map(x => x && x.documentCode) || []).filter(Boolean));
  const findFullCode = code => {
    for (const c of liveCodes) if (c.startsWith(code)) return c;
    for (const c of officialCodes) if (c.startsWith(code)) return c;
    return null;
  };
  const items = [];
  for (const u of singles) {
    const code = u.Code || '';
    const starts = (u.StartList && u.StartList.Start) || [];
    if (starts.length < 2) continue; // 对阵未定
    const homeInfo = starts[0].Competitor || {};
    const awayInfo = starts[1].Competitor || {};
    const home = (homeInfo.Description && homeInfo.Description.TeamName) || '';
    const away = (awayInfo.Description && awayInfo.Description.TeamName) || '';
    if (!home || !away) continue;
    // WTT 返回的是赛事当地时间字符串 "2026-09-10T11:00:00"，直接截取日期/时间，
    // 不做 Date 转换——否则在 UTC 环境（GitHub Actions）下会偏移8小时
    const date = (u.StartDate || '').slice(0, 10);
    const time = (u.StartDate || '').slice(11, 16);
    const round = parseRound(code);
    const subEvent = u.SubEvent || '';
    let score = null, status = '未开始';
    const fullCode = findFullCode(code);
    if (fullCode) {
      const md = await getJson(wttMatchDataUrl(eventId, fullCode));
      if (md && Array.isArray(md.competitiors) && md.competitiors.length >= 2) {
        const h = md.competitiors[0], a = md.competitiors[1];
        // 双方分数相同(全0)说明还没开打，不显示比分
        if (h.scores && a.scores && h.scores !== a.scores) {
          score = calcGameScore(h.scores, a.scores, (md.matchConfig && md.matchConfig.bestOfXGames) || 7);
        }
        status = md.resultStatus === 'OFFICIAL' ? '已结束' : '进行中';
      }
      await sleep(120 + Math.random() * 180); // 反爬节流
    }
    items.push({
      date, time,
      league: eventNameCN(eventName),
      home: playerNameCN(home),
      away: playerNameCN(away),
      homeEn: home,
      awayEn: away,
      round,
      subEvent,
      score,
      status,
      source: 'wtt',
      wttEventId: eventId,
      wttMatchId: code, // documentCode 全局唯一，可去重
      label: `乒乓球,WTT,${eventName},${subEvent},${home},${away}`,
      type: 'pingpong',
      url: `https://www.worldtabletennis.com/matches?selectedTab=DRAWS&eventId=${eventId}`,
    });
  }
  return items;
}

// 主入口：抓近期非 Youth/Feeder/Contender 赛事（澳门大奖赛、大满贯、冠军赛等）
async function fetchWTTItems(daysBack = 14, daysAhead = 30) {
  const events = await getJson(WTT_EVENTS_URL);
  if (!events || !Array.isArray(events)) {
    console.log('[wtt] 赛事列表获取失败');
    return [];
  }
  const now = new Date();
  const all = [];
  for (const ev of events) {
    const name = ev.eventName || '';
    if (/youth|feeder|contender/i.test(name)) continue; // 排除青年/选拔/挑战赛
    // 详情：日期范围（窗口过滤 + 预告兜底）
    const detail = await getJson(wttEventDetailUrl(ev.eventId));
    let dateStr = '', endStr = '', isFuture = true, isRunning = false;
    if (detail && detail.startDateTime) {
      dateStr = detail.startDateTime.slice(0, 10);
      endStr = (detail.endDateTime || '').slice(0, 10);
      const s = new Date(detail.startDateTime);
      const e = new Date(detail.endDateTime);
      isFuture = s > now;
      isRunning = s <= now && e >= now;
      const diff = (now - s) / 864e5;
      if (diff < -daysAhead || diff > daysBack) continue; // 不在抓取窗口
    }
    await sleep(200 + Math.random() * 300); // 反爬节流
    const matches = await fetchEventMatches(ev.eventId, name);
    all.push(...matches);
    if (matches.length > 0) {
      console.log(`[wtt] ${name}: ${matches.length} 场`);
    } else {
      // 该赛事还没有任何对阵（抽签未出/未开赛）→ 生成赛事预告条目，让用户能看到"哪天有比赛"
      all.push({
        date: dateStr || now.toISOString().slice(0, 10),
        time: '',
        league: eventNameCN(name),
        home: eventNameCN(name),
        away: dateStr === endStr ? '单日' : `至 ${endStr.slice(5)}`,
        round: isRunning ? '进行中' : (isFuture ? '预告' : ''),
        subEvent: '',
        score: null,
        status: isRunning ? '进行中' : '未开始',
        source: 'wtt',
        wttEventId: ev.eventId,
        wttMatchId: 'event-' + ev.eventId, // 赛事级条目
        label: `乒乓球,WTT,${name}`,
        type: 'pingpong',
        url: `https://www.worldtabletennis.com/matches?eventId=${ev.eventId}`,
        isEventCard: true, // 标记：这是赛事预告，不是具体比赛
      });
      console.log(`[wtt] ${name}: 暂无比赛数据，生成赛事预告 (${dateStr}~${endStr})`);
    }
  }
  // 去重（按 wttMatchId）
  const seen = new Set();
  const deduped = all.filter(m => {
    if (seen.has(m.wttMatchId)) return false;
    seen.add(m.wttMatchId);
    return true;
  });
  console.log(`[wtt] 共抓取 ${deduped.length} 场比赛`);
  return deduped;
}

module.exports = { fetchWTTItems, eventNameCN, playerNameCN };
