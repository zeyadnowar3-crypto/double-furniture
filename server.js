const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { db, getSetting, setSetting } = require('./db');

const app = express();
const PORT = process.env.PORT || 4000;

// التأكد من وجود مجلدات الرفع
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// كشف عنوان IP المحلي لجهاز الكمبيوتر (الواي فاي)
function getLocalIpAddress() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

// دالة تصحيح وتنسيق أرقام الواتساب المصرية والدولية بدقة 100%
function normalizeWhatsappPhone(phone) {
  if (!phone) return '';
  const arabicDigits = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
  let clean = String(phone).trim();
  for (let i = 0; i < 10; i++) {
    clean = clean.split(arabicDigits[i]).join(String(i));
  }
  clean = clean.replace(/[^0-9]/g, '');

  if (clean.startsWith('0020')) {
    clean = clean.slice(2);
  } else if (/^01[0125][0-9]{8}$/.test(clean)) {
    clean = '2' + clean;
  } else if (/^1[0125][0-9]{8}$/.test(clean)) {
    clean = '20' + clean;
  }
  return clean;
}

// جلب قائمة أرقام الواتساب المعتمدة للمتابعة
function getShowroomWhatsappNumbers() {
  let numbers = [];
  try {
    const raw = getSetting('whatsapp_numbers');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) numbers = parsed;
    }
  } catch (e) {}

  if (numbers.length === 0) {
    const legacy = getSetting('whatsapp_phone') || '';
    if (legacy && legacy !== '201000000000') {
      numbers.push({ id: 1, label: 'إدارة المعرض والمبيعات', phone: legacy, is_default: true });
    }
  }
  return numbers;
}

// إدارة رابط ونفق Cloudflare الداخلي بشكل مباشر ومستقر
let currentTunnelUrl = null;
let tunnelProc = null;
let tunnelRestartTimer = null;

function getTunnelUrl() {
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  if (process.env.RAILWAY_STATIC_URL) return `https://${process.env.RAILWAY_STATIC_URL}`;
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL;
  if (currentTunnelUrl) return currentTunnelUrl;
  const tunnelFile = path.join(__dirname, 'public', 'tunnel-url.txt');
  if (fs.existsSync(tunnelFile)) {
    try {
      const u = fs.readFileSync(tunnelFile, 'utf8').trim();
      if (u && u.startsWith('http')) return u;
    } catch (e) {}
  }
  return null;
}

