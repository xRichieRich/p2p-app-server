const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const HOST = process.env.HOST || '0.0.0.0';
const PORT = process.env.PORT || (process.env.SPACE_ID ? 7860 : 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin124';

// Zvýšený limit pro šifrovaná data fotografií a videí (až 50 MB)
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Úložiště médií
const MEDIA_DIR = path.join(__dirname, 'media_storage');
if (!fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

// In-memory mezipaměť událostí
let events = [];
let clientsCount = 0;
let stats = {
  totalPublishedEvents: 0,
  totalMediaUploaded: 0,
  serverStartTime: new Date(),
};

// ==============================================================
// 1. ZÁKLADNÍ A ZDRAVOTNÍ ENDPOINTY
// ==============================================================

app.get('/', (req, res) => {
  res.send(`
    <html>
      <head><title>P2P Photo Vault Server</title></head>
      <body style="background:#090D16;color:white;font-family:sans-serif;text-align:center;padding:50px;">
        <h1 style="color:#00D2FF;">P2P Photo Vault Server je Online! 🚀</h1>
        <p style="color:#9CA3AF;">Zabezpečený přenosový server a synchronizace pro aplikaci P2P Vault.</p>
        <p><a href="/admin" style="display:inline-block;padding:10px 20px;background:#10B981;color:black;text-decoration:none;border-radius:8px;font-weight:bold;">Otevřít Web Admin Panel</a></p>
      </body>
    </html>
  `);
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.4.0',
    uptimeSeconds: Math.floor((Date.now() - stats.serverStartTime.getTime()) / 1000),
    eventsCount: events.length,
    serverTime: new Date().toISOString(),
  });
});

// ==============================================================
// 2. SYNCHRONIZAČNÍ API PRO MOBILNÍ TELEFONY
// ==============================================================

// Publikování nové události (žádost, schválení, zpráva, sdílená fotka)
app.post('/api/sync/publish', (req, res) => {
  const payload = req.body;
  if (!payload || !payload.action_type) {
    return res.status(400).json({ error: 'Chybí payload nebo action_type' });
  }

  const eventItem = {
    id: 'evt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    time: Date.now(),
    createdAt: new Date().toISOString(),
    ...payload,
  };

  events.push(eventItem);
  stats.totalPublishedEvents++;

  // Udržujeme posledních 1000 událostí v paměti
  if (events.length > 1000) {
    events.shift();
  }

  res.json({ success: true, eventId: eventItem.id, time: eventItem.time });
});

// Získání nových událostí od zadaného časového razítka (since) a volitelného kanálu
app.get('/api/sync/events', (req, res) => {
  const since = parseInt(req.query.since || '0', 10);
  const channel = req.query.channel;
  let filtered = since > 0 ? events.filter(e => e.time > since) : events.slice(-50);
  if (channel) {
    filtered = filtered.filter(e => !e.channel || e.channel === channel);
  }
  res.json({
    events: filtered,
    serverTime: Date.now(),
  });
});

// ==============================================================
// 3. PŘENOS ŠIFROVANÝCH MÉDIÍ (FOTOGRAFIE A VIDEA)
// ==============================================================

// Nahrání zašifrovaného média (bez limitu ntfy)
app.post('/api/media/upload', (req, res) => {
  const { mediaId, encryptedBase64 } = req.body;
  if (!mediaId || !encryptedBase64) {
    return res.status(400).json({ error: 'Chybí mediaId nebo encryptedBase64' });
  }

  try {
    const buffer = Buffer.from(encryptedBase64, 'base64');
    const safeName = mediaId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filePath = path.join(MEDIA_DIR, safeName + '.enc');
    fs.writeFileSync(filePath, buffer);
    stats.totalMediaUploaded++;

    res.json({ success: true, mediaId: safeName, sizeBytes: buffer.length });
  } catch (err) {
    res.status(500).json({ error: 'Chyba při ukládání média: ' + err.message });
  }
});

// Stažení zašifrovaného média
app.get('/api/media/:mediaId', (req, res) => {
  const safeName = req.params.mediaId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = path.join(MEDIA_DIR, safeName + '.enc');

  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.status(404).json({ error: 'Médiální soubor nenalezen' });
  }
});

