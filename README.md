# NEXUS / Live Infrastructure

## Что готово

- Интерактивный глобус с ортографической 3D-проекцией, береговыми линиями, вращением, масштабированием и дугами запросов.
- Реальные CPU, RAM, диск, RX/TX, uptime, load average из Linux (`/proc`, Node.js `os`, `statfs`). Обновление каждые 2 секунды.
- Мониторинг `systemctl is-active nginx` и HTTP-ответа сайта (раз в 15 секунд).
- Наблюдение **только за новыми** строками Nginx `combined` access.log (без чтения старых записей), обработка ротации логов.
- Real-time доставка событий браузеру через SSE/EventSource; переподключение встроено в браузер.
- Фильтры всех запросов / ошибок 4xx–5xx / известных сканирующих путей.
- Не отправляет IP пользователей в браузер. Отрезает query strings и маскирует возможные токены в URL.
- GeoIP **локально**, опционально: `mmdblookup` + City `.mmdb`. Сторонних сервисов геолокации нет.

> Важно: Web-панель показывает HTTP-запросы, не TCP-пакеты и не реальное внутреннее прохождение через Nginx. Пульс в топологии — визуальная иллюстрация HTTP-запроса, а не трассировка сетевых пакетов. Без локальной City-GeoIP базы нельзя достоверно определить координаты посетителей, поэтому реальные геодуги не рисуются. 3D — это CPU-friendly ортографическая Canvas-проекция, без WebGL-библиотек.

## Быстрый локальный запуск

```bash
cp .env.example .env
node -v             # Node.js 20+
node server/index.mjs
# Открыть http://127.0.0.1:4317
```

При запуске на Windows/macOS метрики могут быть ограничены, а `nginx` и access.log недоступны. Переключатель «ДЕМО» позволяет проверить визуализацию. На VPS нужны Linux, Nginx и доступ к log-файлу.

```bash
npm test            # node:test, никаких пакетов ставить не нужно
bash scripts/smoke-test.sh
```

## Установка на VPS (Ubuntu 22.04)

### 1. Скопируй архив отдельно от сайта

```bash
# на своём ПК:
scp nexus-mvp.zip deploy@<IP_ТВОЕГО_VPS>:/home/deploy/
# по SSH:
ssh login@<IP_ТВОЕГО_VPS>
cd /home/user
unzip nexus-mvp.zip
mv nexus-mvp nexus
cd ~/nexus
cp .env.example .env
nano .env
node -v
```

Для данной сборки требуется Node.js **20+** (лучше 22 LTS); если на VPS отсутствует Node, установи актуальный Node.js из официального репозитория дистрибутива/NodeSource. `npm install` не нужен.

### 2. Только отдельный access.log сайта

Чтобы события других сайтов на Nginx не попали в мониторинг, создадим отдельный лог. Команды ниже предполагают пользователя `deploy`:

```bash
sudo install -d -o root -g deploy -m 0750 /var/log/nexus
sudo touch /var/log/nexus/scrmvv.access.log
sudo chown root:deploy /var/log/nexus/scrmvv.access.log
sudo chmod 0640 /var/log/nexus/scrmvv.access.log
```

В существующем `server { ... }` добавь (не создавай дублирующий server block):

```nginx
access_log /var/log/nexus/scrmvv.access.log combined;
```

Если у сайта два server-блока (HTTP-редирект и HTTPS), вставь запись в блок HTTPS, который реально обслуживает страницы. Затем:

```bash
sudo nginx -t && sudo systemctl reload nginx
sudo cp ~/nexus/deploy/nexus-logrotate.conf /etc/logrotate.d/nexus
```

Перезапусти сайт браузером, затем проверь, что новые строки появились:

```bash
tail -n 3 /var/log/nexus/scrmvv.access.log
```

В сервисе мониторинга используется `User=deploy`, у него есть доступ на чтение этого отдельного файла. Ротация сохраняет владельца `root:deploy` и права `0640`.

### 3. Проверка вручную и systemd

```bash
cd /home/deploy/nexus
node server/index.mjs
# в отдельном SSH-окне:
curl -s http://127.0.0.1:4317/api/state | python3 -m json.tool | head -70
```

Останови ручной Node через `Ctrl+C` и установи сервис:

```bash
sudo cp ~/nexus/deploy/nexus.service /etc/systemd/system/nexus.service
# Проверь путь к node: command -v node
# Если Node не /usr/bin/node, исправь ExecStart в /etc/systemd/system/nexus.service.
sudo systemctl daemon-reload
sudo systemctl enable --now nexus
sudo systemctl status nexus --no-pager
sudo journalctl -u nexus -n 50 --no-pager
```

Node слушает **только 127.0.0.1:4317**. Открывать порт 4317 в UFW **не нужно**.

### 4. Публичный доступ ТОЛЬКО через HTTPS с паролем

Создай A-запись у регистратора/в DNS на IP того же VPS. Подожди, пока DNS начнёт резолвиться. Не выкладывай мониторинг без пароля: на нём метрики сервера и маршруты запросов.