function startCloudflareTunnel() {
  if (process.env.RENDER || process.env.RENDER_EXTERNAL_URL || process.env.RAILWAY_STATIC_URL || process.env.RAILWAY_PUBLIC_DOMAIN) {
    console.log('[Cloud]: يعمل الآن على السيرفر السحابي (Cloud). النفق المحلي غير مطلوب.');
    return;
  }
  const cloudflaredExe = path.join(__dirname, 'cloudflared.exe');
  if (!fs.existsSync(cloudflaredExe)) {
    console.log('[Tunnel]: cloudflared.exe غير موجود في مجلد المعرض.');
    return;
  }

  if (tunnelProc) {
    try { tunnelProc.kill(); } catch (e) {}
    tunnelProc = null;
  }

  console.log(`[Tunnel]: بدء تشغيل نفق Cloudflare للمنفذ ${PORT}...`);

  try {
    tunnelProc = spawn(cloudflaredExe, ['tunnel', '--url', `http://localhost:${PORT}`], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const handleOutput = (chunk) => {
      const text = chunk.toString();
      const match = text.match(/https:\/\/[a-z0-9\-]+\.trycloudflare\.com/i);
      if (match) {
        const foundUrl = match[0];
        if (currentTunnelUrl !== foundUrl) {
          currentTunnelUrl = foundUrl;
          console.log(`[Tunnel Active]: ${foundUrl}`);
          try {
            fs.writeFileSync(path.join(__dirname, 'public', 'tunnel-url.txt'), foundUrl, 'utf8');
          } catch (e) {}
        }
      }
    };

    tunnelProc.stdout.on('data', handleOutput);
    tunnelProc.stderr.on('data', handleOutput);

    tunnelProc.on('exit', (code) => {
      console.warn(`[Tunnel Exited]: انقطع النفق بكود ${code}، جاري إعادة الاتصال تلقائياً بعد 4 ثوانٍ...`);
      tunnelProc = null;
      if (tunnelRestartTimer) clearTimeout(tunnelRestartTimer);
      tunnelRestartTimer = setTimeout(startCloudflareTunnel, 4000);
    });

    tunnelProc.on('error', (err) => {
      console.error('[Tunnel Error]:', err.message);
    });
  } catch (err) {
    console.error('[Tunnel Spawn Error]:', err.message);
    if (tunnelRestartTimer) clearTimeout(tunnelRestartTimer);
    tunnelRestartTimer = setTimeout(startCloudflareTunnel, 8000);
  }
}

function cleanupTunnel() {
  if (tunnelRestartTimer) clearTimeout(tunnelRestartTimer);
  if (tunnelProc) {
    try { tunnelProc.kill(); } catch (e) {}
    tunnelProc = null;
  }
}
process.on('exit', cleanupTunnel);
process.on('SIGINT', () => { cleanupTunnel(); process.exit(); });
process.on('SIGTERM', () => { cleanupTunnel(); process.exit(); });

// إعدادات الحجم المسموح للبيانات والصور المرفوعة
app.use(express.json({ limit: '35mb' }));
app.use(express.urlencoded({ extended: true, limit: '35mb' }));

// تمكين CORS للسماح بالوصول من الموبايل والشبكات المختلفة دون أي حجب
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-client-passcode, x-admin-pin');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// منع تخزين الكاش للصفحات الحساسة
app.use((req, res, next) => {
  if (req.path === '/' || req.path === '/admin' || req.path.endsWith('.html') || req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

// خدمة الملفات الثابتة
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  maxAge: 0
}));

// ================= معلومات السيرفر والروابط =================
app.get('/api/server-info', (req, res) => {
  const localIp = getLocalIpAddress();
  const localUrl = `http://${localIp}:${PORT}`;
  const tunnelUrl = getTunnelUrl() || getSetting('custom_public_url');
  const preferredUrl = tunnelUrl || localUrl;

  res.json({
    localIp,
    localPort: PORT,
    localUrl,
    tunnelUrl: tunnelUrl || null,
    preferredUrl
  });
});

// ================= دوال التحقق والحماية =================
function authenticateClient(req) {
  try {
    const code = req.headers['x-client-passcode'] || req.query.code || (req.body && req.body.passcode);
    if (!code) return null;
    const normalized = String(code).trim();
    const client = db.prepare('SELECT * FROM clients WHERE LOWER(passcode) = LOWER(?) AND is_active = 1').get(normalized);
    if (client) {
      db.prepare("UPDATE clients SET last_login_at = datetime('now', 'localtime') WHERE id = ?").run(client.id);
    }
    return client;
  } catch (e) {
    console.error('[ClientAuth Error]:', e.message);
    return null;
  }
}

function authenticateAdmin(req) {
  try {
    const token = req.headers['x-admin-token'];
    if (token) {
      const parts = String(token).split(':');
      if (parts.length >= 2) {
        const adminId = parseInt(parts[0], 10);
        const admin = db.prepare('SELECT * FROM admins WHERE id = ? AND is_active = 1').get(adminId);
        if (admin && admin.password === parts.slice(1).join(':')) {
          req.admin = admin;
          return admin;
        }
      }
    }

    const pin = req.headers['x-admin-pin'] || req.query.admin_pin || (req.body && req.body.admin_pin);
    if (!pin) return false;
    const cleanPin = String(pin).trim();

    // فحص في جدول المديرين
    const adminByPass = db.prepare('SELECT * FROM admins WHERE (password = ? OR username = ?) AND is_active = 1').get(cleanPin, cleanPin);
    if (adminByPass) {
      req.admin = adminByPass;
      return adminByPass;
    }

    // فحص رمز PIN العام في الإعدادات للتوافق
    const currentPin = getSetting('admin_pin') || '1234';
    if (cleanPin === String(currentPin).trim()) {
      req.admin = { id: 1, name: 'المدير العام', username: 'admin', role: 'super_admin' };
      return req.admin;
    }

    return false;
  } catch (e) {
    console.error('[AdminAuth Error]:', e.message);
    return false;
  }
}

function requireClientAuth(req, res, next) {
  const client = authenticateClient(req);
  if (!client) {
    if (authenticateAdmin(req)) {
      req.isAdmin = true;
      req.client = { id: 0, name: 'المدير (معاينة)', passcode: 'ADMIN' };
      return next();
    }
    return res.status(401).json({ error: 'عفواً، برجاء إدخال كود دخول صحيح وصالح للدخول إلى المعرض.' });
  }
  req.client = client;
  next();
}

function requireAdminAuth(req, res, next) {
  if (!authenticateAdmin(req)) {
    return res.status(401).json({ error: 'غير مصرح: رمز PIN الخاص بالإدارة غير صحيح' });
  }
  next();
}

function saveBase64Image(base64Str) {
  if (!base64Str || typeof base64Str !== 'string') return null;
  const match = base64Str.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
  if (!match) return null;
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1].replace('+xml', '');
  const buffer = Buffer.from(match[2], 'base64');
  const filename = `item-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  const filepath = path.join(uploadsDir, filename);
  fs.writeFileSync(filepath, buffer);
  return `/uploads/${filename}`;
}

// إضافة إشعار جديد للنظام (للعميل أو الأدمن)
function addNotification(target, title, body, type, refId = null) {
  try {
    db.prepare(`
      INSERT INTO notifications (target, title, body, type, ref_id, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, 0, datetime('now', 'localtime'))
    `).run(target, title, body, type, refId);
  } catch (e) {
    console.error('[Notification Insert Error]:', e.message);
  }
}

// ================= مسارات العميل =================
app.post('/api/client/login', (req, res) => {
  try {
    const { passcode } = req.body;
    if (!passcode) return res.status(400).json({ error: 'برجاء إدخال كود الدخول' });

    const client = db.prepare('SELECT id, name, phone, passcode, is_active FROM clients WHERE LOWER(passcode) = LOWER(?)').get(String(passcode).trim());

    if (!client) {
      return res.status(401).json({ error: 'كود الدخول غير موجود، يرجى التأكد من الكود الممنوح لك.' });
    }
    if (!client.is_active) {
      return res.status(403).json({ error: 'تم إيقاف صلاحية الدخول الخاصة بهذا الحساب، يرجى مراجعة إدارة المعرض.' });
    }

    db.prepare("UPDATE clients SET last_login_at = datetime('now', 'localtime') WHERE id = ?").run(client.id);

    res.json({
      success: true,
      client: {
        id: client.id,
        name: client.name,
        phone: client.phone,
        passcode: client.passcode
      },
      showroom: {
        name: getSetting('showroom_name'),
        welcome_message: getSetting('welcome_message'),
        whatsapp_phone: getSetting('whatsapp_phone'),
        whatsapp_numbers: getShowroomWhatsappNumbers(),
        currency: getSetting('currency')
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'حدث خطأ في النظام: ' + err.message });
  }
});

app.get('/api/catalog', requireClientAuth, (req, res) => {
  try {
    const { category, search } = req.query;
    let sql = 'SELECT * FROM products WHERE is_available = 1';
    const params = [];

    if (category && category !== 'الكل') {
      sql += ' AND category = ?';
      params.push(category);
    }

    if (search && search.trim()) {
      sql += ' AND (title LIKE ? OR description LIKE ?)';
      params.push(`%${search.trim()}%`, `%${search.trim()}%`);
    }

    sql += ' ORDER BY id DESC';
    const products = db.prepare(sql).all(...params);
    const categories = db.prepare('SELECT name FROM categories ORDER BY sort_order ASC, id ASC').all().map(c => c.name);

    res.json({
      success: true,
      client: req.client,
      categories,
      products,
      showroom: {
        name: getSetting('showroom_name'),
        welcome_message: getSetting('welcome_message'),
        whatsapp_phone: getSetting('whatsapp_phone'),
        whatsapp_numbers: getShowroomWhatsappNumbers(),
        currency: getSetting('currency')
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'حدث خطأ في جلب الكتالوج: ' + err.message });
  }
});

app.post('/api/orders', requireClientAuth, (req, res) => {
  try {
    const { items, notes } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'سلة الطلب فارغة، برجاء اختيار قطعة واحدة على الأقل.' });
    }

    const client = req.client;
    let totalAmount = 0;
    let totalCount = 0;
    const processedItems = [];

    const getProduct = db.prepare('SELECT id, title, price, is_available FROM products WHERE id = ?');

    for (const it of items) {
      const prod = getProduct.get(it.productId);
      if (!prod) continue;
      const qty = Math.max(1, parseInt(it.quantity, 10) || 1);
      const subtotal = prod.price * qty;
      totalAmount += subtotal;
      totalCount += qty;
      processedItems.push({
        productId: prod.id,
        productTitle: prod.title,
        unitPrice: prod.price,
        quantity: qty,
        subtotal,
        notes: it.notes || ''
      });
    }

    if (processedItems.length === 0) {
      return res.status(400).json({ error: 'لم يتم العثور على المنتجات المطلوبة.' });
    }

    const orderNum = `ORD-${Date.now().toString().slice(-6)}`;

    const insertOrder = db.prepare(`
      INSERT INTO orders (order_number, client_id, client_name, client_phone, total_amount, items_count, notes, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'جديد', datetime('now', 'localtime'))
    `);

    const insertOrderItem = db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_title, unit_price, quantity, subtotal, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = db.transaction(() => {
      const result = insertOrder.run(
        orderNum,
        client.id || null,
        client.name,
        client.phone || '',
        totalAmount,
        totalCount,
        notes || ''
      );
      const orderId = result.lastInsertRowid;
      for (const item of processedItems) {
        insertOrderItem.run(
          orderId,
          item.productId,
          item.productTitle,
          item.unitPrice,
          item.quantity,
          item.subtotal,
          item.notes
        );
      }
      return orderId;
    });

    const orderId = transaction();

    // إرسال إشعار فوري للأدمن على اللاب والموبايل
    addNotification('admin', `📦 طلبية جديدة برقم #${orderNum}`, `العميل: ${client.name} أرسل طلبية جديدة (${totalCount} قطع) بقيمة ${totalAmount.toLocaleString('ar-EG')} ج.م.`, 'new_order', orderId);

    const currency = getSetting('currency') || 'ج.م';
    let waText = `*طلب أثاث جديد من المعرض* 🪑\n`;
    waText += `--------------------------\n`;
    waText += `*رقم الطلبية:* ${orderNum}\n`;
    waText += `*العميل:* ${client.name}\n`;
    if (client.phone) waText += `*الهاتف:* ${client.phone}\n`;
    waText += `--------------------------\n`;
    waText += `*القطع المطلوبة:*\n`;

    processedItems.forEach((it, idx) => {
      waText += `${idx + 1}. *${it.productTitle}*\n`;
      waText += `   العدد: ${it.quantity} × ${it.unitPrice.toLocaleString('ar-EG')} = *${it.subtotal.toLocaleString('ar-EG')} ${currency}*\n`;
      if (it.notes) waText += `   ملاحظة: ${it.notes}\n`;
    });

    waText += `--------------------------\n`;
    waText += `*الإجمالي:* *${totalAmount.toLocaleString('ar-EG')} ${currency}*\n`;
    if (notes) waText += `*ملاحظات إضافية:* ${notes}\n`;

    const waNumbers = getShowroomWhatsappNumbers();
    const whatsappLinks = waNumbers.map(n => {
      const cleanP = normalizeWhatsappPhone(n.phone);
      return {
        label: n.label,
        phone: n.phone,
        url: cleanP ? `https://wa.me/${cleanP}?text=${encodeURIComponent(waText)}` : `https://wa.me/?text=${encodeURIComponent(waText)}`
      };
    });

    let primaryWaUrl = '';
    if (whatsappLinks.length > 0) {
      const def = whatsappLinks.find(x => x.is_default) || whatsappLinks[0];
      primaryWaUrl = def.url;
    } else {
      const rawPhone = getSetting('whatsapp_phone') || '';
      const cleanP = normalizeWhatsappPhone(rawPhone);
      primaryWaUrl = cleanP ? `https://wa.me/${cleanP}?text=${encodeURIComponent(waText)}` : `https://wa.me/?text=${encodeURIComponent(waText)}`;
    }

    res.json({
      success: true,
      orderId,
      orderNumber: orderNum,
      totalAmount,
      totalCount,
      whatsappUrl: primaryWaUrl,
      whatsappLinks,
      whatsappText: waText
    });
  } catch (err) {
    res.status(500).json({ error: 'فشل إرسال الطلبية: ' + err.message });
  }
});

