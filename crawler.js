// 直播吧赛程爬虫（可独立运行: node crawler.js，也可被 server.js 引用）
// GitHub Actions 每天定时运行本脚本生成 data/events.json，供 GitHub Pages 前端读取
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'events.json');
const SOURCE_URL = 'https://m.zhibo8.com/';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

// ---------------- 分类规则 ----------------
// 乒乓: label 中含 乒乓球 / WTT / 乒超 / 世乒赛 等
const TT_KEYWORDS = ['乒乓球', 'WTT', '乒超', '世乒赛', '乒联'];
// LOL: label 中含 英雄联盟 或 LOL
const LOL_KEYWORDS = ['英雄联盟', 'LOL'];
// 足球只保留这些联赛
const FOOTBALL_KEYWORDS = ['英超', '中超', '欧冠', '西甲'];
// 足球子分类（页签）：label 关键词 -> sub key
const FOOTBALL_SUBS = [
  ['英超', 'yingchao'],
  ['中超', 'zhongchao'],
  ['欧冠', 'ouguan'],
  ['西甲', 'xijia'],
];
const SUB_KEYS = FOOTBALL_SUBS.map(([, k]) => k);
// 关注的球队（页签）：label 关键词 -> team key
const TEAMS = [
  ['曼城', 'mancity'],
  ['阿森纳', 'arsenal'],
  ['曼联', 'manutd'],
  ['切尔西', 'chelsea'],
  ['申花', 'shenhua'],
  ['上港', 'shanggang'], // 兼容旧称
  ['海港', 'shanggang'],
  ['巴塞罗那', 'barcelona'],
  ['巴萨', 'barcelona'],
  ['皇家马德里', 'realmadrid'],
  ['皇马', 'realmadrid'],
  ['马德里竞技', 'atletico'],
  ['马竞', 'atletico'],
];
const TEAM_KEYS = [...new Set(TEAMS.map(([, k]) => k))];

function classify(item) {
  const label = item.label || '';
  // type 为直播吧权威分类（football/basketball/game/other）；
  // label 末尾可能带 "推荐属性,足球,篮球" 等干扰词，不能用 label 判断足球
  if (item.type === 'football') {
    if (FOOTBALL_KEYWORDS.some(k => label.includes(k))) return 'football';
    return 'other'; // 其余联赛归入"其他"，不出现在足球页签
  }
  if (TT_KEYWORDS.some(k => label.includes(k))) return 'pingpong';
  if (item.type === 'game' && LOL_KEYWORDS.some(k => label.includes(k))) return 'lol';
  return 'other';
}

// 足球赛事的子分类（yingchao/zhongchao/ouguan/xijia），供独立页签过滤
function subCategory(item) {
  if (item.category !== 'football') return '';
  const hit = FOOTBALL_SUBS.find(([kw]) => (item.label || '').includes(kw));
  return hit ? hit[1] : '';
}

// 赛事涉及的关注球队（可多支，如"阿森纳 vs 曼城"）
function teamMatches(item) {
  const label = item.label || '';
  const hit = [];
  for (const [kw, key] of TEAMS) {
    if (label.includes(kw) && !hit.includes(key)) hit.push(key);
  }
  return hit;
}

// ---------------- 爬取与解析 ----------------
async function fetchPage() {
  const res = await fetch(SOURCE_URL, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

// 按 g-title 分组逐段解析，保证每条赛事归属正确日期
function parseSchedule(html) {
  const events = [];
  // 日期分组标题: <div class="g-title" formatDate="2026-08-30">08月30日 星期日 今天</div>
  const dateRe = /<div class="g-title" formatDate="([\d-]+)"[^>]*>([^<]*)<\/div>/g;
  const markers = [];
  let m;
  while ((m = dateRe.exec(html)) !== null) {
    markers.push({ date: m[1], start: m.index });
  }
  if (markers.length === 0) return events;

  // 条目: <li class="item ..." type="football" label="..." href="..." ...>...</li>
  const liRe = /<li class="item[^"]*"([^>]*)>([\s\S]*?)<\/li>/g;

  for (let i = 0; i < markers.length; i++) {
    const segStart = markers[i].start;
    const segEnd = i + 1 < markers.length ? markers[i + 1].start : html.length;
    const segment = html.slice(segStart, segEnd);

    let li;
    liRe.lastIndex = 0;
    while ((li = liRe.exec(segment)) !== null) {
      const attrs = li[1];
      const body = li[2];

      const getAttr = (name) => {
        const r = new RegExp(`${name}="([^"]*)"`).exec(attrs);
        return r ? r[1] : '';
      };

      const time = (/<div class="time">([^<]*)<\/div>/.exec(body) || [])[1] || '';
      const sName = (/<div class="s_name">([\s\S]*?)<\/div>/.exec(body) || [])[1]
        .replace(/<[^>]+>/g, '').trim();
      const channel = (/<div class="s_keywords">([\s\S]*?)<\/div>/.exec(body) || [])[1]
        .replace(/<[^>]+>/g, '').trim();
      const teamNames = [];
      const teamRe = /<div class="team-name">([\s\S]*?)<\/div>/g;
      let t;
      while ((t = teamRe.exec(body)) !== null) teamNames.push(t[1].replace(/<[^>]+>/g, '').trim());
      const status = (/<div class="remind">\s*([\s\S]*?)\s*<\/div>/.exec(body) || [])[1]
        .replace(/<a[\s\S]*?<\/a>/g, '').replace(/<[^>]+>/g, '').trim();

      const href = getAttr('href');
      const label = getAttr('label');
      const type = getAttr('type');
      const important = getAttr('important') === '1';

      const item = {
        date: markers[i].date,
        time,
        league: sName,
        home: teamNames[0] || '',
        away: teamNames[1] || '',
        channel,
        status,
        important,
        type,
        label,
        url: href ? 'https://www.zhibo8.cc' + href : '',
      };
      item.category = classify(item);
      item.sub = subCategory(item);
      item.teams = teamMatches(item);
      events.push(item);
    }
  }
  return events;
}

async function crawl() {
  const html = await fetchPage();
  const events = parseSchedule(html);
  if (events.length === 0) throw new Error('解析结果为空，页面结构可能已变化');
  const data = {
    crawledAt: new Date().toISOString(),
    source: SOURCE_URL,
    count: events.length,
    events,
  };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  console.log(`[crawl] ${new Date().toLocaleString('zh-CN')} 完成，共 ${events.length} 场赛事`);
  return data;
}

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return null;
  }
}

// 数据是否需要更新：无数据 / 爬取时间超过6小时 / 不包含今天的数据
function isStale(data) {
  if (!data || !Array.isArray(data.events) || data.events.length === 0) return true;
  const crawled = new Date(data.crawledAt).getTime();
  if (Date.now() - crawled > 6 * 3600 * 1000) return true;
  const today = new Date();
  const y = today.getFullYear();
  const mo = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  return !data.events.some(e => e.date === `${y}-${mo}-${d}`);
}

module.exports = { crawl, loadData, isStale, DATA_FILE, SUB_KEYS, TEAM_KEYS };

// 命令行直接运行: node crawler.js
if (require.main === module) {
  crawl().catch(e => {
    console.error('爬取失败:', e.message);
    process.exit(1);
  });
}
