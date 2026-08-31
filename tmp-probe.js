const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const H = { 'User-Agent': UA, 'Accept': 'application/json', 'Origin': 'https://www.worldtabletennis.com', 'Referer': 'https://www.worldtabletennis.com/' };
const SCORE = 'https://wtt-website-api-vm-frontdoor-hhaec5epbhdyfugz.a01.azurefd.net/liveeventsapi/api/';

(async () => {
  // 3247 = WTT Contender Almaty 2026 (9-1~9-6 明天开始)
  const res = await fetch(SCORE + 'cms/GetOfficialResult?EventId=3247&DocumentCode=MS&include_match_card=true', { headers: H });
  const text = await res.text();
  console.log('status:', res.status, 'len:', text.length);
  if (text.length > 2) {
    const data = JSON.parse(text);
    console.log('条数:', data.length);
    if (data[0]) {
      const m = data[0];
      console.log('首场时间:', m.startDateLocal, '状态:', m.fullResults);
      if (m.match_card) {
        console.log('对阵:', m.match_card.competitiors.map(c => c.competitiorName).join(' vs '));
        console.log('描述:', m.match_card.subEventDescription);
      }
    }
  } else console.log('空数组（可能抽签未出或接口只返回已完赛）');

  // 再试试 GetEventSchedule（之前3245返回空，试试未来的3247）
  await new Promise(r => setTimeout(r, 1500));
  const res2 = await fetch(SCORE + 'cms/GetEventSchedule/3247', { headers: H });
  const text2 = await res2.text();
  console.log('\nGetEventSchedule/3247 →', res2.status, 'len:', text2.length);
  if (text2.length > 2) {
    const d2 = JSON.parse(text2);
    console.log('条数:', Array.isArray(d2) ? d2.length : 'obj', '首条:', JSON.stringify(Array.isArray(d2) ? d2[0] : d2).slice(0, 500));
  }
})();
