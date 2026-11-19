/**
 * SW627 API v2.1 — API ONLY
 * No static frontend. No /public. No SPA fallback.
 *
 * Endpoints:
 *   GET    /api/health
 *   GET    /api/meta
 *   GET    /api/items               ?hub=&category=&batch=&search=&status=
 *   GET    /api/items/:id
 *   POST   /api/admin/login
 *   POST   /api/admin/upload        multipart, field "image"
 *   POST   /api/admin/items
 *   PATCH  /api/admin/items/:id
 *   DELETE /api/admin/items/:id
 *   GET    /api/admin/orders
 *   POST   /api/orders
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Paths ----------
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const ITEMS_FILE = path.join(DATA_DIR, 'items.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');

// ---------- Config ----------
const ADMIN_PASSCODE = process.env.SW627_ADMIN_PASSCODE || 'SW627ADMIN';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());

// ---------- Locations ----------
const ALLOWED_CITIES = ['Manila', 'Quezon City'];
const MANILA_DISTRICTS = ['Sampaloc','Ermita','Malate','Santa Cruz','Binondo','Tondo','Quiapo','Intramuros','Paco','Pandacan','Taft'];
const QC_DISTRICTS = ['Diliman','Cubao','Katipunan','Tomas Morato','Fairview','Banawe','Novaliches','Project 8','Kamuning','Libis'];
const MEETUP_SPOTS = {
  Manila: ['SM Manila','Robinsons Place Manila','UST / España','Luneta Park'],
  'Quezon City': ['SM North EDSA','TriNoma','Gateway Mall Cubao','UP Diliman']
};
const PAYMENT_METHODS = ['GCash','Maya','SeaBank / InstaPay QR','Cash on Meetup'];
const DELIVERY_METHODS = ['Lalamove','GrabExpress','Meetup'];
const BATCHES = ['LJR Batch','GX Batch','PK 4.0','1:1 Top Tier'];
const CATEGORIES = ['Sneakers','Apparel','Accessories'];
const HUBS = ['Manila Hub','Quezon City Hub'];

// ---------- Ensure dirs/files ----------
function ensurePaths() {
  [DATA_DIR, UPLOAD_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
  if (!fs.existsSync(ITEMS_FILE))  fs.writeFileSync(ITEMS_FILE,  '[]', 'utf8');
  if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, '[]', 'utf8');
}
ensurePaths();

// ---------- Multer ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    }
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(jpe?g|png|webp|gif)$/i.test(file.mimetype)) {
      return cb(new Error('Only JPG, PNG, WEBP, or GIF allowed'));
    }
    cb(null, true);
  }
});

// ---------- Middleware ----------
app.use(cors({
  origin: (origin, cb) => {
    if (ALLOWED_ORIGINS.includes('*') || !origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked: ${origin}`));
  },
  methods: ['GET','POST','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','X-Admin-Passcode']
}));
app.use(express.json({ limit: '8mb' }));

// Uploaded images served with CORS
app.use('/uploads', express.static(UPLOAD_DIR, {
  maxAge: '7d',
  setHeaders: (res) => res.setHeader('Access-Control-Allow-Origin', '*')
}));

// ---------- Helpers ----------
function readJSON(f) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch (e) { console.error(`read ${f}:`, e.message); return []; }
}
function writeJSON(f, d) { fs.writeFileSync(f, JSON.stringify(d, null, 2), 'utf8'); }
function requireAdmin(req, res, next) {
  const pass = req.headers['x-admin-passcode'] || req.body?.passcode;
  if (pass !== ADMIN_PASSCODE) return res.status(401).json({ error: 'Unauthorized' });
  next();
}
function absUrl(p) {
  if (!p) return p;
  if (/^https?:\/\//i.test(p)) return p;
  if (p.startsWith('/uploads/')) return PUBLIC_BASE_URL + p;
  return p;
}

// ================= HEALTH =================
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'sw627-api', version: '2.1', time: new Date().toISOString() });
});

// ================= META =================
app.get('/api/meta', (req, res) => {
  res.json({
    cities: ALLOWED_CITIES,
    districts: { Manila: MANILA_DISTRICTS, 'Quezon City': QC_DISTRICTS },
    meetupSpots: MEETUP_SPOTS,
    paymentMethods: PAYMENT_METHODS,
    deliveryMethods: DELIVERY_METHODS,
    batches: BATCHES,
    categories: CATEGORIES,
    hubs: HUBS
  });
});

// ================= UPLOAD =================
app.post('/api/admin/upload', requireAdmin, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const rel = `/uploads/${req.file.filename}`;
    res.status(201).json({
      success: true,
      filename: req.file.filename,
      path: rel,
      url: absUrl(rel),
      size: req.file.size,
      mimetype: req.file.mimetype
    });
  });
});

// ================= ITEMS (public) =================
app.get('/api/items', (req, res) => {
  const items = readJSON(ITEMS_FILE);
  const { hub, category, batch, search, status } = req.query;
  let list = items;
  if (hub && hub !== 'all') {
    const label = hub === 'manila' ? 'Manila Hub' : 'Quezon City Hub';
    list = list.filter(i => i.hub === label);
  }
  if (category && category !== 'all') list = list.filter(i => i.category === category);
  if (batch && batch !== 'all') list = list.filter(i => i.batch === batch);
  if (status && status !== 'all') list = list.filter(i => i.status === status);
  if (search) {
    const q = search.toLowerCase();
    list = list.filter(i => i.title.toLowerCase().includes(q) || i.batch.toLowerCase().includes(q));
  }
  res.json(list.map(i => ({ ...i, image: absUrl(i.image) })));
});

app.get('/api/items/:id', (req, res) => {
  const item = readJSON(ITEMS_FILE).find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  res.json({ ...item, image: absUrl(item.image) });
});

// ================= ADMIN AUTH =================
app.post('/api/admin/login', (req, res) => {
  if (req.body?.passcode === ADMIN_PASSCODE) return res.json({ success: true });
  res.status(401).json({ success: false, error: 'Invalid passcode' });
});

// ================= ADMIN: CREATE ITEM =================
app.post('/api/admin/items', requireAdmin, (req, res) => {
  const { title, price, batch, category, hub, sizes, image, notes } = req.body;
  const errs = [];
  if (!title?.trim()) errs.push('Title required');
  if (!price || Number(price) <= 0) errs.push('Price must be > 0');
  if (!BATCHES.includes(batch)) errs.push(`Batch must be: ${BATCHES.join(', ')}`);
  if (!CATEGORIES.includes(category)) errs.push(`Category must be: ${CATEGORIES.join(', ')}`);
  if (!HUBS.includes(hub)) errs.push(`Hub must be: ${HUBS.join(', ')}`);
  if (!Array.isArray(sizes) || !sizes.length) errs.push('At least one size');
  if (!image?.trim()) errs.push('Image required');
  if (errs.length) return res.status(400).json({ error: errs.join('; ') });

  const items = readJSON(ITEMS_FILE);
  const newItem = {
    id: crypto.randomUUID(),
    title: title.trim(),
    price: Number(price),
    batch, category, hub, sizes,
    image: image.trim(),
    notes: (notes || '').trim() || 'No QC notes provided.',
    status: 'In Stock',
    createdAt: new Date().toISOString()
  };
  items.unshift(newItem);
  writeJSON(ITEMS_FILE, items);
  res.status(201).json({ ...newItem, image: absUrl(newItem.image) });
});

// ================= ADMIN: UPDATE ITEM =================
app.patch('/api/admin/items/:id', requireAdmin, (req, res) => {
  const items = readJSON(ITEMS_FILE);
  const idx = items.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Item not found' });
  ['status','price','title','sizes','notes','image','batch','category','hub'].forEach(k => {
    if (req.body[k] !== undefined) items[idx][k] = req.body[k];
  });
  items[idx].updatedAt = new Date().toISOString();
  writeJSON(ITEMS_FILE, items);
  res.json({ ...items[idx], image: absUrl(items[idx].image) });
});

// ================= ADMIN: DELETE ITEM =================
app.delete('/api/admin/items/:id', requireAdmin, (req, res) => {
  let items = readJSON(ITEMS_FILE);
  const found = items.find(i => i.id === req.params.id);
  if (!found) return res.status(404).json({ error: 'Item not found' });
  items = items.filter(i => i.id !== req.params.id);
  writeJSON(ITEMS_FILE, items);
  if (found.image?.startsWith('/uploads/')) {
    const fp = path.join(__dirname, found.image);
    if (fs.existsSync(fp)) { try { fs.unlinkSync(fp); } catch {} }
  }
  res.json({ success: true });
});

// ================= ADMIN: ORDERS =================
app.get('/api/admin/orders', requireAdmin, (req, res) => res.json(readJSON(ORDERS_FILE)));

// ================= ORDERS: CREATE =================
app.post('/api/orders', (req, res) => {
  const { items, customer, delivery, payment, agreeToTerms } = req.body;
  const errs = [];
  if (!Array.isArray(items) || !items.length) errs.push('At least one item required');
  if (!customer?.name?.trim()) errs.push('Name required');
  if (!customer?.phone?.trim()) errs.push('Phone required');
  if (!ALLOWED_CITIES.includes(customer?.city)) errs.push('City must be Manila or Quezon City');
  if (customer?.city) {
    const ok = customer.city === 'Manila' ? MANILA_DISTRICTS : QC_DISTRICTS;
    if (!ok.includes(customer?.district)) errs.push(`District invalid for ${customer.city}`);
  }
  if (!DELIVERY_METHODS.includes(delivery?.method)) errs.push('Invalid delivery method');
  if (delivery?.method === 'Meetup' && !delivery?.meetupSpot?.trim()) errs.push('Meetup spot required');
  if ((delivery?.method === 'Lalamove' || delivery?.method === 'GrabExpress') && !customer?.address?.trim()) errs.push('Address required for rider');
  if (!PAYMENT_METHODS.includes(payment?.method)) errs.push('Invalid payment method');
  if (payment?.method !== 'Cash on Meetup' && !payment?.reference?.trim()) errs.push('Payment reference required');
  if (!agreeToTerms) errs.push('Must agree to terms');
  if (errs.length) return res.status(400).json({ error: errs.join('; ') });

  const inv = readJSON(ITEMS_FILE);
  const resolved = [];
  let subtotal = 0;
  for (const line of items) {
    const found = inv.find(i => i.id === line.id);
    if (!found) return res.status(400).json({ error: `Item ${line.id} not found` });
    if (found.status === 'Sold Out') return res.status(400).json({ error: `"${found.title}" is sold out` });
    const qty = Math.max(1, Number(line.qty) || 1);
    subtotal += found.price * qty;
    resolved.push({ id: found.id, title: found.title, price: found.price, qty, hub: found.hub, image: absUrl(found.image) });
  }
  const fee = delivery.method === 'Meetup' ? 0 : 80;
  const total = subtotal + fee;

  const orders = readJSON(ORDERS_FILE);
  const order = {
    id: 'SW627-' + Date.now().toString(36).toUpperCase(),
    items: resolved, customer,
    delivery: { ...delivery, fee }, payment,
    subtotal, total, status: 'Pending',
    createdAt: new Date().toISOString()
  };
  orders.unshift(order);
  writeJSON(ORDERS_FILE, orders);
  res.status(201).json(order);
});

// ---------- 404 ----------
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// ---------- Error handler ----------
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

// ---------- Boot ----------
app.listen(PORT, () => {
  console.log(`\n  🟢 SW627 API v2.1 → http://localhost:${PORT}`);
  console.log(`  🔑 Admin passcode: ${ADMIN_PASSCODE}`);
  console.log(`  🌐 Public base:    ${PUBLIC_BASE_URL}`);
  console.log(`  📁 Uploads:        ${UPLOAD_DIR}`);
  console.log(`  🌍 CORS origins:   ${ALLOWED_ORIGINS.join(', ')}\n`);
});
