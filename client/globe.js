const DEG = Math.PI / 180;
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const rgba = (hex, alpha) => {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)},${alpha})`;
};

export class Globe {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.long = -18;
    this.lat = 18;
    this.zoom = 1;
    this.serverGeo = null;
    this.arcs = [];
    this.land = [];
    this.hoverUntil = 0;
    this.lastFrame = 0;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.stars = Array.from({ length: 85 }, (_, i) => ({ x: (((i * 1223 + 67) * 97) % 1009) / 1009, y: (((i * 421 + 171) * 131) % 907) / 907, size: i % 5 === 0 ? 1.5 : .8, opacity: (i % 9 + 2) / 27 }));
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.addInteraction();
    this.resize();
    fetch('/coastlines.json').then(r => r.ok ? r.json() : []).then(lines => { this.land = lines; }).catch(() => {});
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(20, rect.width);
    this.h = Math.max(20, rect.height);
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.cx = this.w * .50;
    this.cy = this.h * .50;
    this.r = Math.min(this.w * .4, this.h * .437) * this.zoom;
  }
  addInteraction() {
    let start = null;
    this.canvas.addEventListener('pointerdown', ev => { start = { x: ev.clientX, y: ev.clientY, long: this.long, lat: this.lat }; this.canvas.setPointerCapture(ev.pointerId); });
    this.canvas.addEventListener('pointermove', ev => {
      if (!start) return;
      this.long = start.long - (ev.clientX - start.x) * .42;
      this.lat = clamp(start.lat + (ev.clientY - start.y) * .32, -72, 72);
      this.hoverUntil = performance.now() + 7500;
    });
    for (const name of ['pointerup', 'pointercancel']) this.canvas.addEventListener(name, () => { start = null; });
    this.canvas.addEventListener('wheel', ev => { ev.preventDefault(); this.zoom = clamp(this.zoom + (ev.deltaY < 0 ? .07 : -.07), .72, 1.20); this.hoverUntil = performance.now() + 5000; this.resize(); }, { passive: false });
  }
  setServer(geo) {
    const valid = geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lon);
    this.serverGeo = valid ? geo : null;
    if (valid) { this.long = geo.lon; this.lat = clamp(geo.lat, -55, 55); }
    this.arcs = [];
  }
  addArc(geo, status = 200) {
    if (!geo || !Number.isFinite(geo.lat) || !Number.isFinite(geo.lon)) return;
    this.arcs.push({ from: geo, to: this.serverGeo, at: performance.now(), status });
    if (this.arcs.length > 26) this.arcs.splice(0, this.arcs.length - 26);
  }
  project(lon, lat, altitude = 1) {
    const phi = lat * DEG, dl = (lon - this.long) * DEG, phi0 = this.lat * DEG;
    const z = Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * Math.cos(phi) * Math.cos(dl);
    return {
      x: this.cx + this.r * altitude * Math.cos(phi) * Math.sin(dl),
      y: this.cy - this.r * altitude * (Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * Math.cos(phi) * Math.cos(dl)),
      z,
    };
  }
  drawLineSamples(points, style, lineWidth, alpha = 1) {
    const ctx = this.ctx;
    ctx.beginPath();
    let active = false, last = null;
    for (const [lon, lat] of points) {
      const p = this.project(lon, lat);
      if (p.z < -.01 || (last && Math.hypot(p.x - last.x, p.y - last.y) > this.r * .38)) { active = false; last = null; continue; }
      if (!active) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      last = p; active = true;
    }
    ctx.strokeStyle = style;
    ctx.lineWidth = lineWidth;
    ctx.globalAlpha = alpha;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  drawGrid() {
    const ctx = this.ctx;
    for (let lat = -75; lat <= 75; lat += 15) {
      const pts = []; for (let lon = -180; lon <= 180; lon += 2) pts.push([lon, lat]);
      this.drawLineSamples(pts, '#26536a', .8, .32);
    }
    for (let lon = -180; lon < 180; lon += 15) {
      const pts = []; for (let lat = -90; lat <= 90; lat += 2) pts.push([lon, lat]);
      this.drawLineSamples(pts, '#26536a', .8, .32);
    }
    ctx.save();ctx.beginPath();ctx.arc(this.cx,this.cy,this.r,0,Math.PI*2);ctx.clip();
    const shade = ctx.createLinearGradient(this.cx-this.r, this.cy-this.r*.4, this.cx+this.r, this.cy+this.r*.7);
    shade.addColorStop(0,'#75dfe00d');shade.addColorStop(.55,'#07162500');shade.addColorStop(1,'#000b18a0');
    ctx.fillStyle=shade;ctx.fillRect(this.cx-this.r,this.cy-this.r,this.r*2,this.r*2);ctx.restore();
  }
  drawSphere() {
    const ctx = this.ctx;
    ctx.shadowColor='#2ea6bf';ctx.shadowBlur=32;ctx.strokeStyle='#317a92';ctx.lineWidth=1.15;
    ctx.beginPath();ctx.arc(this.cx,this.cy,this.r,0,Math.PI*2);ctx.stroke();ctx.shadowBlur=0;
    const fill=ctx.createRadialGradient(this.cx-this.r*.2,this.cy-this.r*.35,this.r*.1,this.cx,this.cy,this.r*1.05);
    fill.addColorStop(0,'#10324c');fill.addColorStop(.6,'#092135');fill.addColorStop(.88,'#071625');fill.addColorStop(1,'#040c17');
    ctx.fillStyle=fill;ctx.beginPath();ctx.arc(this.cx,this.cy,this.r,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#3b84966b';ctx.lineWidth=1;ctx.beginPath();ctx.ellipse(this.cx,this.cy,this.r*1.15,this.r*.35,-.34,0,Math.PI*2);ctx.stroke();
  }
  drawMarker(geo, color, power = 1) {
    const p = this.project(geo.lon,geo.lat);
    if (p.z < -.05) return;
    const ctx=this.ctx;
    ctx.beginPath();ctx.arc(p.x,p.y,12*power,0,Math.PI*2);ctx.strokeStyle=rgba(color,.2);ctx.lineWidth=1;ctx.stroke();
    ctx.beginPath();ctx.arc(p.x,p.y,4*power,0,Math.PI*2);ctx.fillStyle=rgba(color,.22);ctx.fill();
    ctx.shadowColor=color;ctx.shadowBlur=13;ctx.fillStyle=color;ctx.beginPath();ctx.arc(p.x,p.y,2.5*power,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
  }
  drawArc(item, now) {
    const life=(now-item.at)/5500;
    if (life>1) return;
    const color=item.status>=500?'#f48c95':item.status>=400?'#eac48c':'#6cf3d6';
    if (!item.to) { this.drawMarker(item.from,color,1+Math.sin(now/500)*.14); return; }
    const ctx=this.ctx;
    const a=this.llToVector(item.from), b=this.llToVector(item.to);
    const dotT=clamp(life*2.7,0,1);
    let prev=null;
    ctx.strokeStyle=rgba(color,.28*(1-life)+.05);ctx.lineWidth=1.15;ctx.beginPath();
    for(let i=0;i<=52;i++){
      const t=i/52, v=this.slerp(a,b,t), ll=this.vectorToLL(v), p=this.project(ll.lon,ll.lat,1+.21*Math.sin(t*Math.PI));
      const visible=p.z>-.08;
      if(!visible||prev&&Math.hypot(prev.x-p.x,prev.y-p.y)>this.r*.5){prev=null;continue;}
      if(!prev)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);prev=p;
    }
    ctx.stroke();
    if (dotT<1){const v=this.slerp(a,b,dotT),ll=this.vectorToLL(v),p=this.project(ll.lon,ll.lat,1+.21*Math.sin(dotT*Math.PI));
      if(p.z>-.08){ctx.fillStyle=color;ctx.shadowColor=color;ctx.shadowBlur=18;ctx.beginPath();ctx.arc(p.x,p.y,2.5,0,2*Math.PI);ctx.fill();ctx.shadowBlur=0;}}
    this.drawMarker(item.from,color, .7);
  }
  llToVector({lat,lon}){const p=lat*DEG,l=lon*DEG;return [Math.cos(p)*Math.cos(l),Math.cos(p)*Math.sin(l),Math.sin(p)];}
  vectorToLL(v){return {lat:Math.asin(clamp(v[2],-1,1))/DEG,lon:Math.atan2(v[1],v[0])/DEG};}
  slerp(a,b,t){const dot=clamp(a[0]*b[0]+a[1]*b[1]+a[2]*b[2],-1,1),theta=Math.acos(dot);if(theta<.001)return a;const sin=Math.sin(theta);if(sin<.001)return a.map((v,i)=>v*(1-t)+b[i]*t);const x=Math.sin((1-t)*theta)/sin,y=Math.sin(t*theta)/sin;return [a[0]*x+b[0]*y,a[1]*x+b[1]*y,a[2]*x+b[2]*y];}
  frame(now){
    requestAnimationFrame(this.frame);
    if (now-this.lastFrame<(this.reducedMotion?160:32)) return;
    if(!this.reducedMotion && now>this.hoverUntil) this.long+=.09;
    this.lastFrame=now;
    const ctx=this.ctx,w=this.w,h=this.h;
    ctx.setTransform(this.dpr,0,0,this.dpr,0,0);
    ctx.clearRect(0,0,w,h);
    const bg=ctx.createRadialGradient(w*.48,h*.53,10,w*.5,h*.5,Math.max(w,h)*.72);
    bg.addColorStop(0,'#0b2a40');bg.addColorStop(.5,'#081827');bg.addColorStop(1,'#071421');ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
    for(const s of this.stars){ctx.globalAlpha=s.opacity*(.65+.35*Math.sin(now/1700+s.x*12));ctx.fillStyle='#a8d1e1';ctx.fillRect(s.x*w,s.y*h,s.size,s.size);}ctx.globalAlpha=1;
    ctx.strokeStyle='#1d3b4d';ctx.lineWidth=.75;
    ctx.beginPath();ctx.arc(this.cx,this.cy,this.r+19,0,Math.PI*2);ctx.stroke();
    ctx.beginPath();ctx.arc(this.cx,this.cy,this.r+25, -.48, .74);ctx.strokeStyle='#60c9cc';ctx.lineWidth=1.3;ctx.stroke();
    this.drawSphere();this.drawGrid();
    for(const land of this.land)this.drawLineSamples(land,'#79c4c9',.85,.66);
    this.arcs=this.arcs.filter(a=>now-a.at<5500);
    for(const arc of this.arcs)this.drawArc(arc,now);
    if(this.serverGeo)this.drawMarker(this.serverGeo,'#8df7db',1.45);
    ctx.font='9px Consolas, monospace';ctx.fillStyle='#4a7a90';ctx.fillText('N 90°',this.cx-this.r+2,this.cy-this.r-10);
    ctx.textAlign='right';ctx.fillText('E 180°',this.cx+this.r-2,this.cy+this.r+16);ctx.textAlign='left';
  }
}
