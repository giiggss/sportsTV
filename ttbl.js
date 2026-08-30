// 德国乒乓球甲级联赛(TTBL)数据源 —— 官方站 ttbl.de
// 直播吧没有德乒联赛程与比分，本模块从官方站抓取：
//   赛程: /bundesliga/gameschedule 页面内嵌的 __NEXT_DATA__ JSON
//   樊振东效力于 Borussia Düsseldorf(杜塞尔多夫)，其比赛自动带 樊振东 标签，
//   进入关注列表：页签过滤 / 每日卡片 / 赛前提醒(云端 cron) / 局分变化提醒(本地轮询)
const BASE = 'https://ttbl.de';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
// 抓取范围：当前轮前 4 轮 ~ 后 8 轮（每轮约一周），保留约一个月历史比分，crawl 时滑动前进
const BEFORE = 4;
const AFTER = 8;

// 球队名德译中（2026/27 赛季 12 支），未映射的球队保留德文名
const TEAM_CN = {
  'Borussia Düsseldorf': '杜塞尔多夫',
  '1. FC Saarbrücken-TT': '萨尔布吕肯',
  'TTF Liebherr Ochsenhausen': '奥克森豪森',
  'BV Borussia 09 Dortmund': '多特蒙德',
  'SV Werder Bremen': '不莱梅',
  'TSV Bad Königshofen': '巴特柯尼希霍芬',
  'TTC Schwalbe Bergneustadt': '贝格诺伊施塔特',
  'TTC Zugbrücke Grenzau': '格伦茨劳',
  'ASC Grünwettersbach': '格伦维特斯巴赫',
  'TTC OE Clarity-Tel.Syst.Bad Homburg': '巴特洪堡',
  'TTC RhönSprudel Fulda-Maberzell': '富尔达',
  'Post SV Mühlhausen': '米尔豪森',
};

// 提取 Next.js 页面内嵌数据
function nextProps(html) {
  const m = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]+?)<\/script>/.exec(html);
  if (!m) throw new Error('页面无 __NEXT_DATA__，结构可能已变化');
  return JSON.parse(m[1]).props.pageProps;
}

// 队伍 id -> 中文名（同一页面里 teams/tableTeams 结构略有差异，id 形态全部收录）
function teamMapOf(props) {
  const map = {};
  for (const t of [...(props.teams || []), ...(props.tableTeams || [])]) {
    const name = t.seasonTeam && t.seasonTeam.name;
    if (!name) continue;
    const cn = TEAM_CN[name] || name;
    if (t.id) map[t.id] = cn;
    if (t.seasonTeamId) map[t.seasonTeamId] = cn;
    if (t.seasonTeam && t.seasonTeam.id) map[t.seasonTeam.id] = cn;
  }
  return map;
}

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'de,en;q=0.8' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return await res.text();
}

// unix 秒 -> 北京时间日期/时间
function bj(ts) {
  const d = new Date(ts * 1000 + 8 * 3600 * 1000);
  return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) };
}

// 官方 match -> 内部赛事条目（category/sub/teams 由 crawler 统一补充）
function toItem(m, teamMap) {
  const home = teamMap[m.homeTeamId] || m.homeTeamId;
  const away = teamMap[m.awayTeamId] || m.awayTeamId;
  const { date, time } = bj(m.timeStamp || 0);
  const isDuss = home === '杜塞尔多夫' || away === '杜塞尔多夫';
  // 比分只保留关注球队(杜塞尔多夫/樊振东)的完场比赛，其余比赛不存比分
  const finished = /finish|beend/i.test(m.matchState || '');
  const score = isDuss && finished && m.homeGames != null
    ? `${m.homeGames}-${m.awayGames}`
    : undefined;
  return {
    id: 'ttbl-' + m.id,
    date,
    time: m.isTimeToBeDefined ? '' : time,
    league: '德乒甲',
    home,
    away,
    channel: m.livestreamUrl ? 'TTBL直播' : '',
    status: '',
    important: false,
    type: 'other',
    label: `乒乓球,德甲,德乒甲,${home},${away}${isDuss ? ',樊振东' : ''}`,
    url: m.livestreamUrl || BASE,
    score,
    // 局分轮询定位用：官方比赛 id + 所在轮次
    ttblId: m.id,
    gdIndex: m.__gdIndex || null,
  };
}

// 赛季 slug：德甲赛季跨年（8 月开打，如 2026-2027）
function seasonSlug() {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  const y = now.getUTCFullYear();
  const start = now.getUTCMonth() + 1 >= 7 ? y : y - 1;
  return `${start}-${start + 1}`;
}

// 抓取德甲赛程，返回内部条目数组（已含 ttblId/gdIndex 附加字段）
async function fetchTTBLItems() {
  const first = await get(`${BASE}/bundesliga/gameschedule/current/current/all`);
  const props = nextProps(first);
  const cur = (props.selectedGameday || {}).index || 1;
  const total = (props.bundesliga && props.bundesliga.gamedayCount) || cur;
  const teamMap = teamMapOf(props);
  const season = seasonSlug();

  const items = [];
  const collect = (pageProps, gdIndex) => {
    for (const m of pageProps.matches || []) {
      if (!teamMap[m.homeTeamId] && !teamMap[m.awayTeamId]) continue;
      items.push(toItem({ ...m, __gdIndex: gdIndex }, teamMap));
    }
  };
  collect(props, cur);

  // 注意: 轮次参数必须配显式赛季，"current" 别名会忽略轮次返回当前轮
  for (let i = Math.max(1, cur - BEFORE); i <= Math.min(total, cur + AFTER); i++) {
    if (i === cur) continue;
    await new Promise(r => setTimeout(r, 400)); // 轻微节流
    try {
      collect(nextProps(await get(`${BASE}/bundesliga/gameschedule/${season}/${i}/all`)), i);
    } catch (e) {
      console.error(`[ttbl] 第${i}轮抓取失败: ${e.message}`);
    }
  }

  const seen = new Set();
  return items.filter(x => !seen.has(x.id) && seen.add(x.id));
}

// 局分轮询用：抓某轮页面，返回该轮 pageProps（含 matches 原始数据）
async function fetchTTBLGameday(index) {
  return nextProps(await get(`${BASE}/bundesliga/gameschedule/${seasonSlug()}/${index}/all`));
}

module.exports = { fetchTTBLItems, fetchTTBLGameday };
