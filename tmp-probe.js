const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const H = { 'User-Agent': UA, 'Accept': 'application/json', 'Origin': 'https://www.worldtabletennis.com', 'Referer': 'https://www.worldtabletennis.com/' };
const SCORE = 'https://wtt-website-api-vm-frontdoor-hhaec5epbhdyfugz.a01.azurefd.net/liveeventsapi/api/';
const API = 'https://wtt-website-api-vm-frontdoor-hhaec5epbhdyfugz.a01.azurefd.net/primary/api/';
const FD = 'https://wtt-web-frontdoor-cthahjeqhbh6aqe3.a01.azurefd.net/';

(async () => {
  // 1. 看 JS 里 SCHEDULED 页签用什么接口: 找 GetPreMatchCardList 定义
  const js = await (await fetch('https://www.worldtabletennis.com/main.6e8be00e5055a6b92b58.js', { headers: H })).text();
  for (const kw of ['prototype.GetPreMatchCardList=', 'prototype.GetLiveMatches=']) {
    let i = js.indexOf(kw);
    if (i !== -1) console.log('--- [' + kw + ']:', js.slice(i, i + 450).replace(/\s+/g, ' '), '\n');
  }

  // 2. 试 Almaty(3247, 9-1开始) 的各种未来数据接口
  const tries = [
    ['running-events/3247 livematchids', FD + 'websitestaticapifiles/running-events/3247/3247_livematchids.json'],
    ['GetLiveMatches?EventId=3247', SCORE + 'cms/GetLiveResult?EventId=3247'],
    ['GetPreMatchCardList?EventId=3247', SCORE + 'cms/GetPreMatchCardList?EventId=3247'],
    ['event_provisional_schedule/3247', SCORE + 'cms/event_provisional_schedule/list/3247'],
    ['GetEventDraws/3247', SCORE + 'cms/GetEventDraws/3247'],
  ];
  for (const [name, url] of tries) {
    const res = await fetch(url, { headers: H });
    const text = await res.text();
    console.log('===', name, '→', res.status, 'len:', text.length);
    if (text.length > 2 && text.length < 3000) console.log('  ', text.slice(0, 400).replace(/\s+/g, ' '));
    else if (text.length >= 3000) console.log('  前400字:', text.slice(0, 400).replace(/\s+/g, ' '));
    await new Promise(r => setTimeout(r, 1200));
  }
})();
