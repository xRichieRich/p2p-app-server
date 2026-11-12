const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const HOST = process.env.HOST || '0.0.0.0';
const PORT = process.env.PORT || (process.env.SPACE_ID ? 7860 : 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin124';

// Zvýšený limit pro šifrovaná data fotografií, videí i APK balíčků (až 120 MB)
app.use(cors());
app.use(express.json({ limit: '120mb' }));
app.use(express.urlencoded({ limit: '120mb', extended: true }));

// Úložiště médií
const MEDIA_DIR = path.join(__dirname, 'media_storage');
if (!fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

// Úložiště aktualizací aplikace (OTA updates)
const UPDATES_DIR = path.join(__dirname, 'updates');
if (!fs.existsSync(UPDATES_DIR)) {
  fs.mkdirSync(UPDATES_DIR, { recursive: true });
}

const VERSION_FILE = path.join(UPDATES_DIR, 'version.json');
function getVersionInfo() {
  if (fs.existsSync(VERSION_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
    } catch (_) {}
  }
  return {
    version: '1.4.1',
    versionCode: 8,
    changelog: 'Vlastní cloud relay server a webová správa.',
    downloadUrl: '/api/update/download',
    publishedAt: new Date().toISOString(),
  };
}

function saveVersionInfo(info) {
  fs.writeFileSync(VERSION_FILE, JSON.stringify(info, null, 2), 'utf8');
}

function isNewerVersion(currentStr, latestStr) {
  if (!currentStr || !latestStr) return false;
  const currentParts = currentStr.replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  const latestParts = latestStr.replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
    const c = currentParts[i] || 0;
    const l = latestParts[i] || 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}

// In-memory mezipaměť událostí
let events = [];
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
        <p style="color:#9CA3AF;margin-top:10px;">Zabezpečený přenosový server a synchronizace pro aplikaci P2P Vault.</p>
        <p style="margin-top:20px;">
          <a href="/admin" style="display:inline-block;padding:12px 24px;background:#10B981;color:black;text-decoration:none;border-radius:10px;font-weight:bold;">
            Otevřít Web Admin Panel
          </a>
        </p>
      </body>
    </html>
  `);
});

app.get('/health', (req, res) => {
  const versionInfo = getVersionInfo();
  res.json({
    status: 'ok',
    version: versionInfo.version,
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
// 4. SYSTÉM AUTOMATICKÝCH AKTUALIZACÍ (OTA UPDATES)
// ==============================================================

// Dotaz z aplikace: Je k dispozici nová verze?
app.get('/api/update/check', (req, res) => {
  const currentVersion = req.query.current_version || '1.0.0';
  const info = getVersionInfo();
  const hasUpdate = isNewerVersion(currentVersion, info.version);
  const apkPath = path.join(UPDATES_DIR, 'P2P_Vault_latest.apk');
  const apkExists = fs.existsSync(apkPath);

  const host = req.get('host');
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const fullDownloadUrl = info.downloadUrl.startsWith('http')
    ? info.downloadUrl
    : `${proto}://${host}${info.downloadUrl}`;

  res.json({
    hasUpdate,
    latestVersion: info.version,
    versionCode: info.versionCode,
    changelog: info.changelog,
    downloadUrl: info.downloadUrl,
    fullDownloadUrl,
    apkExists,
    apkSizeMb: apkExists ? (fs.statSync(apkPath).size / (1024 * 1024)).toFixed(1) : null,
    publishedAt: info.publishedAt,
  });
});

// Stažení samotného APK souboru aktualizace
app.get('/api/update/download', (req, res) => {
  const info = getVersionInfo();
  const apkPath = path.join(UPDATES_DIR, 'P2P_Vault_latest.apk');

  if (fs.existsSync(apkPath)) {
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', `attachment; filename="P2P_Vault_v${info.version}.apk"`);
    fs.createReadStream(apkPath).pipe(res);
  } else if (info.downloadUrl && info.downloadUrl.startsWith('http')) {
    res.redirect(info.downloadUrl);
  } else {
    res.status(404).json({ error: 'APK soubor aktualizace zatím nebyl na server nahrán.' });
  }
});