```bash
sudo apt-get update
sudo apt-get install -y certbot apache2-utils
sudo mkdir -p /var/www/nexus-acme
sudo cp ~/nexus/deploy/nginx-cert-http.example.conf /etc/nginx/sites-available/nexus.scrmvv.space
sudo ln -s /etc/nginx/sites-available/nexus.scrmvv.space /etc/nginx/sites-enabled/nexus.scrmvv.space
sudo nginx -t && sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/www/nexus-acme -d nexus.scrmvv.space
```

Сначала SSL-сертификат, потом пароль и HTTPS-vhost:

```bash
sudo htpasswd -c /etc/nginx/.nexus_htpasswd nexusadmin
sudo chown root:www-data /etc/nginx/.nexus_htpasswd
sudo chmod 0640 /etc/nginx/.nexus_htpasswd
sudo cp ~/nexus/deploy/nginx-https.example.conf /etc/nginx/sites-available/nexus.scrmvv.space
sudo nginx -t && sudo systemctl reload nginx
```

Открой `https://nexus.scrmvv.space`, введи логин `nexusadmin` и заданный пароль. Файлы примеров предполагают certbot с обычным путём `/etc/letsencrypt/live/nexus.scrmvv.space/`.

### 5. Опционально — география *реальных* запросов

Нужна локальная City `.mmdb` (например, бесплатная **GeoLite2-City**, скачанная самостоятельно из своего аккаунта MaxMind с соблюдением условий лицензии). База **не включена** в сборку и никуда не выгружается.

```bash
sudo apt-get install -y libmaxminddb-bin
mkdir -p /home/deploy/nexus/data
# положить GeoLite2-City.mmdb в /home/deploy/nexus/data
chmod 0644 /home/deploy/nexus/data/GeoLite2-City.mmdb
# проверить:
mmdblookup --file /home/deploy/nexus/data/GeoLite2-City.mmdb --ip 8.8.8.8 location latitude
```

В `.env` укажи:

```ini
GEOIP_MMDB=/home/deploy/nexus/data/GeoLite2-City.mmdb
SERVER_LAT=<широта_датацентра>
SERVER_LON=<долгота_датацентра>
```

```bash
sudo systemctl restart nexus
```

При отсутствии координат дата-центра геоточки клиентов отображаются, но дуги к VPS не проводятся. IP может быть геолокирован неточно, а при использовании CDN/обратного прокси Nginx может видеть IP самого прокси — для корректности понадобится отдельно настроить trusted real IP.

## Архитектура

```text
browser index.html + Canvas globe
   ↕ EventSource (/api/stream, SSE)
Node.js (127.0.0.1:4317)
   ├── Linux /proc + os + statfs     → CPU/RAM/network/disk
   ├── systemctl nginx              → service status
   ├── HTTPS scrmvv.space           → site status
   └── dedicated nginx access.log   → HTTP events
         └── optional local mmdblookup (City .mmdb) → [latitude, longitude]
```

## Безопасность и ограничения MVP

- Это **мониторинг только твоего VPS и scrmvv.space**. Никаких файлов сайта, базы данных и паролей программа не модифицирует.
- Backend слушает localhost; Nginx Basic Auth обязателен для доступа через интернет. Сертификат обязателен, чтобы пароль не передавался открытым текстом.
- Копии access.log, исходные IP, рефереры и user-agent **не уходят в браузер**. Для истории хранится не более 90 очищенных событий в оперативной памяти процесса.
- URL query string удаляется, длинные идентификаторы по возможности маскируются. Но если чувствительные данные содержатся в коротких сегментах пути, они могут отобразиться; не публикуй панель без пароля.
- Нет исторической базы данных, Telegram-уведомлений, автодетекта атак, алертов или подробного DPI. 403/404 и известные пути сканирования — лишь простые индикаторы, а не доказательства атаки.
- При перезапуске статистика событий и история CPU сбрасываются. Счётчик запросов за минуту учитывает события с момента запуска процесса; спустя минуту после старта это нормальное скользящее окно.
- Счётчик `REQ / 60 СЕК` берётся из обработанных строк; он зависит от доступа к правильному отдельному логу и задержки чтения. У очень загруженного сайта чтение ограничено для защиты VPS.
- Для легковесности глобус отрисовывается на Canvas 2D с истинной ортографической проекцией сферических координат, а не через тяжёлый WebGL-движок.

## Структура

```text
nexus-mvp/
├── client/
│   ├── index.html        интерфейс
│   ├── styles.css        дизайн и адаптив
│   ├── app.js            SSE, состояние, фильтры, графики
│   ├── globe.js          вращающийся глобус + дуги
│   ├── coastlines.json   низкодетализированные береговые линии
│   └── favicon.svg
├── server/
│   ├── index.mjs         HTTP/SSE + конфигурация
│   ├── monitor.mjs       Linux метрики + nginx log
│   └── geo.mjs           опциональная локальная City GeoIP
├── deploy/               systemd, nginx HTTP/HTTPS, logrotate
├── tests/                node:test
├── .env.example
└── package.json          только node scripts, нет dependencies
```

Береговые линии построены из GSHHG (NOAA) через библиотеку Basemap, с упрощением координат.
