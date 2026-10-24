/* engine.js — 与 index.html 相同的评分引擎与话术生成器（供测试页调用） */
const THRESH = { ownGap: -5, peerGap: -3, wind: 17, badDays: 4, persist: 2 };
const W = { ownGap: 30, peerGap: 15, weather: 20, persist: 15, importance: 10, note: 10 };
const pct = v => (v * 100).toFixed(1) + '%';
function airportBaseline(ap) { return DATA.baseline.filter(b => b.airport === ap); }
function latestBaseline(ap) { const r = airportBaseline(ap); return r[r.length - 1]; }
function anomalyBaseline(ap) { const r = airportBaseline(ap); return r.reduce((a, b) => (b.gap < a.gap ? b : a), r[0]); }
function scaleOf(ap) { return DATA.scale.find(s => s.airport === ap && s.y === 2025) || DATA.scale.find(s => s.airport === ap); }
function weatherOf(ap) { return DATA.weather.filter(w => w.airport === ap); }

function scoreEvent(evt, wf) {
  wf = wf || { cap: 0, wx: 'as_forecast' };
  const ap = evt.airport;
  const latest = latestBaseline(ap), anom = anomalyBaseline(ap);
  const wxRows = weatherOf(ap);
  const wxRecent = wxRows[wxRows.length - 1];
  const wxMissing = wxRows.some(w => w.missing);
  const scale = scaleOf(ap);
  const ind = [];
  const ownGap = anom.gap;
  ind.push({ key: 'ownGap', name: '与自身12个月平均差（最劣月）', value: ownGap.toFixed(1) + ' pp', thr: '< ' + THRESH.ownGap + ' pp (RULE003)', hit: ownGap < THRESH.ownGap, w: W.ownGap, src: 'SIM-BASE', note: anom.y + '年' + anom.m + '月: ' + pct(anom.plan) + ' vs 均值 ' + pct(anom.avg12) });
  const peerGap = (latest.plan - latest.peer) * 100;
  ind.push({ key: 'peerGap', name: '与同类机场平均差（最新月）', value: peerGap.toFixed(1) + ' pp', thr: '< ' + THRESH.peerGap + ' pp', hit: peerGap < THRESH.peerGap, w: W.peerGap, src: 'SIM-BASE', note: latest.y + '年' + latest.m + '月: ' + pct(latest.plan) + ' vs 同类 ' + pct(latest.peer) });
  let wxHit = false, wxNote = '';
  const txt = (evt.weather || '') + (evt.ops || '');
  if (wf.wx === 'clears') { wxHit = false; wxNote = 'What-if: 天气转好'; }
  else if (wf.wx === 'worse') { wxHit = true; wxNote = 'What-if: 天气恶化'; }
  else {
    wxHit = /雨|雷|风|低温|雪|雾/.test(txt) || (wxRecent && (wxRecent.wind >= THRESH.wind || wxRecent.bad_days >= THRESH.badDays));
    wxNote = wxRecent ? '近期天气: 风 ' + wxRecent.wind + 'm/s, 不利天气 ' + wxRecent.bad_days + ' 天' + (wxRecent.missing ? '（缺数据）' : '') : '无天气数据';
  }
  ind.push({ key: 'weather', name: '天气风险信号', value: wxHit ? '触发' : '未触发', thr: '风>=' + THRESH.wind + 'm/s 或 不利天数>=' + THRESH.badDays + ' 或事件描述', hit: wxHit, w: W.weather, src: 'SIM-WEATHER+事件', note: wxNote });
  const persistHit = /持续|仍有|频繁|下降/.test(evt.ops || '');
  ind.push({ key: 'persist', name: '运行压力持续性', value: persistHit ? '持续' : '单次', thr: '连续>=2时段下降', hit: persistHit, w: W.persist, src: '事件描述', note: evt.ops });
  const impHit = evt.importance === '高';
  ind.push({ key: 'importance', name: '业务重要程度（影响权重）', value: evt.importance, thr: '高 = 加权', hit: impHit, w: W.importance, src: 'SIM-SCALE', note: scale.cat + ' · 吞吐 ' + scale.pax + ' 万人次' });
  let capHit = wf.cap <= -20;
  if (wf.cap !== 0) ind.push({ key: 'capacity', name: 'What-if 保障能力变化', value: wf.cap + '%', thr: '<= -20% = 触发', hit: capHit, w: W.note, src: 'What-if', note: '人工假设输入' });
  let score = ind.reduce((s, i) => s + (i.hit ? i.w : 0), 0);
  let conf = 100;
  if (wxMissing) conf -= 25;
  if (/冲突|不一致/.test((evt.known || '') + (evt.note || '') + (evt.name || ''))) conf -= 55;
  conf = Math.max(10, conf);
  let level, cls;
  if (conf < 50) { level = '无法判断'; cls = 'r-na'; }
  else if (score >= 65) { level = '高'; cls = 'r-high'; }
  else if (score >= 25) { level = '中'; cls = 'r-med'; }
  else { level = '低'; cls = 'r-low'; }
  const fluct = score < 25 && conf >= 50;
  return { ind, score, conf, level, cls, fluct, latest, anom, wxMissing };
}

const HUMAN_POINTS = ['航班取消', '放行至起飞', '调度变更', '维修决定', '赔付方案', '正式旅客通知发布'];

function msgOps(evt, r) {
  return '【内部运行提示 · 模拟】' + evt.airport + '：' + evt.name + '（' + evt.time + '）。\n' +
    '风险评分 ' + (r.conf < 50 ? '无法判断' : r.score + ' 分 / ' + r.level) + '，置信度 ' + r.conf + '%。\n' +
    '基线对比：最劣月 ' + r.anom.y + '年' + r.anom.m + '月完成率 ' + pct(r.anom.plan) + '（差 ' + r.anom.gap.toFixed(1) + ' pp，RULE003 阈值 -5pp）；最新月 ' + pct(r.latest.plan) + '。\n' +
    '已知：' + evt.known + '。假设：天气与运行为关联线索，不构成因果。\n' +
    '信息缺口：' + evt.unknown + '。\n' +
    '请按行动清单顺序核查，重大决定（取消/放行/调度/赔付/正式发布）必须由专业人员作出。';
}
function msgPax(evt) {
  return '【旅客信息草案 · 模拟】\n' + evt.airport + ' 近期可能受' + (/雨|雷|风|低温/.test(evt.weather) ? '天气' : '运行') + '情况影响。\n' +
    '当前航班状态请以航空公司正式通知为准，建议出行前查询最新动态。\n（本草案仅含已确认事实，不含推测；未经人工审核不得发布。）';
}
