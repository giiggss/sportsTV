// 关注球队历史比分持久化模块
// 直播吧赛程不保留过去日期的完赛结果，比分接口也只保留当天的，因此需要主动保存。
// 每次爬取时: 从比分接口拉取 state=3(完赛) 的关注球队比赛 -> 落盘到 data/score-history.json
// 然后把这些比分合并回 events 列表（匹配现有条目 + 补不存在的历史条目），保证 UI 上
// 每支关注球队永远能看到最近 3 场历史比分。
const fs = require('fs');
const path = require('path');
const { fetchLiveScores } = require('./score');

const DATA_DIR = path.join(__dirname, 'data');
const HIST_FILE = path.join(DATA_DIR, 'score-history.json');
const MAX_PER_TEAM = 5; // 每支球队最多存 5 场（用户要求最近 3 场，多留 2 场兜底）

// 加载历史数据
function loadHistory() {
  try {
    return JSON.parse(fs.readFileSync(HIST_FILE, 'utf8'));
  } catch {
    return { updatedAt: null, entries: [] }; // entries: [{date, time, league, home, away, homeScore, awayScore, teams:[], source, url}]
  }
}

function saveHistory(h) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(HIST_FILE, JSON.stringify(h, null, 2), 'utf8');
}

// 队名 -> 关注球队 keys 数组 (重用 TEAMS 关键词规则)
function matchKeysFromName(name, TEAMS) {
  const list = [];
  for (const [kw, key] of TEAMS) {
    if ((name || '').includes(kw) && !list.includes(key)) list.push(key);
  }
  return list;
}

// 两支球队里只要任意一支在 FOLLOW 范围就保留
function followFilter(teams, FOLLOW_KEYS) {
  return teams.filter(t => FOLLOW_KEYS.includes(t));
}

// 从比分接口拉去完赛比赛，增量合入历史
async function collectScoreHistory({ TEAMS, FOLLOW_KEYS }) {
  const hist = loadHistory();
  const seen = new Set(hist.entries.map(keyOf));

  let feed = [];
  try {
    feed = await fetchLiveScores();
  } catch (e) {
    console.error(`[history] 比分接口拉取失败: ${e.message}，使用已有历史数据`);
  }

  for (const s of feed) {
    if (s.type !== 'football' && s.type !== 'basketball') continue; // 足球+篮球都收集（中国男篮等）
    if (!(s.state === '3' || s.state === 3 || /完赛|finished/i.test(s.matchState || ''))) continue;
    const home = s.home_team || '';
    const away = s.visit_team || s.away_team || '';
    const hScore = s.home_score == null ? null : String(s.home_score);
    // 注意：接口客队分数字段是 visit_score（不是 away_score），之前一直取错导致收集不到任何完赛
    const aScore = s.visit_score == null ? (s.away_score == null ? null : String(s.away_score)) : String(s.visit_score);
    if (hScore == null || aScore == null) continue;
    const teamKeys = [...matchKeysFromName(home, TEAMS), ...matchKeysFromName(away, TEAMS)];
    const followed = followFilter(teamKeys, FOLLOW_KEYS);
    if (followed.length === 0) continue;

    const entry = {
      date: s.sdate,
      time: s.time || '',
      league: s.league_name || (s.type === 'basketball' ? '篮球' : ''),
      home,
      away,
      homeScore: hScore,
      awayScore: aScore,
      teams: [...new Set(teamKeys)],
      source: 'zhibo8-score',
      sport: s.type, // football / basketball，合成事件时用
      url: s.url ? 'https://www.zhibo8.cc' + s.url : '',
    };
    if (!seen.has(keyOf(entry))) {
      hist.entries.push(entry);
      seen.add(keyOf(entry));
    }
  }

  // 每队只保留 MAX_PER_TEAM 场（按日期倒序）
  hist.entries.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  const bucket = {};
  const trimmed = [];
  for (const e of hist.entries) {
    let keep = false;
    for (const tk of (e.teams || [])) {
      bucket[tk] = (bucket[tk] || 0) + 1;
      if (bucket[tk] <= MAX_PER_TEAM) keep = true;
    }
    if (keep) trimmed.push(e);
  }
  hist.entries = trimmed;
  hist.updatedAt = new Date().toISOString();
  saveHistory(hist);
  console.log(`[history] 历史比分: 共 ${hist.entries.length} 条`);
  return hist;
}

