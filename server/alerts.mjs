// Telegram notifications are optional. No incoming webhooks or public bot endpoints.
export class Alerts {
  constructor({ token = '', chatIds = '', threshold = 3, onIncident = () => {}, send = null, now = () => Date.now() } = {}) {
    this.token = token;
    this.chats = String(chatIds).split(/[\s,;]+/).filter(Boolean);
    this.threshold = Math.max(1, Math.min(20, Number(threshold) || 3));
    this.enabled = Boolean(this.token && this.chats.length);
    this.onIncident = onIncident;
    this.now = now;
    this.history = new Map();
    this.cooldowns = new Map();
    this.globalCooldown = 0;
    this.failures = 0;
    this.siteDown = false;
    this.send = send || (async text => {
      for (const chat_id of this.chats) {
        const res = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id, text, disable_web_page_preview: true }),
          signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) throw new Error(`Telegram API status ${res.status}`);
        const result = await res.json();
        if (!result.ok) throw new Error('Telegram API rejected request');
      }
    });
  }
  deliver(text) {
    if (!this.enabled) return;
    void this.send(text).catch(err => console.warn('[NEXUS] Telegram alert failed:', String(err.message).slice(0, 120)));
  }
  onRequest(item) {
    if (!item.suspicious) return;
    const now = this.now(), key = item.ip;
    // Memory bounds and short window: no persistent raw IP storage.
    for (const [ip, list] of this.history) {
      const recent = list.filter(at => now - at < 120_000);
      if (recent.length) this.history.set(ip, recent); else this.history.delete(ip);
    }
    const recent = this.history.get(key) || [];
    recent.push(now);
    this.history.set(key, recent);
    if (this.history.size > 5000) this.history.delete(this.history.keys().next().value);
    if (recent.length < this.threshold || now < (this.cooldowns.get(key) || 0) || now < this.globalCooldown) return;
    this.cooldowns.set(key, now + 15 * 60_000);
    this.globalCooldown = now + 60_000;
    const incident = { at: now, type: 'scan', source: item.source, count: recent.length, path: item.path, status: item.status };
    this.onIncident(incident);
    this.deliver(`⚠️ NEXUS · Подозрительная серия HTTP-запросов\nИсточник: ${item.source}\nСовпадений за 2 мин: ${recent.length}\nПоследний путь: ${item.path}\nHTTP ${item.status}\n\nЭвристика: это не доказательство взлома.`);
  }
  onHealth(status, name = 'Website') {
    if (status === 'down') {
      this.failures++;
      if (this.failures >= 2 && !this.siteDown) {
        this.siteDown = true;
        const incident = { at: this.now(), type: 'site-down', label: name };
        this.onIncident(incident);
        this.deliver(`🔴 NEXUS · Сайт ${name} не отвечает (2 проверки подряд).`);
      }
    } else if (status === 'up') {
      this.failures = 0;
      if (this.siteDown) {
        this.siteDown = false;
        const incident = { at: this.now(), type: 'site-up', label: name };
        this.onIncident(incident);
        this.deliver(`🟢 NEXUS · Сайт ${name} снова отвечает.`);
      }
    }
  }
}