// ==============================================================
// 5. WEBOVÝ ADMIN PANEL (/admin) A ADMIN API
// ==============================================================

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

  const apkPath = path.join(UPDATES_DIR, 'P2P_Vault_latest.apk');
  const apkExists = fs.existsSync(apkPath);
  const apkSizeMb = apkExists ? (fs.statSync(apkPath).size / (1024 * 1024)).toFixed(1) : '0';

  res.json({
    stats: {
      ...stats,
      uptimeSeconds: Math.floor((Date.now() - stats.serverStartTime.getTime()) / 1000),
      mediaCount: mediaFiles.length,
      mediaTotalMb: (totalMediaBytes / (1024 * 1024)).toFixed(2),
      apkExists,
      apkSizeMb,
    },
    versionInfo: getVersionInfo(),
    events: events.slice(-100).reverse(),
  });
});

// Admin publikování nové aktualizace z webu
app.post('/api/admin/publish-update', checkAdminAuth, (req, res) => {
  const { version, changelog, downloadUrl } = req.body;
  if (!version) {
    return res.status(400).json({ error: 'Chybí číslo verze' });
  }

  const vClean = version.trim().replace(/^v/i, '');
  const info = {
    version: vClean,
    versionCode: parseInt(vClean.replace(/[^0-9]/g, ''), 10) || 10,
    changelog: changelog ? changelog.trim() : 'Nové funkce a optimalizace zabezpečení.',
    downloadUrl: downloadUrl ? downloadUrl.trim() : '/api/update/download',
    publishedAt: new Date().toISOString(),
  };

  saveVersionInfo(info);

  // Vypustíme push událost do kanálu, takže všem online telefonům ihned vyskočí dialog
  const eventItem = {
    id: 'evt_update_' + Date.now(),
    time: Date.now(),
    createdAt: new Date().toISOString(),
    action_type: 'app_update_available',
    version: info.version,
    changelog: info.changelog,
    download_url: info.downloadUrl,
  };
  events.push(eventItem);

  res.json({ success: true, message: `Aktualizace v${info.version} byla úspěšně vypuštěna!`, info });
});

