// Server酱微信推送（仅云端 GitHub Actions 使用，本地不推送）
// 用法:
//   node notify.js card       推送当日关注球队赛事卡片
//   node notify.js reminders  检查并发送赛前提醒（开赛前30分/前10分/开赛时），带状态去重
//   node notify.js score      检查关注球队进行中比赛的比分变化，变化即推送
// 可加 --dry 只打印不发送；需环境变量 SERVERCHAN_KEY（Server酱 SendKey）
const fs = require('fs');
const path = require('path');
const { pickFollowedDay } = require('./crawler');
const { fetchLiveScores, matchFollowedLive, loadState: loadScoreState, saveState: saveScoreState } = require('./score');

const DATA_DIR = path.join(__dirname, 'data');
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
const STATE_FILE = path.join(DATA_DIR, 'notify-state.json');
const CARD_URL = 'https://giiggss.github.io/sportsTV/data/card.html';
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

const DRY = process.argv.includes('--dry');
const MODE = process.argv[2] || 'card';
const KEY = process.env.SERVERCHAN_KEY;

// ---------------- 工具 ----------------
// 当前北京时间（Actions 服务器是 UTC，统一换算）
function beijingNow() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return {
    date: d.toISOString().slice(0, 10),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

function fmtTime(mins) {
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

function parseTime(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '').trim());
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

function weekOf(dateStr) {
  return '周' + WEEK[new Date(dateStr + 'T00:00:00Z').getUTCDay()];
}

function escMd(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function matchLabel(e) {
  return e.home && e.away ? `${e.home} vs ${e.away}` : (e.league || '赛事');
}

function channelOf(e) {
  const c = (e.channel || '').split(/\s+/).slice(0, 2).join(' ');
  return c.length > 9 ? c.slice(0, 8) + '…' : c;
}

// ---------------- Server酱 ----------------
// 兼容两代接口：
//   Server酱³（key 以 sctp 开头）: https://<uid>.push.ft07.com/send/<key>.send
//   Server酱Turbo（key 以 SCT 开头）: https://sctapi.ftqq.com/<key>.send
function sendUrl(key) {
  if (/^sctp\d+/.test(key)) {
    const uid = key.slice(4).match(/^\d+/)[0];
    return `https://${uid}.push.ft07.com/send/${key}.send`;
  }
  return `https://sctapi.ftqq.com/${key}.send`;
}

async function sendServerChan(key, title, desp) {
  const res = await fetch(sendUrl(key), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ title, desp }),
  });
  const j = await res.json();
  if (j.code !== 0) throw new Error(j.message || ('code ' + j.code));
  return j;
}

// ---------------- 每日卡片推送 ----------------
function buildCardMessage(data) {
  const { today, day, dayEvents } = pickFollowedDay(data.events);
  const isToday = day === today;
  const dateText = `${day.slice(5, 7)}月${day.slice(8, 10)}日 ${weekOf(day)}`;
  const sorted = dayEvents.slice().sort((a, b) =>
    (b.important ? 1 : 0) - (a.important ? 1 : 0) ||
    (a.time || '').localeCompare(b.time || ''));

  const title = isToday
    ? `今日赛事 ${dateText}（${dayEvents.length}场）`
    : `近期赛事 ${dateText}（${dayEvents.length}场）`;

  const lines = sorted.map(e => {
    const ch = channelOf(e);
    return `- **${e.time || '--'}** ${escMd(e.league)}｜${escMd(matchLabel(e))}${ch ? `（${escMd(ch)}）` : ''}`;
  });

  const desp = (dayEvents.length === 0
    ? '今天关注球队没有比赛。'
    : `## ${isToday ? '今日' : '近期'}赛事（我的球队）\n\n${lines.join('\n')}`)
    + `\n\n[打开完整卡片](${CARD_URL})`;

  return { title: title.slice(0, 32), desp };
}

