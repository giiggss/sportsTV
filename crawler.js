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

// ---------------- 今日赛事卡片 ----------------
function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 生成"今日赛事"小卡片（SVG，每天随爬取自动更新，可保存/分享）
function generateCard(data) {
  const events = Array.isArray(data.events) ? data.events : [];
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

  // 优先展示今天；今天无赛事则展示最近一个有赛事的日期
  let day = today, title = '今日赛事';
  let dayEvents = events.filter(e => e.date === day);
  if (dayEvents.length === 0) {
    const dates = [...new Set(events.map(e => e.date))].sort();
    const next = dates.find(ds => ds >= today);
    if (next) {
      day = next;
      dayEvents = events.filter(e => e.date === day);
      if (day !== today) title = '近期赛事';
    }
  }

  // 重要赛事优先，其次按时间排序，最多展示 14 场
  const sorted = dayEvents.slice().sort((a, b) =>
    (b.important ? 1 : 0) - (a.important ? 1 : 0) ||
    (a.time || '').localeCompare(b.time || ''));
  const shown = sorted.slice(0, 14);

  const W = 750, PAD = 44;
  const rowH = 80, headH = 170, footH = 100;
  const H = headH + shown.length * rowH + footH;
  const week = '周' + WEEK[new Date(day + 'T00:00:00').getDay()];
  const dateText = `${day.slice(5, 7)}月${day.slice(8, 10)}日 ${week}`;

  const rows = shown.map((e, i) => {
    const cy = headH + i * rowH;
    const teams = e.home && e.away ? `${e.home} vs ${e.away}` : (e.league || '赛事');
    const channel = (e.channel || '').split(/\s+/).slice(0, 2).join(' ');
    const ch = channel.length > 9 ? channel.slice(0, 8) + '…' : channel;
    // 重要赛事的时间用红色标识
    const timeColor = e.important ? '#d8453e' : '#2e6be6';
    return `
    <text x="${PAD}" y="${cy + 26}" font-size="26" font-weight="700" fill="${timeColor}">${esc(e.time || '--')}</text>
    <text x="${PAD + 96}" y="${cy + 25}" font-size="19" fill="#98a0ab">${esc((e.league || '').slice(0, 8))}</text>
    <text x="${W - PAD}" y="${cy + 25}" font-size="19" fill="#98a0ab" text-anchor="end">${esc(ch)}</text>
    <text x="${PAD}" y="${cy + 60}" font-size="28" font-weight="600" fill="#22252a">${esc(teams)}</text>`;
  }).join('\n');

  const more = sorted.length > shown.length
    ? `\n    <text x="${W / 2}" y="${headH + shown.length * rowH + 36}" font-size="19" fill="#98a0ab" text-anchor="middle">当天共 ${sorted.length} 场，打开页面查看全部</text>`
    : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#eef1f5"/>
  <rect x="20" y="20" width="${W - 40}" height="${H - 40}" rx="20" fill="#ffffff"/>
  <text x="${PAD}" y="86" font-size="22" font-weight="600" fill="#2e6be6">SPORTS · ${title}</text>
  <text x="${PAD}" y="140" font-size="42" font-weight="800" fill="#22252a">${dateText}</text>
  <line x1="${PAD}" y1="${headH - 24}" x2="${W - PAD}" y2="${headH - 24}" stroke="#eceff3" stroke-width="2"/>${rows}${more}
  <text x="${W / 2}" y="${H - 40}" font-size="18" fill="#b6bcc4" text-anchor="middle">数据来源 zhibo8.com · 每天 ${new Date().toLocaleString('zh-CN', { hour12: false })} 自动更新</text>
</svg>`;
  fs.writeFileSync(path.join(DATA_DIR, 'card.svg'), svg, 'utf8');
  console.log(`[card] 已生成赛事卡片 data/card.svg（${day}，展示 ${shown.length}/${dayEvents.length} 场）`);
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
  generateCard(data);
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
