// 查曼联 vs 伊普斯维奇 实际比分
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

(async () => {
  // 1. 比分接口（可能已清除8-30的）
  try {
    const res = await fetch('https://bifen4m.qiumibao.com/json/list.htm', { headers: { 'User-Agent': UA } });
    const data = await res.json();
    const list = data.list || [];
    const m = list.filter(s => /曼联|伊普斯/.test((s.home_team || '') + (s.visit_team || '')));
    console.log('比分接口曼联相关:', m.length ? JSON.stringify(m, null, 1) : '无(已被清除)');
  } catch (e) { console.log('比分接口失败:', e.message); }

  // 2. 直播吧 PC 版赛果页（英超第2轮赛果）
  for (const url of [
    'https://www.zhibo8.cc/zuqiu/yingchao/htm/match0.htm', // 赛果
    'https://soccer.zhibo8.com/zuqiu/yingchao/',
  ]) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36' } });
      const html = await res.text();
      console.log('\n===', url, res.status, 'len:', html.length);
      const i = html.indexOf('曼联');
      if (i === -1) { console.log('页面无曼联字样'); continue; }
      // 找曼联附近的比分
      const seg = html.slice(Math.max(0, i - 400), i + 400).replace(/\s+/g, ' ');
      console.log('曼联上下文:', seg);
    } catch (e) { console.log('\n===', url, '失败:', e.message); }
  }
})();
