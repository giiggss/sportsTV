// 直播吧实时比分模块
// 数据源: bifen4m.qiumibao.com/json/list.htm —— 返回当前所有比赛(含进行中)的实时比分
// 用途: 本地服务每分钟轮询，匹配关注球队的比赛，比分变化时推送提醒
const fs = require('fs');
const path = require('path');

const SCORE_URL = 'https://bifen4m.qiumibao.com/json/list.htm';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
const LIVE_BASE = 'https://www.zhibo8.cc';

const STATE_FILE = path.join(__dirname, 'data', 'score-state.json');

// 拉取比分接口，返回原始比赛列表
async function fetchLiveScores() {
  const res = await fetch(SCORE_URL, {
    headers: {
      'User-Agent': UA,
      'Referer': 'https://m.zhibo8.com/',
      'Accept': 'application/json, text/plain, */*',
    },
  });
  if (!res.ok) throw new Error(`比分接口 HTTP ${res.status}`);
  const j = await res.json();
  return j.list || [];
}

// 从 events.json 取关注球队比赛，在比分接口里匹配出"进行中(state=2)"的比赛
// 匹配规则: 比分条目的 sdate 与赛程日期相同 + football + home/away 队名互相包含
// 注意: 不过滤赛程"是否今天"——跨午夜仍在进行的比赛(如23:30开赛)日期已不是今天，
//       实际日期匹配由 sdate === e.date 完成
function matchFollowedLive(scoreList, events) {
  const followed = (Array.isArray(events) ? events : [])
    .filter(e => Array.isArray(e.teams) && e.teams.length > 0);

  const live = [];
  for (const e of followed) {
    const hit = scoreList.find(s => {
      if (s.sdate !== e.date || (s.type !== 'football' && s.type !== 'basketball')) return false; // 足球+篮球都认
      const h = s.home_team || '', v = s.visit_team || '';
      // 队名互相包含：应对"切尔西"完全一致或细微差异
      const homeMatch = h.includes(e.home) || e.home.includes(h);
      const awayMatch = v.includes(e.away) || e.away.includes(v);
      // 至少主队或客队能匹配上（单边即可，防止换边）
      return homeMatch || awayMatch;
    });
    // 进行中(state=2)和已完赛(state=3)都要——完赛用于推送完场提醒
    if (hit && (hit.state === '2' || hit.state === '3')) {
      live.push({
        id: hit.id,
        home: hit.home_team,
        away: hit.visit_team,
        homeScore: String(hit.home_score),
        awayScore: String(hit.visit_score),
        period: hit.period_cn,
        state: hit.state,
        url: hit.url ? LIVE_BASE + hit.url : '',
        event: e, // 回指赛程条目，供爬虫把比分写回 events.json
      });
    }
  }
  return live;
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

module.exports = { fetchLiveScores, matchFollowedLive, loadState, saveState, STATE_FILE };