// ================= مسارات الإدارة =================
app.post('/api/admin/login', (req, res) => {
  try {
    const { username, password, pin } = req.body || {};
    const pass = String(password || pin || '').trim();
    const user = String(username || '').trim();
    let admin = null;

    // 1. بحث باسم المستخدم وكلمة المرور إذا تم إدخال الاثنين
    if (user && pass) {
      admin = db.prepare('SELECT * FROM admins WHERE LOWER(username) = LOWER(?) AND password = ?').get(user, pass);
    }

    // 2. إذا لم يعثر عليه، نبحث بكلمة المرور في جدول المديرين
    if (!admin && pass) {
      admin = db.prepare('SELECT * FROM admins WHERE password = ?').get(pass);
    }

    // 3. فحص الباسوورد ضد رمز PIN العام في الإعدادات
    if (!admin && pass) {
      const defaultPin = getSetting('admin_pin') || '1234';
      if (pass === String(defaultPin).trim()) {
        admin = db.prepare("SELECT * FROM admins WHERE is_active = 1 ORDER BY id DESC").get();
      }
    }

    // 4. إذا كتب الباسوورد في خانة اسم المستخدم بالخطأ
    if (!admin && user && !pass) {
      admin = db.prepare('SELECT * FROM admins WHERE password = ?').get(user);
    }

    if (!admin) {
      return res.status(401).json({ error: 'بيانات الدخول غير صحيحة، يرجى كتابة باسوورد صحيح' });
    }

    if (!admin.is_active) {
      return res.status(403).json({ error: 'تم إيقاف صلاحية هذا الحساب من قبل الإدارة العليا' });
    }

    db.prepare("UPDATE admins SET last_login_at = datetime('now', 'localtime') WHERE id = ?").run(admin.id);

    const token = `${admin.id}:${admin.password}`;

    res.json({
      success: true,
      token,
      admin: {
        id: admin.id,
        name: admin.name,
        username: admin.username,
        role: admin.role
      },
      showroom: {
        name: getSetting('showroom_name'),
        currency: getSetting('currency'),
        whatsapp_phone: getSetting('whatsapp_phone')
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// قائمة فريق الإدارة والمديرين
app.get('/api/admin/staff', requireAdminAuth, (req, res) => {
  try {
    const staff = db.prepare('SELECT id, name, username, password, role, is_active, created_at, last_login_at FROM admins ORDER BY id ASC').all();
    res.json({ staff });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// إضافة مدير جديد وتحديد كلمة مرور له
app.post('/api/admin/staff', requireAdminAuth, (req, res) => {
  try {
    const body = req.body || {};
    const { name, username, password, role } = body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'اسم المدير مطلوب' });
    if (!username || !username.trim()) return res.status(400).json({ error: 'اسم المستخدم مطلوب' });
    if (!password || !password.trim()) return res.status(400).json({ error: 'كلمة المرور / الباسوورد مطلوبة' });

    const cleanUser = username.trim().toLowerCase();
    const existing = db.prepare('SELECT id FROM admins WHERE LOWER(username) = ?').get(cleanUser);
    if (existing) {
      return res.status(400).json({ error: 'اسم المستخدم هذا مستخدم بالفعل لمدير آخر' });
    }

    const result = db.prepare(`
      INSERT INTO admins (name, username, password, role, is_active, created_at)
      VALUES (?, ?, ?, ?, 1, datetime('now', 'localtime'))
    `).run(name.trim(), cleanUser, String(password).trim(), role || 'admin');

    res.json({ success: true, adminId: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// تعديل بيانات المدير أو باسوورده أو تفعيله/إيقافه
app.put('/api/admin/staff/:id', requireAdminAuth, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, username, password, role, is_active } = req.body;

    const current = db.prepare('SELECT * FROM admins WHERE id = ?').get(id);
    if (!current) return res.status(404).json({ error: 'المدير غير موجود' });

    if (username && username.trim().toLowerCase() !== current.username.toLowerCase()) {
      const existing = db.prepare('SELECT id FROM admins WHERE LOWER(username) = ? AND id != ?').get(username.trim().toLowerCase(), id);
      if (existing) {
        return res.status(400).json({ error: 'اسم المستخدم هذا مستخدم لمدير آخر' });
      }
    }

    db.prepare(`
      UPDATE admins
      SET name = COALESCE(?, name),
          username = COALESCE(?, username),
          password = COALESCE(?, password),
          role = COALESCE(?, role),
          is_active = COALESCE(?, is_active)
      WHERE id = ?
    `).run(
      name ? name.trim() : null,
      username ? username.trim().toLowerCase() : null,
      password ? String(password).trim() : null,
      role || null,
      is_active !== undefined ? (is_active ? 1 : 0) : null,
      id
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// حذف مدير
app.delete('/api/admin/staff/:id', requireAdminAuth, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const count = db.prepare('SELECT COUNT(*) as count FROM admins WHERE is_active = 1').get().count;
    if (count <= 1) {
      return res.status(400).json({ error: 'لا يمكن حذف المدير الوحيد في النظام' });
    }

    db.prepare('DELETE FROM admins WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/stats', requireAdminAuth, (req, res) => {
  try {
    const clientsTotal = db.prepare('SELECT COUNT(*) as count FROM clients').get().count;
    const clientsActive = db.prepare('SELECT COUNT(*) as count FROM clients WHERE is_active = 1').get().count;
    const productsTotal = db.prepare('SELECT COUNT(*) as count FROM products').get().count;
    const ordersTotal = db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
    const newOrders = db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'جديد'").get().count;
    const ordersSum = db.prepare('SELECT COALESCE(SUM(total_amount), 0) as total FROM orders').get().total;

    res.json({
      clientsTotal,
      clientsActive,
      productsTotal,
      ordersTotal,
      newOrders,
      ordersSum
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/clients', requireAdminAuth, (req, res) => {
  try {
    const clients = db.prepare(`
      SELECT c.*, 
        (SELECT COUNT(*) FROM orders WHERE client_id = c.id) as orders_count,
        (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE client_id = c.id) as total_spent
      FROM clients c
      ORDER BY c.id DESC
    `).all();
    res.json({ clients });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/clients', requireAdminAuth, (req, res) => {
  try {
    const body = req.body || {};
    const { name, phone, passcode, notes, is_active } = body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'اسم العميل مطلوب' });
    if (!passcode || !passcode.trim()) return res.status(400).json({ error: 'كود / باسوورد الدخول مطلوب' });

    const cleanPasscode = String(passcode).trim();
    const existing = db.prepare('SELECT id FROM clients WHERE LOWER(passcode) = LOWER(?)').get(cleanPasscode);
    if (existing) {
      return res.status(400).json({ error: 'هذا الكود مستخدم بالفعل لعميل آخر، يرجى اختيار كود مختلف' });
    }

    const result = db.prepare(`
      INSERT INTO clients (name, phone, passcode, notes, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `).run(name.trim(), phone || '', cleanPasscode, notes || '', is_active !== false ? 1 : 0);

    res.json({ success: true, clientId: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/clients/:id', requireAdminAuth, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, phone, passcode, notes, is_active } = req.body;

    const current = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
    if (!current) return res.status(404).json({ error: 'العميل غير موجود' });

    if (passcode && passcode.trim().toLowerCase() !== current.passcode.toLowerCase()) {
      const existing = db.prepare('SELECT id FROM clients WHERE LOWER(passcode) = LOWER(?) AND id != ?').get(passcode.trim(), id);
      if (existing) {
        return res.status(400).json({ error: 'هذا الكود مستخدم لعميل آخر' });
      }
    }

    db.prepare(`
      UPDATE clients 
      SET name = COALESCE(?, name),
          phone = COALESCE(?, phone),
          passcode = COALESCE(?, passcode),
          notes = COALESCE(?, notes),
          is_active = COALESCE(?, is_active)
      WHERE id = ?
    `).run(
      name !== undefined ? name.trim() : null,
      phone !== undefined ? phone : null,
      passcode !== undefined ? passcode.trim() : null,
      notes !== undefined ? notes : null,
      is_active !== undefined ? (is_active ? 1 : 0) : null,
      id
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/clients/:id', requireAdminAuth, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    db.prepare('DELETE FROM clients WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/products', requireAdminAuth, (req, res) => {
  try {
    const products = db.prepare('SELECT * FROM products ORDER BY id DESC').all();
    const categories = db.prepare('SELECT name FROM categories ORDER BY sort_order ASC, id ASC').all().map(c => c.name);
    res.json({ products, categories });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/products', requireAdminAuth, (req, res) => {
  try {
    const body = req.body || {};
    const { title, category, price, old_price, description, badge, stock_quantity, image_base64, images_base64, image_url } = body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'اسم الموديل مطلوب' });
    if (price === undefined || isNaN(price)) return res.status(400).json({ error: 'السعر مطلوب' });

    // تجميع وحفظ جميع صور الموديل (صورة واحدة أو صور متعددة)
    const allImages = [];
    if (image_url && typeof image_url === 'string') {
      allImages.push(image_url);
    }

    if (image_base64 && typeof image_base64 === 'string') {
      const saved = saveBase64Image(image_base64);
      if (saved) allImages.push(saved);
    }

    if (Array.isArray(images_base64)) {
      for (const b64 of images_base64) {
        if (b64 && typeof b64 === 'string') {
          const saved = saveBase64Image(b64);
          if (saved) allImages.push(saved);
        }
      }
    }

    if (allImages.length === 0) {
      allImages.push('/images/placeholder-rokna.svg');
    }

    const finalImageUrl = allImages[0];
    const finalImagesJson = JSON.stringify(allImages);
    const parsedStock = (stock_quantity !== undefined && !isNaN(stock_quantity)) ? Math.max(0, parseInt(stock_quantity, 10)) : 1;

    const result = db.prepare(`
      INSERT INTO products (title, category, price, old_price, description, image_url, images_json, stock_quantity, badge, is_available, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now', 'localtime'))
    `).run(
      title.trim(),
      category || 'عام',
      parseFloat(price),
      old_price ? parseFloat(old_price) : 0,
      description || '',
      finalImageUrl,
      finalImagesJson,
      parsedStock,
      badge || ''
    );

    const newProdId = result.lastInsertRowid;
    // إرسال إشعار فوري لجميع العملاء بوجود موديل جديد
    addNotification('client', '✨ موديل جديد في المعرض!', `تم إضافة موديل جديد: "${title.trim()}" بسعر ${parseFloat(price).toLocaleString('ar-EG')} ج.م في قسم ${category || 'العام'}.`, 'new_product', newProdId);

    res.json({ success: true, productId: newProdId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/products/:id', requireAdminAuth, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { title, category, price, old_price, description, badge, is_available, stock_quantity, image_base64, images_base64, existing_images, image_url } = req.body;

    const currentProd = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!currentProd) return res.status(404).json({ error: 'الموديل غير موجود' });

    // إدارة الصور المحدثة
    let finalImageUrl = currentProd.image_url;
    let finalImagesJson = currentProd.images_json || '[]';

    // إذا أرسل العميل قائمة بالصور المحتفظ بها أو صور جديدة
    if (existing_images !== undefined || images_base64 !== undefined || image_base64 || image_url) {
      const imagesList = [];

      // 1. إضافة الصور القديمة المعتمدة
      if (Array.isArray(existing_images)) {
        for (const img of existing_images) {
          if (typeof img === 'string' && img.trim()) imagesList.push(img.trim());
        }
      } else if (image_url) {
        imagesList.push(image_url);
      }

      // 2. حفظ وإضافة الصور الجديدة
      if (image_base64) {
        const saved = saveBase64Image(image_base64);
        if (saved) imagesList.push(saved);
      }
      if (Array.isArray(images_base64)) {
        for (const b64 of images_base64) {
          if (b64 && typeof b64 === 'string') {
            const saved = saveBase64Image(b64);
            if (saved) imagesList.push(saved);
          }
        }
      }

      if (imagesList.length > 0) {
        finalImageUrl = imagesList[0];
        finalImagesJson = JSON.stringify(imagesList);
      }
    }

    const parsedStock = (stock_quantity !== undefined && stock_quantity !== null && !isNaN(stock_quantity)) 
      ? Math.max(0, parseInt(stock_quantity, 10)) 
      : currentProd.stock_quantity;

    db.prepare(`
      UPDATE products
      SET title = COALESCE(?, title),
          category = COALESCE(?, category),
          price = COALESCE(?, price),
          old_price = COALESCE(?, old_price),
          description = COALESCE(?, description),
          badge = COALESCE(?, badge),
          is_available = COALESCE(?, is_available),
          stock_quantity = COALESCE(?, stock_quantity),
          image_url = COALESCE(?, image_url),
          images_json = COALESCE(?, images_json)
      WHERE id = ?
    `).run(
      title ? title.trim() : null,
      category || null,
      price !== undefined ? parseFloat(price) : null,
      old_price !== undefined ? parseFloat(old_price) : null,
      description !== undefined ? description : null,
      badge !== undefined ? badge : null,
      is_available !== undefined ? (is_available ? 1 : 0) : null,
      parsedStock,
      finalImageUrl,
      finalImagesJson,
      id
    );

    // إذا تم تعديل السعر، إرسال إشعار فوري لجميع العملاء
    if (price !== undefined && parseFloat(price) !== currentProd.price) {
      const newP = parseFloat(price);
      addNotification(
        'client',
        '📢 تحديث سعر في المعرض',
        `تم تعديل سعر موديل "${title || currentProd.title}" ليصبح ${newP.toLocaleString('ar-EG')} ج.م (السعر السابق: ${currentProd.price.toLocaleString('ar-EG')} ج.م).`,
        'price_update',
        id
      );
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/products/:id', requireAdminAuth, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/orders', requireAdminAuth, (req, res) => {
  try {
    const orders = db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
    const getItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
    const enriched = orders.map(ord => ({
      ...ord,
      items: getItems.all(ord.id)
    }));
    res.json({ orders: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/orders/:id/status', requireAdminAuth, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'الحالة مطلوبة' });

    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/orders/:id', requireAdminAuth, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    db.prepare('DELETE FROM orders WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= مسارات الإشعارات والتنبيهات المباشرة =================

// إشعارات العميل (تحديثات الأسعار والموديلات الجديدة)
app.get('/api/client/notifications', requireClientAuth, (req, res) => {
  try {
    const list = db.prepare("SELECT * FROM notifications WHERE target = 'client' ORDER BY id DESC LIMIT 25").all();
    const maxRow = db.prepare("SELECT MAX(id) as maxId FROM notifications WHERE target = 'client'").get();
    res.json({ notifications: list, maxId: maxRow && maxRow.maxId ? maxRow.maxId : 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// فحص واستلام إشعارات الأدمن للطلبيات الجديدة (Polling للموبايل واللاب)
app.get('/api/admin/notifications/poll', requireAdminAuth, (req, res) => {
  try {
    const lastId = parseInt(req.query.last_id, 10) || 0;
    const newItems = db.prepare("SELECT * FROM notifications WHERE target = 'admin' AND id > ? ORDER BY id ASC").all(lastId);
    const maxRow = db.prepare("SELECT MAX(id) as maxId FROM notifications WHERE target = 'admin'").get();
    const unreadCount = db.prepare("SELECT COUNT(*) as count FROM notifications WHERE target = 'admin' AND is_read = 0").get().count;
    res.json({ notifications: newItems, maxId: maxRow && maxRow.maxId ? maxRow.maxId : 0, unreadCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/notifications/read-all', requireAdminAuth, (req, res) => {
  try {
    db.prepare("UPDATE notifications SET is_read = 1 WHERE target = 'admin'").run();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// فحص صحة واستقرار الخادم السحابي ومنع توقفه
app.get(['/health', '/api/health'], (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    memory: process.memoryUsage()
  });
});

app.get('/api/admin/settings', requireAdminAuth, (req, res) => {
  try {
    const settingsRows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    for (const s of settingsRows) settings[s.key] = s.value;
    settings.whatsapp_numbers = getShowroomWhatsappNumbers();
    res.json({ settings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/settings', requireAdminAuth, (req, res) => {
  try {
    const { showroom_name, admin_pin, whatsapp_phone, whatsapp_numbers, currency, welcome_message, custom_public_url } = req.body;
    if (showroom_name) setSetting('showroom_name', showroom_name.trim());
    if (admin_pin) setSetting('admin_pin', admin_pin.trim());
    if (currency) setSetting('currency', currency.trim());
    if (welcome_message) setSetting('welcome_message', welcome_message.trim());
    if (custom_public_url !== undefined) setSetting('custom_public_url', custom_public_url.trim());

    if (Array.isArray(whatsapp_numbers)) {
      const sanitized = whatsapp_numbers.map((n, idx) => ({
        id: n.id || (idx + 1),
        label: (n.label && n.label.trim()) || 'متابعة المعرض',
        phone: String(n.phone || '').trim(),
        is_default: !!n.is_default
      }));
      setSetting('whatsapp_numbers', JSON.stringify(sanitized));
      const def = sanitized.find(x => x.is_default) || sanitized[0];
      if (def && def.phone) {
        setSetting('whatsapp_phone', def.phone);
      }
    } else if (whatsapp_phone) {
      setSetting('whatsapp_phone', whatsapp_phone.trim());
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// واجهات العرض
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'المسار غير موجود' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// معالج الأخطاء العام لضمان عدم توقف السيرفر تحت أي ظرف
app.use((err, req, res, next) => {
  console.error('[Global App Error Caught]:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'حدث خطأ مؤقت في السيرفر، تم استدراكه بنجاح.' });
});

// تشغيل الخادم مع حماية كاملة ضد التوقف
const server = app.listen(PORT, '0.0.0.0', () => {
  const localIp = getLocalIpAddress();
  console.log(`====================================================`);
  console.log(`🛋️ معرض الأثاث الخاص (Private Furniture Showroom)`);
  console.log(`💻 رابط اللاب/الكمبيوتر: http://localhost:${PORT}`);
  console.log(`📱 رابط الموبايل (واي فاي): http://${localIp}:${PORT}`);
  console.log(`🔑 لوحة إدارة المعرض: http://localhost:${PORT}/admin`);
  console.log(`====================================================`);

  // تشغيل نفق الإنترنت الآمن تلقائياً
  startCloudflareTunnel();
});

server.on('error', (err) => {
  console.error('[Server Error]:', err.message);
});

// حماية ضد السقوط أو إيقاف السيرفر
process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Unhandled Rejection at]:', promise, 'reason:', reason);
});
