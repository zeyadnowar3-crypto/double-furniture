const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, 'showroom.db');
const db = new Database(dbPath);

// تمكين القيود والمؤشرات السريعة ومنع التعليق
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      passcode TEXT UNIQUE NOT NULL,
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      price REAL NOT NULL,
      old_price REAL DEFAULT 0,
      description TEXT,
      image_url TEXT NOT NULL,
      images_json TEXT DEFAULT '[]',
      is_available INTEGER NOT NULL DEFAULT 1,
      badge TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT UNIQUE NOT NULL,
      client_id INTEGER,
      client_name TEXT NOT NULL,
      client_phone TEXT,
      total_amount REAL NOT NULL,
      items_count INTEGER NOT NULL,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'جديد',
      created_at TEXT NOT NULL,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER,
      product_title TEXT NOT NULL,
      unit_price REAL NOT NULL,
      quantity INTEGER NOT NULL,
      subtotal REAL NOT NULL,
      notes TEXT,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      type TEXT NOT NULL,
      ref_id INTEGER,
      is_read INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);

  // إعدادات افتراضية
  const setSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  setSetting.run('showroom_name', 'معرض DOUBLE FURNITURE');
  setSetting.run('admin_pin', '1234');
  setSetting.run('whatsapp_phone', '201000000000');
  setSetting.run('currency', 'ج.م');
  setSetting.run('welcome_message', 'أهلاً بكم في معرضنا الخاص للأثاث — نرجو اختيار ما يناسبكم وإرسال الكميات المطلوبة');

  // إضافة حساب المدير العام الافتراضي إن كان الجدول فارغ
  const adminCount = db.prepare('SELECT COUNT(*) as count FROM admins').get().count;
  if (adminCount === 0) {
    db.prepare(`
      INSERT INTO admins (name, username, password, role, is_active, created_at)
      VALUES (?, ?, ?, 'super_admin', 1, datetime('now', 'localtime'))
    `).run('المدير العام', 'admin', '1234');
  }

  // إضافة تصنيفات افتراضية إن كانت فارغة
  const catCount = db.prepare('SELECT COUNT(*) as count FROM categories').get().count;
  if (catCount === 0) {
    const insertCat = db.prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)');
    const cats = [
      ['ركنات مودرن', 1],
      ['أطقم صالون', 2],
      ['أنتريهات', 3],
      ['غرف نوم', 4],
      ['غرف سفرة', 5],
      ['ترابيزات وبوفيهات', 6]
    ];
    for (const [name, order] of cats) {
      insertCat.run(name, order);
    }
  }

  // إضافة عملاء تجريبيين إن كان الجدول فارغ
  const clientCount = db.prepare('SELECT COUNT(*) as count FROM clients').get().count;
  if (clientCount === 0) {
    const insertClient = db.prepare(`
      INSERT INTO clients (name, phone, passcode, notes, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `);
    insertClient.run('معرض الصفوة - طنطا', '01012345678', 'SAFWA-77', 'عميل جملة معتمد - خصم خاص', 1);
    insertClient.run('معرض الهلال للأثاث', '01123456789', 'HELAL-99', 'عميل صالونات وركن', 1);
    insertClient.run('معرض الأناقة - المنصورة', '01234567890', 'ANAKA-55', 'معرض نشط', 1);
  }

  // إضافة منتجات تجريبية إن كان جدول المنتجات فارغ
  const prodCount = db.prepare('SELECT COUNT(*) as count FROM products').get().count;
  if (prodCount === 0) {
    const insertProd = db.prepare(`
      INSERT INTO products (title, category, price, old_price, description, image_url, images_json, is_available, badge, created_at)
      VALUES (?, ?, ?, ?, ?, ?, '[]', 1, ?, datetime('now', 'localtime'))
    `);

    // نماذج أثاث بصور SVG أنيقة وفائقة الوضوح
    insertProd.run(
      'ركنة مودرن كازابلانكا L-Shape فاخرة',
      'ركنات مودرن',
      24500,
      27000,
      'خشب زان أحمر روماني مع قماش كتان همر مستورد وإسفنج كثافة 36 سوفت عالي المرونة. مقاس: 3.20م × 2.40م + بف هدية.',
      '/images/placeholder-rokna.svg',
      'الأكثر طلباً'
    );

    insertProd.run(
      'طقم أنتريه ميرال نيوكلاسيك (كنبة ۳ + كنبة ۲ + ۲ فوتيه)',
      'أنتريهات',
      32000,
      35000,
      'هيكل زان أحمر مجفف، تنجيد كابوتينيه يدوي مع قماش بوكليه وتر بروف وإكسسوار ستانلس ذهبي عيار 304 ضد الصدأ.',
      '/images/placeholder-antree.svg',
      'جديد المعرض'
    );

    insertProd.run(
      'صالون كوين إمبريال كلاسيك مذهب',
      'أطقم صالون',
      46000,
      50000,
      'أويما يدوي راقية زان أحمر بورقيات ذهب إيطالي أصلي، أقمشة جاكار وحرير دمكس مطرز، إسفنج طبي فاخر.',
      '/images/placeholder-salon.svg',
      'حصري'
    );

    insertProd.run(
      'غرفة نوم ماستر رويال مودرن مع دولاب جرار',
      'غرف نوم',
      58000,
      64000,
      'سرير 180سم كابوتينيه مبطن + دولاب جرار 2.80م بإضاءة LED مخفية + تسريحة هيدروليك + 2 كومود وبانكيت.',
      '/images/placeholder-bed.svg',
      'VIP'
    );

    insertProd.run(
      'سفرة مودرن ألترا 8 كراسي رخام إسباني مستورد',
      'غرف سفرة',
      42000,
      47000,
      'ترابيزة 2.20م برجامينو ورخام إسباني، شاسيه زان أحمر مع أرجل ستانلس pvd، كراسي مريحة مبطنة بالكامل.',
      '/images/placeholder-dining.svg',
      'عرض خاص'
    );
  }
}

initSchema();

module.exports = {
  db,
  getSetting(key) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
  },
  setSetting(key, value) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?').run(key, value, value);
  }
};
