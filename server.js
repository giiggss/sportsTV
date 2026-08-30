// 直播吧赛事 API + 静态服务（零依赖，Node 18+）
// 爬取逻辑在 crawler.js（本地定时爬取与 GitHub Actions 共用）
// 每天 0 点后自动爬取一次；启动时若数据过期（超过6小时或非当天）也会先爬取

const http = require('http');
const fs = require('fs');
const path = require('path');
const { crawl, loadData, isStale, SUB_KEYS, TEAM_KEYS } = require('./crawler');

const PORT = process.env.PORT || 3000;

// ---------------- 每日定时 ----------------
function scheduleDaily() {
  setInterval(() => {
    const now = new Date();
    if (now.getHours() === 0 && now.getMinutes() < 5) {
      crawl().catch(e => console.error('[crawl] 失败:', e.message));
    }
  }, 5 * 60 * 1000).unref(); // 每5分钟检查一次是否跨天
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
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
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

  // 静态文件
  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.join(__dirname, 'public', path.normalize(file).replace(/^([.][.][\\/])+/, ''));
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
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
})();

server.listen(PORT, () => {
  console.log(`赛事页面已启动: http://localhost:${PORT}`);
});
