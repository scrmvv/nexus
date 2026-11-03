import { Globe } from './globe.js';

const $ = id => document.getElementById(id);
const globe = new Globe($('globe'));
const DEMO_CITIES = [
  { lat: 52.52, lon: 13.405 }, { lat: 40.71, lon: -74.0 }, { lat: 55.75, lon: 37.62 },
  { lat: 35.68, lon: 139.69 }, { lat: 48.85, lon: 2.35 }, { lat: 51.5, lon: -0.12 },
  { lat: -23.55, lon: -46.63 }, { lat: 1.35, lon: 103.82 }, { lat: 25.2, lon: 55.27 },
];
const DEMO_SITE = 'scrmvv.space';
const DEMO_SERVER = { lat: 60.17, lon: 24.94 };
let seq = 0;
let mode = 'demo';
let explicitDemo = false;
let connected = false;
let filter = 'all';
let live = null;
let demo = createDemo();
let renderedGeoFor = null;
let renderPending = false;
let networkStream;
function createDemo() {
  const now = Date.now();
  return {
    config: { siteLabel: DEMO_SITE, siteUrl: 'https://scrmvv.space', vpsLabel: 'Demo VPS' },
    metrics: { at: now, cpuPercent: 23, memory: { usedPercent: 48, totalBytes: 1024 ** 3, usedBytes: 512 * 1024 ** 2 }, disk: { usedPercent: 33, totalBytes: 12 * 1024 ** 3, usedBytes: 4 * 1024 ** 3 }, network: { rxBps: 63422, txBps: 14830 }, uptimeSec: 124813, load: .38 },
    traffic: { rpm: 11, errors: 1, totalSinceStart: 11 },
    health: { nginx: 'up', site: { status: 'up', code: 200, latencyMs: 39 }, logReadable: true, geoEnabled: true, serverGeo: DEMO_SERVER },
    events: [],
    history: Array.from({ length: 48 }, (_, i) => ({ time: now - (47-i)*2000, cpu: 15 + Math.round(9 * Math.abs(Math.sin(i*.35)) + 4*Math.abs(Math.sin(i*1.21))), ram: 47 + Math.round(3 * Math.sin(i*.12)) })),
  };
}
const demoPaths = ['/','/portfolio','/assets/app.css','/projects','/favicon.ico','/api/status','/wp-admin','/about','/contacts'];
function addDemoEvent() {
  const city = DEMO_CITIES[Math.floor(Math.random()*DEMO_CITIES.length)];
  const status = Math.random() < .13 ? 404 : 200;
  const path = demoPaths[Math.floor(Math.random()*demoPaths.length)];
  const suspicious = path === '/wp-admin';
  const event = { id: 'demo-'+(++seq), at: Date.now(), method: 'GET', path, status: suspicious ? 403 : status, suspicious, geo: city };
  demo.events.unshift(event);
  if (demo.events.length > 90) demo.events.pop();
  demo.traffic.rpm = demo.events.filter(e => Date.now()-e.at < 60000).length;
  demo.traffic.errors = demo.events.filter(e => Date.now()-e.at < 60000 && e.status >= 400).length;
  demo.traffic.totalSinceStart++;
  demo.metrics.cpuPercent = Math.min(100, Math.max(8, demo.metrics.cpuPercent + Math.round(Math.random()*12-6)));
  demo.metrics.memory.usedPercent = Math.min(92, Math.max(43, demo.metrics.memory.usedPercent + Math.round(Math.random()*3-1)));
  demo.metrics.network.rxBps = Math.round(10000+Math.random()*140000);
  demo.metrics.network.txBps = Math.round(5000+Math.random()*27000);
  demo.metrics.uptimeSec += 2;
  demo.history.push({ time: Date.now(), cpu: demo.metrics.cpuPercent, ram: demo.metrics.memory.usedPercent });
  if (demo.history.length > 48) demo.history.shift();
  if (mode === 'demo') { globe.addArc(city, event.status); triggerTopology(); scheduleRender(); }
}
function current() { return mode === 'demo' ? demo : live; }
function formatBytes(bytes, decimals = 1) {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '—';
  const units = ['Б','КБ','МБ','ГБ','ТБ'];
  let value = bytes, unit = 0;
  while (Math.abs(value) >= 1024 && unit < units.length-1) { value /= 1024; unit++; }
  return `${value.toFixed(unit ? decimals : 0)} ${units[unit]}`;
}
function formatSpeed(bytes) {
  if (!Number.isFinite(bytes)) return ['—','КБ/С'];
  return bytes >= 1024**2 ? [(bytes/1024**2).toFixed(2), 'МБ/С'] : [(bytes/1024).toFixed(1),'КБ/С'];
}
function formatUptime(sec) {
  if (!Number.isFinite(sec)) return '—';
  const d = Math.floor(sec/86400), h=Math.floor(sec%86400/3600), m=Math.floor(sec%3600/60);
  return d ? `${d} д ${h} ч` : `${h} ч ${m} мин`;
}
function setText(id, value) { const e=$(id); if(e)e.textContent=String(value); }
function setBar(id,value) { const e=$(id); if (e) e.style.width=`${Math.max(0,Math.min(100,Number(value)||0))}%`; }
function setStatus(id,value) {
  const element=$(id);if(!element)return;
  element.className='topo-state'+(value==='down'?' down':value==='unknown'?' unknown':'');
  element.textContent='●';element.title=value==='up'?'Работает':value==='down'?'Не работает':'Нет данных';
}
function setMode(next) {
  mode=next;
  const active=current();
  globe.setServer(active?.health?.serverGeo || null);
  renderedGeoFor=next;
  const btn=$('demo-switch');
  btn.textContent=next==='demo'?'ДЕМО: ВКЛ':'ДЕМО: ВЫКЛ';
  btn.style.borderColor=next==='demo'?'#aa8653':'#284054';
  scheduleRender();
}
function triggerTopology() {
  const nodes=document.querySelectorAll('.topo-node');
  nodes.forEach(node=>node.classList.add('activity'));
  clearTimeout(triggerTopology.timeout);
  triggerTopology.timeout=setTimeout(()=>nodes.forEach(node=>node.classList.remove('activity')),620);
}
function drawHistory(points) {
  const data=(points||[]).slice(-48);
  if(!data.length){$('cpu-line').setAttribute('d','');$('ram-line').setAttribute('d','');$('cpu-fill').setAttribute('d','');return;}
  const path=key=>data.map((p,i)=>`${i?'L':'M'}${(i/Math.max(data.length-1,1)*460).toFixed(1)},${(165-(Math.min(100,Math.max(0,p[key]||0))/100)*158).toFixed(1)}`).join(' ');
  const cpu=path('cpu');
  $('cpu-line').setAttribute('d',cpu);$('ram-line').setAttribute('d',path('ram'));
  $('cpu-fill').setAttribute('d',`${cpu} L460,165 L0,165 Z`);
}
function drawRequestBars(events) {
  const start=Date.now()-60000;
  const bars=Array.from({length:14},()=>0);
  for(const ev of events){if(ev.at>=start){const idx=Math.floor((ev.at-start)/60000*14);bars[Math.min(13,Math.max(0,idx))]++;}}
  const max=Math.max(2,...bars),root=$('rpm-bars');
  root.replaceChildren();
  for(const count of bars){const bar=document.createElement('i');bar.style.height=`${Math.max(15,Math.round(100*count/max))}%`;root.append(bar);}
}
function drawEvents(events) {
  const matched=(events||[]).filter(e=>filter==='all'||(filter==='errors'&&e.status>=400)||(filter==='suspicious'&&e.suspicious));
  setText('event-count',String(matched.length).padStart(2,'0'));
  const list=$('events-list');list.replaceChildren();
  if(!matched.length){const empty=document.createElement('div');empty.className='empty-state';empty.textContent=filter==='all'?'Пока нет новых запросов. Открой сайт в другой вкладке, чтобы увидеть событие.':'По этому фильтру событий нет';list.append(empty);return;}
  for(const e of matched.slice(0,90)){
    const row=document.createElement('div');row.className='event-row';
    const time=document.createElement('div');time.className='event-time';
    time.textContent=new Date(e.at).toLocaleTimeString('ru-RU',{hour12:false});
    const method=document.createElement('span');method.className='event-method';method.textContent=' '+e.method;time.append(method);
    const path=document.createElement('span');path.className='event-path';path.title=e.path;path.textContent=e.path;
    const code=document.createElement('span');code.className='event-code'+(e.status>=500?' error':e.status>=400?' warn':'');code.textContent=e.status;
    row.append(time,path,code);list.append(row);
  }
}
function drawUI() {
  renderPending=false;
  const state=current(); if(!state) return;
  const m=state.metrics||{};const h=state.health||{};const t=state.traffic||{};
  const isDemo=mode==='demo';
  const con=$('connection');
  con.innerHTML='';const led=document.createElement('i');led.className='led '+(isDemo?'waiting':connected?'':'off');con.append(led,document.createTextNode(isDemo?' DEMO DATA':connected?' LIVE CONNECTED':' DISCONNECTED'));
  con.style.borderColor=isDemo?'#705334':connected?'#234a47':'#673e4a';
  setText('cpu',m.cpuPercent??'—');setBar('cpu-bar',m.cpuPercent);setText('cpu-status',(m.cpuPercent||0)>=85?'ВЫСОКАЯ':'НОРМА');
  $('cpu-status').classList.toggle('danger-text',(m.cpuPercent||0)>=85);
  setText('ram',m.memory?.usedPercent??'—');setBar('ram-bar',m.memory?.usedPercent);
  setText('ram-used',m.memory?.usedBytes!=null?`${formatBytes(m.memory.usedBytes)} / ${formatBytes(m.memory.totalBytes)}`:'Использование RAM');
  setText('ram-status',(m.memory?.usedPercent||0)>=90?'ВЫСОКАЯ':'НОРМА');
  $('ram-status').classList.toggle('danger-text',(m.memory?.usedPercent||0)>=90);
  const [rx,rUnit]=formatSpeed(m.network?.rxBps);const [tx,tUnit]=formatSpeed(m.network?.txBps);
  setText('network',rx);setText('network-unit',rUnit);setText('rx',`${rx} ${rUnit}`);setText('tx',`${tx} ${tUnit}`);
  setText('rpm',t.rpm??0);setText('error-count',`${t.errors||0} ОШИБОК`);$('error-count').classList.toggle('danger-text',(t.errors||0)>0);
  drawRequestBars(state.events||[]);
  const config=state.config||{};
  document.querySelectorAll('.site-name').forEach(x=>x.textContent=config.siteLabel||DEMO_SITE);
  setText('vps-name',config.vpsLabel||'VPS');
  let siteLink='https://scrmvv.space';
  try{const url=new URL(config.siteUrl);if(['https:','http:'].includes(url.protocol))siteLink=url.href;}catch{}
  $('site-link').href=siteLink;
  setStatus('vps-status','up');setStatus('nginx-status',h.nginx||'unknown');setStatus('site-status',h.site?.status||'unknown');
  setText('site-latency',h.site?.status==='up'?`HTTP ${h.site.code||200} · ${h.site.latencyMs??'?'} мс`:h.site?.status==='down'?'Сайт не отвечает':'Проверка не выполнена');
  setText('disk-pct',m.disk?.usedPercent==null?'—':`${m.disk.usedPercent}%`);setBar('disk-bar',m.disk?.usedPercent);
  setText('disk-details',m.disk?.usedBytes!=null?`${formatBytes(m.disk.usedBytes)} из ${formatBytes(m.disk.totalBytes)} занято`:'Данные о диске недоступны');
  setText('uptime',formatUptime(m.uptimeSec));setText('load',(m.load??0).toFixed(2));
  drawHistory(state.history);
  drawEvents(state.events);
  const coords=(state.events||[]).filter(e=>e.geo).map(e=>`${e.geo.lat.toFixed(1)}:${e.geo.lon.toFixed(1)}`);
  setText('countries',`${new Set(coords).size} геоточек`);
  setText('last-access',state.events?.[0]?.at?new Date(state.events[0].at).toLocaleTimeString('ru-RU',{hour12:false}):'—');
  setText('geo-status',isDemo?'ДЕМОНСТРАЦИОННЫЕ МАРШРУТЫ':!h.geoEnabled?'НУЖНА ЛОКАЛЬНАЯ GEOIP-БАЗА':!h.serverGeo?'ЗАДАЙ КООРДИНАТЫ VPS':'ГЕОПОЗИЦИИ ИЗ LOCAL GEOIP');
  setText('log-status',isDemo?'ДЕМОНСТРАЦИОННЫЕ СОБЫТИЯ':h.logReadable?'ЛОГ NGINX ЧИТАЕТСЯ':'ЛОГ НЕДОСТУПЕН — ПРОВЕРЬ ПУТЬ И ПРАВА');
  $('footer-caption').textContent=isDemo?'ДЕМО-РЕЖИМ · ЗНАЧЕНИЯ ВЫМЫШЛЕНЫ':'РЕАЛЬНЫЕ МЕТРИКИ · БЕЗ ПЕРЕДАЧИ IP В БРАУЗЕР';
}
function scheduleRender(){if(renderPending)return;renderPending=true;setTimeout(drawUI,120);}
function handleSse(payload){
  let message;try{message=JSON.parse(payload);}catch{return;}
  if(message.type==='snapshot'){
    live=message.data;
    connected=true;
    if(!explicitDemo)setMode('live');
    else scheduleRender();
  } else if(!live)return;
  else if(message.type==='metrics'){
    live.metrics=message.data.metrics;live.traffic=message.data.traffic;live.history=message.data.history;scheduleRender();
  } else if(message.type==='access'){
    live.events.unshift(message.data);if(live.events.length>90)live.events.length=90;
    if(mode==='live'){triggerTopology();scheduleRender();}
  } else if(message.type==='geo'){
    const target=live.events.find(e=>e.id===message.data.id);
    if(target){target.geo=message.data.geo;if(mode==='live')globe.addArc(message.data.geo,target.status);scheduleRender();}
  } else if(message.type==='health'){
    live.health={...live.health,...message.data};
    if(mode==='live' && renderedGeoFor==='live' && !globe.serverGeo && live.health.serverGeo)globe.setServer(live.health.serverGeo);
    scheduleRender();
  }
}
function openStream(){
  if(!window.EventSource){connected=false;return;}
  networkStream=new EventSource('/api/stream');
  networkStream.onmessage=ev=>handleSse(ev.data);
  networkStream.onerror=()=>{connected=false;scheduleRender();};
  networkStream.onopen=()=>{connected=true;scheduleRender();};
}
$('demo-switch').addEventListener('click',()=>{
  const next=mode==='demo'?'live':'demo';
  explicitDemo=next==='demo';
  if(next==='live'&&!live){
    explicitDemo=false;alert('Реальный backend пока не подключён. Запусти node server/index.mjs на VPS или локально.');return;
  }
  setMode(next);
});
document.querySelectorAll('.event-filters button').forEach(button=>button.addEventListener('click',()=>{
  filter=button.dataset.filter;
  document.querySelectorAll('.event-filters button').forEach(b=>b.classList.toggle('active',b===button));
  scheduleRender();
}));
function clock(){setText('clock',new Date().toLocaleTimeString('ru-RU',{hour12:false}));}
clock();setInterval(clock,1000);
setText('local-timezone',Intl.DateTimeFormat().resolvedOptions().timeZone);
setMode('demo');
// Seed the preview. These are ALWAYS marked as demo, never passed off as real requests.
for(let i=0;i<5;i++)addDemoEvent();
setInterval(()=>{if(mode==='demo')addDemoEvent();},2700);
openStream();