// ==============================================================
// 4. WEBOVÝ ADMIN PANEL (/admin)
// ==============================================================

// API pro admin panel chráněné heslem
function checkAdminAuth(req, res, next) {
  const auth = req.headers['x-admin-key'] || req.query.admin_key;
  if (auth !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Neautorizovaný přístup. Nesprávné heslo administrátora.' });
  }
  next();
}

app.get('/api/admin/data', checkAdminAuth, (req, res) => {
  const mediaFiles = fs.readdirSync(MEDIA_DIR);
  let totalMediaBytes = 0;
  mediaFiles.forEach(f => {
    try {
      totalMediaBytes += fs.statSync(path.join(MEDIA_DIR, f)).size;
    } catch (_) {}
  });

  res.json({
    stats: {
      ...stats,
      uptimeSeconds: Math.floor((Date.now() - stats.serverStartTime.getTime()) / 1000),
      mediaCount: mediaFiles.length,
      mediaTotalMb: (totalMediaBytes / (1024 * 1024)).toFixed(2),
    },
    events: events.slice(-100).reverse(),
  });
});

// Admin schválení žádosti přímo z webu
app.post('/api/admin/approve-request', checkAdminAuth, (req, res) => {
  const { requestId, durationMinutes } = req.body;
  const eventItem = {
    id: 'evt_admin_' + Date.now(),
    time: Date.now(),
    createdAt: new Date().toISOString(),
    action_type: 'access_approved',
    request_id: requestId,
    duration_minutes: durationMinutes || 15,
    approved_at: new Date().toISOString(),
    approved_by: 'Web Admin',
  };
  events.push(eventItem);
  res.json({ success: true, message: 'Žádost schválena administrátorem z webu.' });
});

// Admin vymazání dat z webu
app.post('/api/admin/clear-all', checkAdminAuth, (req, res) => {
  events = [];
  const files = fs.readdirSync(MEDIA_DIR);
  files.forEach(f => {
    try { fs.unlinkSync(path.join(MEDIA_DIR, f)); } catch (_) {}
  });
  res.json({ success: true, message: 'Veškerá data a média na serveru byla vymazána.' });
});

