const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function loadDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Gagal membaca db.json:', e);
  }
  return { users: {}, sessions: {} };
}

function saveDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, key] = String(stored || '').split(':');
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(key, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

function createInitialUserState(displayName, email) {
  return {
    profile: {
      bizName: 'Perniagaan Saya',
      ownerName: displayName || 'Usahawan',
      ssm: '',
      phone: '',
      email: email || '',
      address: '',
      receiptPrefix: 'RES',
      monthlyBudget: 0
    },
    accounts: [
      {
        id: 'acc_bank',
        name: 'Akaun Bank Perniagaan',
        brand: 'BANK',
        last4: '0000',
        openingBalance: 0,
        toggles: { lockCard: false, onlinePay: true, duitNow: true, contactless: false }
      },
      {
        id: 'acc_cash',
        name: 'Tunai di Tangan',
        brand: 'TUNAI',
        last4: '0001',
        openingBalance: 0,
        toggles: { lockCard: false, onlinePay: false, duitNow: false, contactless: false }
      }
    ],
    activeAccountId: 'acc_bank',
    transactions: [],
    receipts: [],
    products: [],
    chartMode: 'expense',
    layoutMode: 'desktop'
  };
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

function readBody(req, maxBytes = 15 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Saiz data terlalu besar'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Format JSON tidak sah'));
      }
    });
    req.on('error', reject);
  });
}

function getAuthSession(req, db) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token || !db.sessions[token]) return null;
  const email = db.sessions[token];
  if (!db.users[email]) return null;
  return { token, email, user: db.users[email] };
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

function serveStatic(res, filePath) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Fail tidak ditemui');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const urlPath = (req.url || '/').split('?')[0];

  // API Routes
  if (urlPath === '/api/register' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const name = String(body.name || '').trim();

      if (!email || !password || password.length < 4) {
        return sendJson(res, 400, { error: 'Sila masukkan emel/nama pengguna dan kata laluan (min 4 aksara).' });
      }

      const db = loadDb();
      if (db.users[email]) {
        return sendJson(res, 409, { error: 'Akaun dengan emel/nama pengguna ini sudah wujud.' });
      }

      const token = crypto.randomBytes(32).toString('hex');
      const initialState = createInitialUserState(name || email.split('@')[0], email);
      db.users[email] = {
        email,
        name: name || email.split('@')[0],
        passwordHash: hashPassword(password),
        createdAt: new Date().toISOString(),
        state: initialState
      };
      db.sessions[token] = email;
      saveDb(db);

      return sendJson(res, 201, {
        token,
        user: { email, name: db.users[email].name },
        state: initialState
      });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (urlPath === '/api/login' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');

      const db = loadDb();
      const user = db.users[email];
      if (!user || !verifyPassword(password, user.passwordHash)) {
        return sendJson(res, 401, { error: 'Emel/nama pengguna atau kata laluan tidak tepat.' });
      }

      const token = crypto.randomBytes(32).toString('hex');
      db.sessions[token] = email;
      saveDb(db);

      return sendJson(res, 200, {
        token,
        user: { email: user.email, name: user.name },
        state: user.state
      });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (urlPath === '/api/logout' && req.method === 'POST') {
    const db = loadDb();
    const session = getAuthSession(req, db);
    if (session) {
      delete db.sessions[session.token];
      saveDb(db);
    }
    return sendJson(res, 200, { ok: true });
  }

  if (urlPath === '/api/me' && req.method === 'GET') {
    const db = loadDb();
    const session = getAuthSession(req, db);
    if (!session) {
      return sendJson(res, 401, { error: 'Sesi tamat atau tidak sah.' });
    }
    return sendJson(res, 200, {
      user: { email: session.user.email, name: session.user.name },
      state: session.user.state
    });
  }

  if (urlPath === '/api/state' && req.method === 'PUT') {
    try {
      const db = loadDb();
      const session = getAuthSession(req, db);
      if (!session) {
        return sendJson(res, 401, { error: 'Sila log masuk semula.' });
      }
      const body = await readBody(req);
      if (!body || !body.state || typeof body.state !== 'object') {
        return sendJson(res, 400, { error: 'Data tidak sah.' });
      }
      db.users[session.email].state = body.state;
      saveDb(db);
      return sendJson(res, 200, { ok: true, savedAt: new Date().toISOString() });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (urlPath === '/api/upload' && req.method === 'POST') {
    try {
      const db = loadDb();
      const session = getAuthSession(req, db);
      if (!session) {
        return sendJson(res, 401, { error: 'Sila log masuk semula.' });
      }
      const body = await readBody(req);
      const dataUrl = String(body.dataUrl || '');
      const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i);
      if (!match) {
        return sendJson(res, 400, { error: 'Format gambar tidak disokong.' });
      }
      const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
      const buffer = Buffer.from(match[2], 'base64');
      const filename = `img_${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${ext}`;
      fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
      return sendJson(res, 200, { url: `/uploads/${filename}` });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  // Serve uploaded images
  if (urlPath.startsWith('/uploads/')) {
    const safeName = path.basename(urlPath);
    return serveStatic(res, path.join(UPLOADS_DIR, safeName));
  }

  // Serve static frontend files
  if (urlPath === '/' || urlPath === '/index.html') {
    return serveStatic(res, path.join(ROOT_DIR, 'index.html'));
  }
  if (urlPath === '/styles.css' || urlPath === '/app.js' || urlPath === '/logo-niagix.jpg') {
    return serveStatic(res, path.join(ROOT_DIR, path.basename(urlPath)));
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`NIAGIX server berjalan di http://localhost:${PORT}`);
});
