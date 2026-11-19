/**
 * SW627 API Server
 * JSON-file-backed REST API — no static frontend served here.
 *
 * Endpoints:
 *   GET    /api/meta                → cities, districts, meetup spots, payment/delivery methods
 *   GET    /api/items               → list items (filters: hub, category, batch, search)
 *   GET    /api/items/:id           → single item
 *   POST   /api/admin/login         → verify admin passcode
 *   POST   /api/admin/items         → create item (admin)
 *   PATCH  /api/admin/items/:id     → update item (admin)
 *   DELETE /api/admin/items/:id     → delete item (admin)
 *   GET    /api/admin/orders        → list orders (admin)
 *   POST   /api/orders              → create order (public, with strict Manila/QC validation)
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Paths ----------
const DATA_DIR = path.join(__dirname, 'data');
const ITEMS_FILE = path.join(DATA_DIR, 'items.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');

// ---------- Config ----------
const ADMIN_PASSCODE = process.env.SW627_ADMIN_PASSCODE || 'SW627ADMIN';

// CORS: set ALLOWED_ORIGINS in env for production (e.g. "https://sw627.com,https://www.sw627.com")
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map(s => s.trim());

// ---------- Locations ----------
const ALLOWED_CITIES = ['Manila', 'Quezon City'];

const MANILA_DISTRICTS = [
  'Sampaloc', 'Ermita', 'Malate', 'Santa Cruz', 'Binondo',
  'Tondo', 'Quiapo', 'Intramuros', 'Paco', 'Pandacan', 'Taft'
];

const QC_DISTRICTS = [
  'Diliman', 'Cubao', 'Katipunan', 'Tomas Morato', 'Fairview',
  'Banawe', 'Novaliches', 'Project 8', 'Kamuning', 'Libis'
];

const MEETUP_SPOTS = {
  Manila: ['SM Manila', 'Robinsons Place Manila', 'UST / España', 'Luneta Park'],
  'Quezon City': ['SM North EDSA', 'TriNoma', 'Gateway Mall Cubao', 'UP Diliman']
};

const PAYMENT_METHODS = ['GCash', 'Maya', 'SeaBank / InstaPay QR', 'Cash on Meetup'];
const DELIVERY_METHODS = ['Lalamove', 'GrabExpress', 'Meetup'];
const BATCHES = ['LJR Batch', 'GX Batch', 'PK 4.0', '1:1 Top Tier'];
const CATEGORIES = ['Sneakers', 'Apparel', 'Accessories'];
const HUBS = ['Manila Hub', 'Quezon City Hub'];

// ---------- Middleware ----------
app.use(cors({
  origin: (origin, cb) => {
    if (ALLOWED_ORIGINS.includes('*') || !origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked: ${origin}`));
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Admin-Passcode'],
}));
app.use(express.json({ limit: '8mb' })); // base64 image uploads allowed

// ---------- Data file bootstrap ----------
function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(ITEMS_FILE)) fs.writeFileSync(ITEMS_FILE, '[]', 'utf8');
  if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, '[]', 'utf8');
}
ensureDataFiles();

// ---------- Helpers ----------
function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (err) { console.error(`Read error ${file}:`, err.message); return []; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}
function requireAdmin(req, res, next) {
  const passcode = req.headers['x-admin-passcode'] || req.body?.passcode;
  if (passcode !== ADMIN_PASSCODE) {
    return res.status(401).json({ error: 'Unauthorized. Invalid admin passcode.' });
  }
  next();
}

// ---------- Health ----------
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'sw627-api', time: new Date().toISOString() });
});

// ---------- Meta ----------
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

// ================= ITEMS (public read) =================
app.get('/api/items', (req, res) => {
  const items = readJSON(ITEMS_FILE);
  const { hub, category, batch, search, status } = req.query;
  let filtered = items;

  if (hub && hub !== 'all') {
    const hubLabel = hub === 'manila' ? 'Manila Hub' : 'Quezon City Hub';
    filtered = filtered.filter(i => i.hub === hubLabel);
  }
  if (category && category !== 'all') filtered = filtered.filter(i => i.category === category);
  if (batch && batch !== 'all')       filtered = filtered.filter(i => i.batch === batch);
  if (status && status !== 'all')     filtered = filtered.filter(i => i.status === status);
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(i =>
      i.title.toLowerCase().includes(q) || i.batch.toLowerCase().includes(q)
    );
  }
  res.json(filtered);
});

app.get('/api/items/:id', (req, res) => {
  const items = readJSON(ITEMS_FILE);
  const item = items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  res.json(item);
});

// ================= ADMIN AUTH =================
app.post('/api/admin/login', (req, res) => {
  const { passcode } = req.body;
  if (passcode === ADMIN_PASSCODE) return res.json({ success: true });
  res.status(401).json({ success: false, error: 'Invalid passcode' });
});

// ================= ADMIN: CREATE ITEM =================
app.post('/api/admin/items', requireAdmin, (req, res) => {
  const {
    title, price, batch, category, hub, sizes, image, notes,
    city, district
  } = req.body;

  const errors = [];
  if (!title?.trim()) errors.push('Title is required');
  if (!price || Number(price) <= 0) errors.push('Price must be a positive number');
  if (!BATCHES.includes(batch)) errors.push(`Batch must be one of: ${BATCHES.join(', ')}`);
  if (!CATEGORIES.includes(category)) errors.push(`Category must be one of: ${CATEGORIES.join(', ')}`);
  if (!HUBS.includes(hub)) errors.push(`Hub must be one of: ${HUBS.join(', ')}`);
  if (!Array.isArray(sizes) || sizes.length === 0) errors.push('At least one size is required');
  if (!image?.trim()) errors.push('Image is required');

  // Optional: validate origin city + district if provided
  if (city && !ALLOWED_CITIES.includes(city)) {
    errors.push('City must be Manila or Quezon City');
  }
  if (district && city) {
    const validDistricts = city === 'Manila' ? MANILA_DISTRICTS : QC_DISTRICTS;
    if (!validDistricts.includes(district)) {
      errors.push(`District "${district}" is not valid for ${city}`);
    }
  }

  if (errors.length) return res.status(400).json({ error: errors.join('; ') });

  const items = readJSON(ITEMS_FILE);
  const newItem = {
    id: crypto.randomUUID(),
    title: title.trim(),
    price: Number(price),
    batch,
    category,
    hub,
    sizes,
    image: image.trim(),
    notes: notes?.trim() || 'No QC notes provided.',
    status: 'In Stock',
    createdAt: new Date().toISOString()
  };
  items.unshift(newItem);
  writeJSON(ITEMS_FILE, items);
  res.status(201).json(newItem);
});

// ================= ADMIN: UPDATE ITEM =================
app.patch('/api/admin/items/:id', requireAdmin, (req, res) => {
  const items = readJSON(ITEMS_FILE);
  const idx = items.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Item not found' });

  const allowed = ['status', 'price', 'title', 'sizes', 'notes', 'image', 'batch', 'category', 'hub'];
  allowed.forEach(key => {
    if (req.body[key] !== undefined) items[idx][key] = req.body[key];
  });
  items[idx].updatedAt = new Date().toISOString();
  writeJSON(ITEMS_FILE, items);
  res.json(items[idx]);
});

// ================= ADMIN: DELETE ITEM =================
app.delete('/api/admin/items/:id', requireAdmin, (req, res) => {
  let items = readJSON(ITEMS_FILE);
  const before = items.length;
  items = items.filter(i => i.id !== req.params.id);
  if (items.length === before) return res.status(404).json({ error: 'Item not found' });
  writeJSON(ITEMS_FILE, items);
  res.json({ success: true });
});

// ================= ADMIN: LIST ORDERS =================
app.get('/api/admin/orders', requireAdmin, (req, res) => {
  res.json(readJSON(ORDERS_FILE));
});

// ================= ORDERS: CREATE (public) =================
app.post('/api/orders', (req, res) => {
  const {
    items,       // [{ id, qty }]
    customer,    // { name, phone, city, district, address }
    delivery,    // { method, meetupSpot, riderNote }
    payment,     // { method, reference }
    agreeToTerms
  } = req.body;

  const errors = [];

  if (!Array.isArray(items) || items.length === 0)
    errors.push('Order must contain at least one item');

  if (!customer?.name?.trim()) errors.push('Customer name is required');
  if (!customer?.phone?.trim()) errors.push('Phone number is required');

  // Strict Manila / QC validation
  if (!ALLOWED_CITIES.includes(customer?.city))
    errors.push('Delivery city must be Manila or Quezon City');

  if (customer?.city) {
    const validDistricts = customer.city === 'Manila' ? MANILA_DISTRICTS : QC_DISTRICTS;
    if (!validDistricts.includes(customer?.district))
      errors.push(`District "${customer?.district}" is not valid for ${customer.city}`);
  }

  // Delivery validation
  if (!DELIVERY_METHODS.includes(delivery?.method))
    errors.push(`Delivery method must be one of: ${DELIVERY_METHODS.join(', ')}`);

  if (delivery?.method === 'Meetup') {
    if (!delivery?.meetupSpot?.trim())
      errors.push('Meetup spot is required');
  } else if (delivery?.method === 'Lalamove' || delivery?.method === 'GrabExpress') {
    if (!customer?.address?.trim())
      errors.push('Complete address is required for rider delivery');
  }

  // Payment validation
  if (!PAYMENT_METHODS.includes(payment?.method))
    errors.push(`Payment method must be one of: ${PAYMENT_METHODS.join(', ')}`);
  if (payment?.method !== 'Cash on Meetup' && !payment?.reference?.trim())
    errors.push('Payment reference is required for online payments');

  if (!agreeToTerms) errors.push('You must agree to the Terms and Conditions');

  if (errors.length) return res.status(400).json({ error: errors.join('; ') });

  // Resolve items against inventory
  const inventory = readJSON(ITEMS_FILE);
  const resolved = [];
  let subtotal = 0;

  for (const line of items) {
    const found = inventory.find(i => i.id === line.id);
    if (!found) return res.status(400).json({ error: `Item ${line.id} not found` });
    if (found.status === 'Sold Out')
      return res.status(400).json({ error: `Item "${found.title}" is sold out` });

    const qty = Math.max(1, Number(line.qty) || 1);
    subtotal += found.price * qty;
    resolved.push({
      id: found.id,
      title: found.title,
      price: found.price,
      qty,
      hub: found.hub
    });
  }

  // Delivery fee
  const deliveryFee = delivery.method === 'Meetup' ? 0 : 80;
  const total = subtotal + deliveryFee;

  // Persist
  const orders = readJSON(ORDERS_FILE);
  const order = {
    id: 'SW627-' + Date.now().toString(36).toUpperCase(),
    items: resolved,
    customer,
    delivery: { ...delivery, fee: deliveryFee },
    payment,
    subtotal,
    total,
    status: 'Pending',
    createdAt: new Date().toISOString()
  };
  orders.unshift(order);
  writeJSON(ORDERS_FILE, orders);

  res.status(201).json(order);
});

// ---------- 404 fallback ----------
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// ---------- Error handler ----------
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ---------- Boot ----------
app.listen(PORT, () => {
  console.log(`\n  SW627 API running on http://localhost:${PORT}`);
  console.log(`  Admin passcode: ${ADMIN_PASSCODE}`);
  console.log(`  CORS origins: ${ALLOWED_ORIGINS.join(', ')}\n`);
});
