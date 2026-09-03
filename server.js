// 直播吧赛事 API + 静态服务（零依赖，Node 18+）
// 爬取逻辑在 crawler.js（本地定时爬取与 GitHub Actions 共用）
// 每天 0 点后自动爬取一次；启动时若数据过期（超过6小时或非当天）也会先爬取

const http = require('http');
const fs = require('fs');
const path = require('path');
const { crawl, loadData, isStale, SUB_KEYS, TEAM_KEYS } = require('./crawler');
const { runReminders, runScoreUpdates, runTTUpdates, runCard } = require('./notify');

const PORT = process.env.PORT || 3000;

// ---------------- 本地 Server酱 推送 ----------------
// 读取本地 config.json（gitignore，不入库）: { "serverchanKey": "sctp..." }
// 电脑开着且本服务运行时:
//   - 每分钟检查赛前提醒（开赛前30分/前10分/开赛时）
//   - 每分钟检查关注球队进行中比赛的比分变化，变化即推送
function loadConfig() {
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  } catch {}
  // Docker 部署约定用环境变量传配置，没有 config.json 时从 env 兜底
  if (!cfg.serverchanKey && process.env.SERVERCHAN_KEY) cfg.serverchanKey = process.env.SERVERCHAN_KEY;
  if (cfg.localReminders === undefined && process.env.LOCAL_REMINDERS) cfg.localReminders = process.env.LOCAL_REMINDERS === 'true';
  return cfg;
}

function scheduleReminders() {
  const cfg = loadConfig();
  const key = cfg.serverchanKey;
  if (!key) {
    console.log('[notify] config.json 未配置 serverchanKey，本地提醒未启用（云端照常）');
    return;
  }
  // 赛前提醒默认交云端（GitHub Actions），避免本地+云端重复推送
  // 如需本地赛前提醒（云端不可靠时），把 config.json 的 localReminders 设为 true
  if (cfg.localReminders !== true) {
    console.log('[notify] 本地赛前提醒已关闭（交云端，避免重复）');
    return;
  }
  console.log('[notify] 本地赛前提醒已启用');
  setInterval(() => {
    runReminders({ key }).catch(e => console.error('[notify] 赛前提醒失败:', e.message));
  }, 60 * 1000).unref();
}

function scheduleScoreUpdates() {
  const key = loadConfig().serverchanKey;
  if (!key) {
    console.log('[notify] config.json 未配置 serverchanKey，比分变化提醒未启用');
    return;
  }
  console.log('[notify] 本地比分变化提醒已启用（45~75秒随机间隔）');
  const tick = () => {
    runScoreUpdates({ key })
      .catch(e => console.error('[notify] 比分检查失败:', e.message))
      .finally(() => {
        const delay = 45000 + Math.floor(Math.random() * 30000);
        setTimeout(tick, delay).unref();
      });
  };
  setTimeout(tick, 5000).unref();
}

// 德乒甲局分提醒：官方页面较重(约250KB)，仅在关注比赛时段轮询，100~140秒随机间隔
function scheduleTTUpdates() {
  const key = loadConfig().serverchanKey;
  if (!key) return;
  console.log('[notify] 德乒甲局分提醒已启用（100~140秒随机间隔，仅比赛时段轮询）');
  const tick = () => {
    runTTUpdates({ key })
      .catch(e => console.error('[notify] ttbl 检查失败:', e.message))
      .finally(() => {
        const delay = 100000 + Math.floor(Math.random() * 40000);
        setTimeout(tick, delay).unref();
      });
  };
  setTimeout(tick, 30000).unref();
}

// ---------------- 每日定时 ----------------
function scheduleDaily() {
  setInterval(() => {
    const now = new Date();
    if (now.getHours() === 0 && now.getMinutes() < 5) {
      crawl().catch(e => console.error('[crawl] 失败:', e.message));
    }
  }, 5 * 60 * 1000).unref(); // 每5分钟检查一次是否跨天
}

// 每日 10:00（北京时，容器已设 TZ=Asia/Shanghai）推送当日赛事卡片
// 接管原 GitHub Actions daily-push.yml 的职责（云端推送已于 2026-09-03 停用）
function scheduleDailyCard() {
  const key = loadConfig().serverchanKey;
  if (!key) return;
  setInterval(() => {
    const now = new Date();
    if (now.getHours() === 10 && now.getMinutes() < 5) {
      runCard({ key }).catch(e => console.error('[notify] 每日卡片推送失败:', e.message));
    }
  }, 5 * 60 * 1000).unref();
}

// ---------------- HTTP 服务 ----------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/events') {
    let data = loadData();
    if (isStale(data)) {
      try {
        data = await crawl();
      } catch (e) {
        console.error('[crawl] 失败:', e.message);
      }
    }
    const category = url.searchParams.get('category') || 'all'; // all|football|pingpong|lol|recommended|...
    const date = url.searchParams.get('date'); // yyyy-MM-dd，空=全部日期
    let events = data ? data.events : [];
    if (date) events = events.filter(e => e.date === date);
    if (category === 'recommended') {
      events = events.filter(e => ['football', 'pingpong', 'lol'].includes(e.category) && e.important);
    } else if (SUB_KEYS.includes(category)) {
      events = events.filter(e => e.category === 'football' && e.sub === category);
    } else if (TEAM_KEYS.includes(category)) {
      events = events.filter(e => e.teams && e.teams.includes(category));
    } else if (category !== 'all') {
      events = events.filter(e => e.category === category);
    }
    // 排序：日期 + 时间
    events.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    const today = new Date();
    const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({
      crawledAt: data ? data.crawledAt : null,
      total: events.length,
      today: ymd,
      events,
    }));
    return;
  }

  if (url.pathname === '/api/crawl') {
    try {
      await crawl();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // 静态文件（仓库根目录，与 GitHub Pages 发布结构一致）
  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.join(__dirname, path.normalize(file).replace(/^([.][.][\\/])+/, ''));
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
});

// ---------------- 启动 ----------------
(async () => {
  const data = loadData();
  if (isStale(data)) {
    try {
      await crawl();
    } catch (e) {
      console.error('[crawl] 启动爬取失败:', e.message);
    }
  } else {
    console.log(`[data] 使用本地缓存（爬取于 ${new Date(data.crawledAt).toLocaleString('zh-CN')}）`);
  }
  scheduleDaily();
  scheduleDailyCard();
  scheduleReminders();
  scheduleScoreUpdates();
  scheduleTTUpdates();
})();

server.listen(PORT, () => {
  console.log(`赛事页面已启动: http://localhost:${PORT}`);
});