// Admin nahrání nového APK souboru ze souboru
app.post('/api/admin/upload-apk', checkAdminAuth, (req, res) => {
  const { base64Apk, version, changelog } = req.body;
  if (!base64Apk) {
    return res.status(400).json({ error: 'Chybí data APK souboru' });
  }

  try {
    const buffer = Buffer.from(base64Apk, 'base64');
    const apkPath = path.join(UPDATES_DIR, 'P2P_Vault_latest.apk');
    fs.writeFileSync(apkPath, buffer);

    if (version) {
      const vClean = version.trim().replace(/^v/i, '');
      const info = {
        version: vClean,
        versionCode: parseInt(vClean.replace(/[^0-9]/g, ''), 10) || 10,
        changelog: changelog ? changelog.trim() : 'Nová aktualizace aplikace.',
        downloadUrl: '/api/update/download',
        publishedAt: new Date().toISOString(),
      };
      saveVersionInfo(info);

      events.push({
        id: 'evt_update_' + Date.now(),
        time: Date.now(),
        createdAt: new Date().toISOString(),
        action_type: 'app_update_available',
        version: info.version,
        changelog: info.changelog,
        download_url: info.downloadUrl,
      });
    }

    res.json({
      success: true,
      message: 'APK soubor byl úspěšně nahrán na server!',
      sizeMb: (buffer.length / (1024 * 1024)).toFixed(1),
    });
  } catch (err) {
    res.status(500).json({ error: 'Chyba při ukládání APK: ' + err.message });
  }
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
      --purple: #A855F7;
      --text: #F3F4F6;
      --muted: #9CA3AF;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 24px; }
    .container { max-width: 1050px; margin: 0 auto; }
    header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 20px; border-bottom: 1px solid var(--border); margin-bottom: 24px; }
    .logo { display: flex; align-items: center; gap: 12px; }
    .logo-badge { width: 42px; height: 42px; background: rgba(0,210,255,0.15); border: 1.5px solid var(--cyan); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px; }
    h1 { font-size: 22px; font-weight: 700; color: white; }
    .online-badge { background: rgba(16,185,129,0.15); border: 1px solid var(--green); color: var(--green); padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: bold; display: flex; align-items: center; gap: 6px; }
    .online-dot { width: 8px; height: 8px; background: var(--green); border-radius: 50%; }
    
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .stat-card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 18px; }
    .stat-label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }
    .stat-value { font-size: 26px; font-weight: 700; margin-top: 6px; color: white; }
    .stat-sub { font-size: 12px; color: var(--cyan); margin-top: 4px; }
    
    .panel { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 22px; margin-bottom: 24px; }
    .panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .panel-title { font-size: 17px; font-weight: 700; color: white; display: flex; align-items: center; gap: 8px; }
    
    table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; }
    th { padding: 10px 12px; color: var(--muted); border-bottom: 1px solid var(--border); font-weight: 600; }
    td { padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.05); }
    tr:hover { background: rgba(255,255,255,0.02); }
    
    .tag { display: inline-block; padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; }
    .tag-green { background: rgba(16,185,129,0.15); color: var(--green); }
    .tag-amber { background: rgba(245,158,11,0.15); color: var(--amber); }
    .tag-blue { background: rgba(0,210,255,0.15); color: var(--cyan); }
    .tag-purple { background: rgba(168,85,247,0.15); color: var(--purple); }
    
    .btn-action { background: var(--card-inner); border: 1px solid var(--border); color: white; padding: 7px 14px; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: bold; transition: all 0.2s; }
    .btn-action:hover { border-color: var(--cyan); }
    .btn-green { background: var(--green); color: black; border: none; }
    .btn-green:hover { background: #059669; }
    .btn-danger { background: rgba(239,68,68,0.15); border: 1px solid var(--red); color: var(--red); }
    .btn-danger:hover { background: var(--red); color: white; }
    
    input[type="text"], textarea { width: 100%; background: var(--card-inner); border: 1px solid var(--border); color: white; padding: 10px 14px; border-radius: 10px; font-size: 13px; margin-top: 6px; margin-bottom: 12px; }
    input:focus, textarea:focus { outline: none; border-color: var(--cyan); }
    
    #login-overlay { position: fixed; inset: 0; background: var(--bg); display: flex; align-items: center; justify-content: center; z-index: 999; }
    .login-box { background: var(--card); border: 1px solid var(--border); border-radius: 20px; padding: 32px; width: 100%; max-width: 380px; text-align: center; }
  </style>
</head>
<body>
  <div id="login-overlay">
    <div class="login-box">
      <div class="logo-badge" style="margin: 0 auto 16px auto;">🛡️</div>
      <h2 style="margin-bottom: 8px;">P2P Vault Admin</h2>
      <p style="color: var(--muted); font-size: 13px; margin-bottom: 20px;">Zadejte administrátorské heslo</p>
      <input type="password" id="admin-pass" placeholder="Heslo administrátora" style="width:100%;padding:12px;background:var(--card-inner);border:1px solid var(--border);border-radius:10px;color:white;font-size:14px;margin-bottom:16px;">
      <button class="btn-action btn-green" style="width:100%;padding:12px;font-size:14px;" onclick="doLogin()">Vstoupit do administrace</button>
      <p id="login-err" style="color:var(--red);font-size:12px;margin-top:12px;display:none;">Nesprávné heslo!</p>
    </div>
  </div>

  <div class="container" id="app" style="display:none;">
    <header>
      <div class="logo">
        <div class="logo-badge">🛡️</div>
        <div>
          <h1>P2P Photo Vault — Admin Panel</h1>
          <p style="color:var(--muted); font-size:12px; margin-top:2px;">Správa přenosů, živý audit log a aktualizace aplikace</p>
        </div>
      </div>
      <div class="online-badge">
        <div class="online-dot"></div>
        Server Online
      </div>
    </header>

    <div class="grid">
      <div class="stat-card">
        <div class="stat-label">Uptime serveru</div>
        <div class="stat-value" id="stat-uptime">0s</div>
        <div class="stat-sub">Nepřetržitý provoz</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Odbavených událostí</div>
        <div class="stat-value" id="stat-events">0</div>
        <div class="stat-sub">Žádosti, schválení, fotky</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Šifrovaná média</div>
        <div class="stat-value" id="stat-media">0 MB</div>
        <div class="stat-sub" id="stat-media-count">0 souborů</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Aktuální verze APK</div>
        <div class="stat-value" style="color:var(--cyan);" id="stat-version">v1.4.1</div>
        <div class="stat-sub" id="stat-apk-status">K dispozici ke stažení</div>
      </div>
    </div>

    <!-- PUBLIKOVÁNÍ AKTUALIZACÍ (OTA) -->
    <div class="panel" style="border-color: rgba(0, 210, 255, 0.3);">
      <div class="panel-header">
        <div class="panel-title">
          <span>🚀</span>
          Publikování aktualizací aplikace (OTA)
        </div>
        <span class="tag tag-blue" id="pub-status-tag">Všechny telefony dostanou okamžitou výzvu</span>
      </div>
      <p style="font-size: 13px; color: var(--muted); margin-bottom: 16px;">
        Když zde zadáte novou verzi a kliknete na <strong>Vypustit aktualizaci</strong>, všem telefonům okamžitě vyskočí dialog s dotazem na stažení a instalaci.
      </p>

      <div style="display:grid; grid-template-columns: 1fr 2fr; gap: 16px;">
        <div>
          <label style="font-size:12px; font-weight:bold; color:var(--text);">Nové číslo verze:</label>
          <input type="text" id="update-version" placeholder="např. 1.4.2" value="1.4.2">
        </div>
        <div>
          <label style="font-size:12px; font-weight:bold; color:var(--text);">Odkaz ke stažení APK (volitelné):</label>
          <input type="text" id="update-url" placeholder="Nechte prázdné pro stažení ze serveru (/api/update/download)">
        </div>
      </div>

      <label style="font-size:12px; font-weight:bold; color:var(--text);">Popis změn pro uživatele (Changelog):</label>
      <textarea id="update-changelog" rows="2" placeholder="Popište, co je v této verzi nové (např. Opravy chyb, rychlejší přenos fotek)..."></textarea>

      <div style="display: flex; gap: 12px; align-items: center; margin-top: 6px;">
        <button class="btn-action btn-green" onclick="publishUpdate()" style="padding: 10px 20px;">
          🚀 Vypustit aktualizaci všem zařízením
        </button>
        <label class="btn-action" style="cursor: pointer; display: inline-block;">
          📁 Nahrát nový .apk soubor na server
          <input type="file" id="apk-file-input" accept=".apk" style="display:none;" onchange="uploadApkFile(this)">
        </label>
        <span id="upload-status" style="font-size:12px; color:var(--cyan);"></span>
      </div>
    </div>

    <!-- AUDIT LOG UDÁLOSTÍ -->
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">
          <span>📋</span>
          Živý audit log událostí
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="btn-action" onclick="loadData()">Obnovit</button>
          <button class="btn-action btn-danger" onclick="clearAll()">Vymazat log</button>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Čas</th>
            <th>Typ události</th>
            <th>Detaily</th>
            <th>Akce</th>
          </tr>
        </thead>
        <tbody id="events-tbody">
          <tr><td colspan="4" style="text-align:center;color:var(--muted);">Načítám události...</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <script>
    let adminKey = '';

    function doLogin() {
      const pass = document.getElementById('admin-pass').value;
      adminKey = pass;
      fetch('/api/admin/data', { headers: { 'x-admin-key': adminKey } })
        .then(res => {
          if (res.ok) {
            document.getElementById('login-overlay').style.display = 'none';
            document.getElementById('app').style.display = 'block';
            loadData();
            setInterval(loadData, 3000);
          } else {
            document.getElementById('login-err').style.display = 'block';
          }
        })
        .catch(() => {
          document.getElementById('login-err').style.display = 'block';
        });
    }

    async function loadData() {
      if (!adminKey) return;
      try {
        const res = await fetch('/api/admin/data', { headers: { 'x-admin-key': adminKey } });
        if (!res.ok) return;
        const data = await res.json();

        // Statistiky
        const s = data.stats || {};
        const mins = Math.floor((s.uptimeSeconds || 0) / 60);
        const secs = (s.uptimeSeconds || 0) % 60;
        document.getElementById('stat-uptime').innerText = mins + 'm ' + secs + 's';
        document.getElementById('stat-events').innerText = s.totalPublishedEvents || 0;
        document.getElementById('stat-media').innerText = (s.mediaTotalMb || 0) + ' MB';
        document.getElementById('stat-media-count').innerText = (s.mediaCount || 0) + ' souborů';
        
        // Verze
        const vInfo = data.versionInfo || {};
        document.getElementById('stat-version').innerText = 'v' + (vInfo.version || '1.4.1');
        document.getElementById('stat-apk-status').innerText = s.apkExists ? 'APK (' + s.apkSizeMb + ' MB) připraveno' : 'APK zatím nenahráno';

        // Tabulka
        const tbody = document.getElementById('events-tbody');
        if (!data.events || data.events.length === 0) {
          tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:24px;">Zatím žádné zaznamenané události</td></tr>';
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
            details = 'Odemčeno na ' + (e.duration_minutes || 15) + ' minut (schválil ' + (e.approved_by || 'Uživatel') + ')';
          } else if (e.action_type === 'chat_message') {
            const m = e.message || {};
            typeBadge = '<span class="tag tag-blue">Zpráva v chatu</span>';
            details = 'Od <strong>' + (m.senderDisplayName || m.senderId) + '</strong>: ' + (m.text || '[' + m.type + ']');
          } else if (e.action_type === 'shared_photo_uploaded') {
            typeBadge = '<span class="tag tag-green">Sdílená fotka</span>';
            details = 'Nahrál <strong>' + e.owner_name + '</strong> (ID: ' + e.photo_id + ')';
          } else if (e.action_type === 'app_update_available') {
            typeBadge = '<span class="tag tag-purple">Nová aktualizace v' + e.version + '</span>';
            details = 'Changelog: ' + (e.changelog || 'Nová verze');
          }

          const timeStr = new Date(e.time || e.createdAt).toLocaleTimeString();
          return '<tr><td>' + timeStr + '</td><td>' + typeBadge + '</td><td>' + details + '</td><td>' + actionBtn + '</td></tr>';
        }).join('');
      } catch (err) {
        console.error(err);
      }
    }

    async function publishUpdate() {
      const ver = document.getElementById('update-version').value.trim();
      const changelog = document.getElementById('update-changelog').value.trim();
      const url = document.getElementById('update-url').value.trim();

      if (!ver) {
        alert('Zadejte prosím číslo verze (např. 1.4.2).');
        return;
      }

      if (!confirm('Opravdu chcete vypustit aktualizaci v' + ver + ' pro všechny připojené telefony?')) return;

      const res = await fetch('/api/admin/publish-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
        body: JSON.stringify({ version: ver, changelog: changelog, downloadUrl: url || '/api/update/download' })
      });

      const d = await res.json();
      if (res.ok) {
        alert('🚀 ' + d.message);
        loadData();
      } else {
        alert('Chyba: ' + (d.error || 'Neznámá chyba'));
      }
    }

    async function uploadApkFile(input) {
      if (!input.files || !input.files[0]) return;
      const file = input.files[0];
      const status = document.getElementById('upload-status');
      status.innerText = 'Nahrávám APK (' + (file.size / (1024*1024)).toFixed(1) + ' MB)...';

      const reader = new FileReader();
      reader.onload = async function() {
        const base64 = reader.result.split(',')[1];
        const ver = document.getElementById('update-version').value.trim();
        const changelog = document.getElementById('update-changelog').value.trim();

        try {
          const res = await fetch('/api/admin/upload-apk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
            body: JSON.stringify({ base64Apk: base64, version: ver, changelog: changelog })
          });
          const d = await res.json();
          if (res.ok) {
            status.innerText = '✓ APK nahráno (' + d.sizeMb + ' MB)';
            loadData();
          } else {
            status.innerText = 'Chyba: ' + d.error;
          }
        } catch (e) {
          status.innerText = 'Chyba při nahrávání: ' + e;
        }
      };
      reader.readAsDataURL(file);
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