// Webová stránka Admin Panelu
app.get('/admin', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>P2P Photo Vault — Web Admin Panel</title>
  <style>
    :root {
      --bg: #090D16;
      --card: #111827;
      --card-inner: #131B2E;
      --border: #23304B;
      --cyan: #00D2FF;
      --green: #10B981;
      --red: #EF4444;
      --amber: #F59E0B;
      --text: #F3F4F6;
      --muted: #9CA3AF;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 24px; }
    .container { max-width: 1000px; margin: 0 auto; }
    header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 20px; border-bottom: 1px solid var(--border); margin-bottom: 24px; }
    .logo { display: flex; align-items: center; gap: 12px; }
    .logo-badge { width: 40px; height: 40px; background: rgba(0,210,255,0.15); border: 1.5px solid var(--cyan); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px; }
    h1 { font-size: 22px; font-weight: 700; color: white; }
    .online-badge { background: rgba(16,185,129,0.15); border: 1px solid var(--green); color: var(--green); padding: 5px 12px; border-radius: 20px; font-size: 13px; font-weight: bold; display: flex; align-items: center; gap: 6px; }
    .online-dot { width: 8px; height: 8px; background: var(--green); border-radius: 50%; }
    
    /* Login overlay */
    #login-box { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 32px; max-width: 400px; margin: 60px auto; text-align: center; }
    input[type="password"], input[type="text"] { width: 100%; padding: 12px 16px; background: var(--card-inner); border: 1px solid var(--border); border-radius: 10px; color: white; font-size: 15px; margin: 16px 0; outline: none; }
    input[type="password"]:focus, input[type="text"]:focus { border-color: var(--cyan); }
    button { background: var(--cyan); color: black; border: none; padding: 12px 20px; border-radius: 10px; font-weight: bold; cursor: pointer; font-size: 14px; transition: 0.2s; }
    button:hover { opacity: 0.9; }
    
    /* Dashboard */
    .dashboard { display: none; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 18px; }
    .card-title { font-size: 12px; color: var(--muted); text-transform: uppercase; font-weight: 600; margin-bottom: 8px; }
    .card-val { font-size: 26px; font-weight: bold; color: white; }
    .card-sub { font-size: 12px; color: var(--cyan); margin-top: 4px; }

    .section-title { font-size: 17px; font-weight: bold; color: white; margin: 24px 0 12px; display: flex; justify-content: space-between; align-items: center; }
    table { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; font-size: 13px; }
    th { background: var(--card-inner); color: var(--muted); text-align: left; padding: 12px 14px; font-weight: 600; border-bottom: 1px solid var(--border); }
    td { padding: 12px 14px; border-bottom: 1px solid var(--border); color: #E5E7EB; }
    tr:last-child td { border-bottom: none; }
    
    .tag { display: inline-block; padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: bold; }
    .tag-blue { background: rgba(0,210,255,0.15); color: var(--cyan); border: 1px solid var(--cyan); }
    .tag-green { background: rgba(16,185,129,0.15); color: var(--green); border: 1px solid var(--green); }
    .tag-amber { background: rgba(245,158,11,0.15); color: var(--amber); border: 1px solid var(--amber); }

    .btn-action { padding: 6px 12px; font-size: 12px; border-radius: 6px; margin-right: 6px; }
    .btn-green { background: var(--green); color: black; }
    .btn-red { background: var(--red); color: white; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="logo">
        <div class="logo-badge">🛡️</div>
        <div>
          <h1>P2P Photo Vault — Server Admin</h1>
          <p style="font-size:12px; color:var(--muted);">Správa propojení a auditní monitor v reálném čase</p>
        </div>
      </div>
      <div class="online-badge">
        <div class="online-dot"></div>
        Server Online
      </div>
    </header>

    <!-- Přihlašovací dialog -->
    <div id="login-box">
      <h2 style="font-size:18px; margin-bottom:6px;">Přihlášení Administrátora</h2>
      <p style="color:var(--muted); font-size:13px;">Zadejte administrátorské heslo (Admin124):</p>
      <input type="password" id="admin-pass" placeholder="Heslo administrátora" onkeydown="if(event.key==='Enter')login()">
      <button onclick="login()">Vstoupit do administrace</button>
      <p id="err" style="color:var(--red); font-size:12px; margin-top:10px; display:none;">Nesprávné heslo!</p>
    </div>

    <!-- Samotný dashboard -->
    <div id="dashboard" class="dashboard">
      <div class="grid">
        <div class="card">
          <div class="card-title">Stav serveru</div>
          <div class="card-val" style="color:var(--green);">Aktivní</div>
          <div class="card-sub" id="stat-uptime">Běží 0 min</div>
        </div>
        <div class="card">
          <div class="card-title">Přenesené události</div>
          <div class="card-val" id="stat-events">0</div>
          <div class="card-sub">Synchronizované zprávy & žádosti</div>
        </div>
        <div class="card">
          <div class="card-title">Šifrovaná média</div>
          <div class="card-val" id="stat-media">0</div>
          <div class="card-sub" id="stat-media-size">0.00 MB v úložišti</div>
        </div>
      </div>

      <div class="section-title">
        <span>Aktivní události a auditní záznamy</span>
        <div>
          <button onclick="loadData()" style="padding:6px 12px; font-size:12px; background:var(--card-inner); color:white; border:1px solid var(--border);">🔄 Obnovit</button>
          <button onclick="clearAll()" style="padding:6px 12px; font-size:12px; background:rgba(239,68,68,0.2); color:var(--red); border:1px solid var(--red);">Smazat historii</button>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Čas</th>
            <th>Typ akce</th>
            <th>Podrobnosti události</th>
            <th>Rychlá akce</th>
          </tr>
        </thead>
        <tbody id="events-table">
          <tr><td colspan="4" style="text-align:center; color:var(--muted);">Načítám data...</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <script>
    let adminKey = localStorage.getItem('vault_admin_key') || '';

    if (adminKey) {
      checkKey(adminKey);
    }

    function login() {
      const pass = document.getElementById('admin-pass').value.trim();
      checkKey(pass);
    }

    async function checkKey(pass) {
      try {
        const res = await fetch('/api/admin/data', { headers: { 'x-admin-key': pass } });
        if (res.ok) {
          adminKey = pass;
          localStorage.setItem('vault_admin_key', pass);
          document.getElementById('login-box').style.display = 'none';
          document.getElementById('dashboard').style.display = 'block';
          loadData();
          setInterval(loadData, 3000);
        } else {
          document.getElementById('err').style.display = 'block';
        }
      } catch (e) {
        document.getElementById('err').innerText = 'Chyba serveru: ' + e.message;
        document.getElementById('err').style.display = 'block';
      }
    }

    async function loadData() {
      if (!adminKey) return;
      try {
        const res = await fetch('/api/admin/data', { headers: { 'x-admin-key': adminKey } });
        const data = await res.json();
        
        document.getElementById('stat-uptime').innerText = 'Uptime: ' + Math.floor(data.stats.uptimeSeconds / 60) + ' min';
        document.getElementById('stat-events').innerText = data.stats.totalPublishedEvents;
        document.getElementById('stat-media').innerText = data.stats.mediaCount;
        document.getElementById('stat-media-size').innerText = data.stats.mediaTotalMb + ' MB v úložišti';

        const tbody = document.getElementById('events-table');
        if (!data.events || data.events.length === 0) {
          tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--muted);">Zatím žádné události. Aplikace je připravena k přenosu.</td></tr>';
          return;
        }

        tbody.innerHTML = data.events.map(e => {
          let typeBadge = '<span class="tag tag-blue">' + e.action_type + '</span>';
          let details = '';
          let actionBtn = '';

          if (e.action_type === 'access_request') {
            typeBadge = '<span class="tag tag-amber">Žádost o přístup</span>';
            const req = e.request || {};
            details = '<strong>' + (req.requesterDisplayName || req.requesterId) + '</strong> žádá o <strong>' + (req.durationMinutes || 15) + ' minut</strong>';
            actionBtn = '<button class="btn-action btn-green" onclick="approveReq(\\'' + req.id + '\\', ' + (req.durationMinutes || 15) + ')">Schválit</button>';
          } else if (e.action_type === 'access_approved') {
            typeBadge = '<span class="tag tag-green">Přístup schválen</span>';
            details = 'Odemčeno na ' + (e.duration_minutes || 15) + ' minut';
          } else if (e.action_type === 'chat_message') {
            const m = e.message || {};
            typeBadge = '<span class="tag tag-blue">Zpráva v chatu</span>';
            details = 'Od <strong>' + (m.senderDisplayName || m.senderId) + '</strong>: ' + (m.text || '[' + m.type + ']');
          } else if (e.action_type === 'shared_photo_uploaded') {
            typeBadge = '<span class="tag tag-green">Sdílená fotka</span>';
            details = 'Nahrál <strong>' + e.owner_name + '</strong> (ID: ' + e.photo_id + ')';
          }

          const timeStr = new Date(e.time || e.createdAt).toLocaleTimeString();
          return '<tr><td>' + timeStr + '</td><td>' + typeBadge + '</td><td>' + details + '</td><td>' + actionBtn + '</td></tr>';
        }).join('');
      } catch (err) {
        console.error(err);
      }
    }

    async function approveReq(id, mins) {
      if (!confirm('Opravdu chcete schválit tuto žádost na ' + mins + ' minut?')) return;
      await fetch('/api/admin/approve-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
        body: JSON.stringify({ requestId: id, durationMinutes: mins })
      });
      loadData();
    }

    async function clearAll() {
      if (!confirm('Opravdu smazat veškerou historii a média na serveru?')) return;
      await fetch('/api/admin/clear-all', {
        method: 'POST',
        headers: { 'x-admin-key': adminKey }
      });
      loadData();
    }
  </script>
</body>
</html>
  `);
});

app.listen(PORT, HOST, () => {
  console.log(`=======================================================`);
  console.log(` P2P Photo Vault Server běží na: http://${HOST}:${PORT}`);
  console.log(` Web Admin Dashboard: http://${HOST}:${PORT}/admin`);
  console.log(` Výchozí heslo administrátora: ${ADMIN_PASSWORD}`);
  console.log(`=======================================================`);
});