// ---------------- 赛前提醒 ----------------
// 返回 {messages, state, changed}
function findDueReminders(data, state) {
  const bj = beijingNow();
  const { followed } = pickFollowedDay(data.events);
  // 状态按天清理，只保留今天的
  const sent = new Set((state.sent || []).filter(k => k.startsWith(bj.date)));
  const messages = [];

  for (const e of followed) {
    if (e.date !== bj.date) continue;
    const start = parseTime(e.time);
    if (start === null) continue;
    const diff = start - bj.minutes; // 距开赛的分钟数
    const id = `${e.date} ${e.time} ${e.home}|${e.away}`;

    // 提醒窗口放宽到 ±10 分钟，配合 Actions 每5分钟一次的检查频率；
    // 状态去重保证每场每种提醒只发一次
    if (diff >= 20 && diff <= 40 && !sent.has(id + ':m30')) {
      sent.add(id + ':m30');
      const ch = channelOf(e);
      messages.push({
        title: `⏰约30分钟后开赛：${matchLabel(e)}`.slice(0, 32),
        desp: `**${e.time}** ${escMd(e.league)}\n\n${escMd(matchLabel(e))}${ch ? `\n\n直播：${escMd(ch)}` : ''}\n\n[打开今日卡片](${CARD_URL})`,
        id,
      });
    }
    if (diff >= 5 && diff <= 15 && !sent.has(id + ':m10')) {
      sent.add(id + ':m10');
      const ch = channelOf(e);
      messages.push({
        title: `⏰约10分钟后开赛：${matchLabel(e)}`.slice(0, 32),
        desp: `**${e.time}** ${escMd(e.league)}\n\n${escMd(matchLabel(e))}${ch ? `\n\n直播：${escMd(ch)}` : ''}\n\n[打开今日卡片](${CARD_URL})`,
        id,
      });
    }
    if (diff <= 0 && diff >= -10 && !sent.has(id + ':live')) {
      sent.add(id + ':live');
      const ch = channelOf(e);
      messages.push({
        title: `🔴已开赛：${matchLabel(e)}`.slice(0, 32),
        desp: `比赛已经开始了，去看球吧！\n\n${escMd(matchLabel(e))}${ch ? `\n\n直播：${escMd(ch)}` : ''}\n\n[打开今日卡片](${CARD_URL})`,
        id,
      });
    }
  }

  return {
    messages,
    state: { sent: [...sent].sort() },
    changed: JSON.stringify(state) !== JSON.stringify({ sent: [...sent].sort() }),
  };
}

// ---------------- 主流程 ----------------
function loadData() {
  try {
    return JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { sent: [] };
  }
}

function saveState(state) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

// 推送当日卡片。opts.key 缺省取环境变量 SERVERCHAN_KEY
async function runCard(opts = {}) {
  const key = opts.key || KEY;
  const data = loadData();
  if (!data) throw new Error('暂无赛程数据');
  const { title, desp } = buildCardMessage(data);
  if (DRY && !opts.force) {
    console.log(`[dry] title: ${title}\n${desp}`);
    return { sent: 0 };
  }
  if (!key) throw new Error('未配置 SERVERCHAN_KEY');
  await sendServerChan(key, title, desp);
  console.log(`[notify] 卡片已推送: ${title}`);
  return { sent: 1 };
}

// 检查并发送到期提醒（含状态去重落盘）。本地与云端共用同一状态文件
async function runReminders(opts = {}) {
  const key = opts.key || KEY;
  const data = loadData();
  if (!data) return { sent: 0 };
  const { messages, state } = findDueReminders(data, loadState());
  if (DRY && !opts.force) {
    const bj = beijingNow();
    console.log(`[dry] 北京时间 ${bj.date} ${fmtTime(bj.minutes)}，到期提醒 ${messages.length} 条`);
    for (const m of messages) console.log(`[dry] title: ${m.title}\n${m.desp}\n`);
    return { sent: 0 };
  }
  if (!key) throw new Error('未配置 SERVERCHAN_KEY');
  for (const m of messages) {
    await sendServerChan(key, m.title, m.desp);
    console.log(`[notify] 已发送: ${m.title}`);
  }
  saveState(state);
  return { sent: messages.length };
}

// 关注球队是否有比赛可能正在进行中（开赛前后共240分钟窗口，覆盖加时赛），用于预判是否需要拉取比分接口
// 用开赛时间戳比较，正确处理跨午夜的比赛（如23:30开赛、凌晨仍在进行）
function hasFollowedMaybeLive(events) {
  const now = Date.now();
  const list = (Array.isArray(events) ? events : [])
    .filter(e => Array.isArray(e.teams) && e.teams.length > 0);
  for (const e of list) {
    const t = parseTime(e.time);
    if (t === null) continue;
    const hh = String(Math.floor(t / 60)).padStart(2, '0');
    const mm = String(t % 60).padStart(2, '0');
    const kickoff = Date.parse(`${e.date}T${hh}:${mm}:00+08:00`);
    if (Number.isNaN(kickoff)) continue;
    const diffMin = (now - kickoff) / 60000;
    if (diffMin >= -5 && diffMin <= 240) return true;
  }
  return false;
}