function keyOf(e) {
  return `${e.date}|${normalize(e.home)}|${normalize(e.away)}|${e.homeScore||0}-${e.awayScore||0}`;
}
function normalize(s) {
  return String(s || '').replace(/\s+/g, '').replace(/足球俱乐部|FC|CF/g, '').toLowerCase();
}

// 历史比分合并回 events:
//   A. 对现有 events: 日期+双队名匹配 -> 写 score 字段
//   B. 历史里有但 events 里不存在的（赛程页已过期删除）-> 补"合成事件"（只进日期范围内才合理？不，一律 append，UI 会按日期排序）
// 返回合并后的 events 数组
function applyHistoryToEvents(events, hist, { TEAMS, FOLLOW_KEYS }) {
  const list = events.slice();
  const histMatches = new Set(hist.entries.map(keyOf));

  // 同队判定：双向 includes 能覆盖"维拉/阿斯顿维拉"这类连续简称，
  // 但覆盖不了"曼联/曼彻斯特联"这种非连续简称——后者靠命中同一关注球队 key 判定
  const sameTeam = (a, b) => {
    const na = normalize(a), nb = normalize(b);
    if (!na || !nb) return false;
    if (na.includes(nb) || nb.includes(na)) return true;
    const ka = matchKeysFromName(a, TEAMS);
    return ka.length > 0 && ka.some(k => matchKeysFromName(b, TEAMS).includes(k));
  };

  // A. 匹配已有事件
  for (const e of list) {
    if (e.score) continue; // 已有比分（如 TTBL 的）跳过
    const homeKeys = matchKeysFromName(e.home, TEAMS);
    const awayKeys = matchKeysFromName(e.away, TEAMS);
    if (followFilter([...homeKeys, ...awayKeys], FOLLOW_KEYS).length === 0) continue;
    const hit = hist.entries.find(h =>
      h.date === e.date && sameTeam(e.home, h.home) && sameTeam(e.away, h.away));
    if (hit) {
      e.score = `${hit.homeScore}-${hit.awayScore}`;
      if (!e.url && hit.url) e.url = hit.url;
    }
  }

  // B. 补赛程页上没有的历史完赛（只保留关注球队参与的）
  const existingKeys = new Set(list.map(e => `${e.date}|${normalize(e.home)}|${normalize(e.away)}`));
  for (const h of hist.entries) {
    if (followFilter(h.teams || [], FOLLOW_KEYS).length === 0) continue;
    const k = `${h.date}|${normalize(h.home)}|${normalize(h.away)}`;
    if (existingKeys.has(k)) continue;
    // 模糊查重：赛程事件可能用简称（曼联 vs 曼彻斯特联），与 A 段保持同一套匹配，
    // 否则同一天同一场比赛会既写比分又补合成事件，列表出现两条
    const dup = list.some(e =>
      e.date === h.date && sameTeam(e.home, h.home) && sameTeam(e.away, h.away));
    if (dup) continue;
    existingKeys.add(k);
    const teamKeys = [...new Set([...matchKeysFromName(h.home, TEAMS), ...matchKeysFromName(h.away, TEAMS)])];
    const isBasketball = h.sport === 'basketball';
    const category = isBasketball ? 'other' : 'football'; // 篮球合成事件归"其他"，不进足球页签
    // 子分类: 按 league 名判断
    let sub = '';
    if (/英超/.test(h.league)) sub = 'yingchao';
    else if (/西甲/.test(h.league)) sub = 'xijia';
    else if (/中超/.test(h.league)) sub = 'zhongchao';
    else if (/欧冠/.test(h.league)) sub = 'ouguan';
    const labelParts = [h.league || '', h.home, h.away, teamKeys.map(t => TEAMS.find(([,k])=>k===t)?.[0] || '').filter(Boolean).join(',')];
    list.push({
      id: 'hist-' + k,
      date: h.date,
      time: h.time,
      league: h.league || (isBasketball ? '篮球' : '足球'),
      home: h.home,
      away: h.away,
      channel: '',
      status: '已结束',
      important: false,
      type: isBasketball ? 'basketball' : 'football',
      label: labelParts.filter(Boolean).join(','),
      url: h.url || '',
      score: `${h.homeScore}-${h.awayScore}`,
      history: true,
      category,
      sub,
      teams: teamKeys,
    });
  }
  return list;
}

module.exports = { collectScoreHistory, applyHistoryToEvents, loadHistory, saveHistory, HIST_FILE };
