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
// homeDe/awayDe: 德文队名（杯赛 match 内嵌，德甲从 teamMap 查出）
// path: 该场所在页面的站内路径（德甲 gameschedule / 杯赛 gameday），局分轮询定位用
function toItem(m, homeDe, awayDe, path, league, labelExtra) {
  const home = TEAM_CN[homeDe] || homeDe;
  const away = TEAM_CN[awayDe] || awayDe;
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
    league,
    home,
    away,
    channel: m.livestreamUrl ? 'TTBL直播' : '',
    status: '',
    important: false,
    type: 'other',
    label: `乒乓球,${labelExtra},${home},${away}${isDuss ? ',樊振东' : ''}`,
    url: m.livestreamUrl || BASE,
    score,
    // 局分轮询定位用：官方比赛 id + 所在页面路径
    ttblId: m.id,
    ttblPath: path,
  };
}

// 赛季 slug：德甲赛季跨年（8 月开打，如 2026-2027）
function seasonSlug() {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  const y = now.getUTCFullYear();
  const start = now.getUTCMonth() + 1 >= 7 ? y : y - 1;
  return `${start}-${start + 1}`;
}

// 抓取德甲+德国杯赛程，返回内部条目数组（已含 ttblId/ttblPath 附加字段）
async function fetchTTBLItems() {
  const season = seasonSlug();
  const items = [];
  const seen = new Set();
  const collect = (pageProps, path, league, labelExtra) => {
    const teamMap = teamMapOf(pageProps);
    for (const m of pageProps.matches || []) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      // 杯赛 match 内嵌队名(homeTeam.name)；德甲只有 id，从 teamMap 查
      const homeDe = (m.homeTeam && m.homeTeam.name) || teamMap[m.homeTeamId];
      const awayDe = (m.awayTeam && m.awayTeam.name) || teamMap[m.awayTeamId];
      if (!homeDe || !awayDe) continue;
      items.push(toItem(m, homeDe, awayDe, path, league, labelExtra));
    }
  };

  // ---- 德甲: 当前轮前4轮~后8轮 ----
  const first = await get(`${BASE}/bundesliga/gameschedule/current/current/all`);
  const props = nextProps(first);
  const cur = (props.selectedGameday || {}).index || 1;
  const total = (props.bundesliga && props.bundesliga.gamedayCount) || cur;
  collect(props, `bundesliga/gameschedule/${season}/${cur}`, '德乒甲', '德甲,德乒甲');
  // 注意: 轮次参数必须配显式赛季，"current" 别名会忽略轮次返回当前轮
  for (let i = Math.max(1, cur - BEFORE); i <= Math.min(total, cur + AFTER); i++) {
    if (i === cur) continue;
    await new Promise(r => setTimeout(r, 400)); // 轻微节流
    try {
      const path = `bundesliga/gameschedule/${season}/${i}/all`;
      collect(nextProps(await get(`${BASE}/${path}`)), path, '德乒甲', '德甲,德乒甲');
    } catch (e) {
      console.error(`[ttbl] 德甲第${i}轮抓取失败: ${e.message}`);
    }
  }

  // ---- 德国杯(Leapmotor Pokal): 从首页提取对局页链接(每页含整轮全部比赛) ----
  try {
    const home = await get(BASE);
    const pokalLinks = [...new Set(home.match(/\/pokal\/gameday\/[\w-]+\/\d+\/[\w-]+/gi) || [])]
      .filter(l => l.includes(`/${season}/`));
    for (const link of pokalLinks) {
      await new Promise(r => setTimeout(r, 400));
      try {
        collect(nextProps(await get(`${BASE}${link}`)), link.replace(/^\//, ''), '德国杯', '德国杯,德杯');
      } catch (e) {
        console.error(`[ttbl] 杯赛页抓取失败: ${e.message}`);
      }
    }
    console.log(`[ttbl] 德国杯对局页 ${pokalLinks.length} 个`);
  } catch (e) {
    console.error(`[ttbl] 德国杯抓取失败(不影响其他数据): ${e.message}`);
  }

  return items;
}

// 局分轮询用：抓某页面(德甲轮次/杯赛对局页)，返回 pageProps（含 matches 原始数据）
async function fetchTTBLGameday(path) {
  return nextProps(await get(`${BASE}/${path}`));
}

module.exports = { fetchTTBLItems, fetchTTBLGameday };