// 检查关注球队进行中比赛的比分变化，变化即推送（比分状态独立存 data/score-state.json）
// 预判: 没有关注比赛进行中时不请求比分接口，避免无谓爬取其他比赛
async function runScoreUpdates(opts = {}) {
  const key = opts.key || KEY;
  const data = loadData();
  if (!data) return { sent: 0 };
  if (!hasFollowedMaybeLive(data.events)) return { sent: 0 };
  const scoreList = await fetchLiveScores();
  const live = matchFollowedLive(scoreList, data.events);
  const state = loadScoreState();
  const liveIds = new Set(live.map(m => m.id));
  const messages = [];

  for (const m of live) {
    const prev = state[m.id];
    const isHT = m.state === '2' && /中场/.test(m.period || '');
    const isFT = m.state === '3' || /完赛|完场/.test(m.period || '');
    // 比分变化（完场后不再重复推送比分）
    if (prev && !isFT && (prev.home !== m.homeScore || prev.away !== m.awayScore)) {
      messages.push({
        title: `⚽ ${m.home} ${m.homeScore}-${m.awayScore} ${m.away}`.slice(0, 50),
        desp: `**比分变化**\n\n${m.home} **${m.homeScore}-${m.awayScore}** ${m.away}\n\n${m.period}${m.url ? `\n\n[观看直播](${m.url})` : ''}\n\n[打开今日卡片](${CARD_URL})`,
      });
    }
    // 半场（中场休息时推送一次）
    if (prev && !prev.ht && isHT) {
      messages.push({
        title: `📋 半场 ${m.home} ${m.homeScore}-${m.awayScore} ${m.away}`.slice(0, 50),
        desp: `**半场比分**\n\n${m.home} **${m.homeScore}-${m.awayScore}** ${m.away}\n\n中场休息${m.url ? `\n\n[观看直播](${m.url})` : ''}\n\n[打开今日卡片](${CARD_URL})`,
      });
    }
    // 完赛（全场比赛结束时推送最终比分）
    if (prev && !prev.ft && isFT) {
      messages.push({
        title: `🏁 完赛 ${m.home} ${m.homeScore}-${m.awayScore} ${m.away}`.slice(0, 50),
        desp: `**全场比赛结束**\n\n${m.home} **${m.homeScore}-${m.awayScore}** ${m.away}\n\n最终比分${m.url ? `\n\n[观看直播](${m.url})` : ''}\n\n[打开今日卡片](${CARD_URL})`,
      });
    }
    state[m.id] = {
      home: m.homeScore,
      away: m.awayScore,
      ht: Boolean((prev && prev.ht) || isHT),
      ft: Boolean((prev && prev.ft) || isFT),
    };
  }
  // 清理已结束比赛的状态（不在当前进行中列表的 id）
  for (const id of Object.keys(state)) {
    if (!liveIds.has(id)) delete state[id];
  }

  if (DRY && !opts.force) {
    console.log(`[dry] 进行中关注比赛 ${live.length} 场，比分变化 ${messages.length} 条`);
    for (const m of live) console.log(`[dry] ${m.home} ${m.homeScore}-${m.awayScore} ${m.away} (${m.period})`);
    for (const m of messages) console.log(`[dry] 推送: ${m.title}`);
    saveScoreState(state);
    return { sent: 0 };
  }
  if (!key) throw new Error('未配置 SERVERCHAN_KEY');
  for (const m of messages) {
    await sendServerChan(key, m.title, m.desp);
    console.log(`[notify] 比分变化: ${m.title}`);
  }
  saveScoreState(state);
  return { sent: messages.length };
}

async function main() {
  if (MODE === 'card') return runCard();
  if (MODE === 'reminders') return runReminders();
  if (MODE === 'score') return runScoreUpdates();
  throw new Error(`未知模式: ${MODE}（可用: card / reminders / score）`);
}

// 仅直接运行时才执行主流程（require 时不执行，便于测试）
if (require.main === module) {
  main().catch(e => {
    console.error('推送失败:', e.message);
    process.exit(1);
  });
}

module.exports = { sendServerChan, sendUrl, buildCardMessage, findDueReminders, beijingNow, runCard, runReminders, runScoreUpdates };
