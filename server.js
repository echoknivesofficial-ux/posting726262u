/**
 * SW627 API Server
 * - Serves static frontend from /public
 * - JSON-file-backed CRUD for items
 * - Order creation with Manila/QC delivery + payment validation
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Paths ----------
const DATA_DIR = path.join(__dirname, 'data');
const ITEMS_FILE = path.join(DATA_DIR, 'items.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');

// ---------- Admin auth (demo passcode) ----------
const ADMIN_PASSCODE = process.env.SW627_ADMIN_PASSCODE || 'SW627ADMIN';

// ---------- Allowed locations (strict Manila + QC only) ----------
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

// ---------- Middleware ----------
app.use(express.json({ limit: '5mb' })); // allow base64 image uploads
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Ensure data files exist ----------
function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(ITEMS_FILE)) fs.writeFileSync(ITEMS_FILE, '[]', 'utf8');
  if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, '[]', 'utf8');
}
ensureDataFiles();

// ---------- Helpers ----------
function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`Error reading ${file}:`, err.message);
    return [];
  }
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

// ---------- Public: Reference Data ----------
app.get('/api/meta', (req, res) => {
  res.json({
    cities: ALLOWED_CITIES,
    districts: { Manila: MANILA_DISTRICTS, 'Quezon City': QC_DISTRICTS },
    meetupSpots: MEETUP_SPOTS,
    paymentMethods: PAYMENT_METHODS,
    deliveryMethods: DELIVERY_METHODS
  });
});

// ---------- Items: Public Read ----------
app.get('/api/items', (req, res) => {
  const items = readJSON(ITEMS_FILE);
  const { hub, category, batch, search } = req.query;
  let filtered = items;

  if (hub && hub !== 'all') {
    const hubLabel = hub === 'manila' ? 'Manila Hub' : 'Quezon City Hub';
    filtered = filtered.filter(i => i.hub === hubLabel);
  }
  if (category && category !== 'all') {
    filtered = filtered.filter(i => i.category === category);
  }
  if (batch && batch !== 'all') {
    filtered = filtered.filter(i => i.batch === batch);
  }
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(
      i => i.title.toLowerCase().includes(q) || i.batch.toLowerCase().includes(q)
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

// ---------- Admin: Create Item ----------
app.post('/api/admin/items', requireAdmin, (req, res) => {
  const {
    title, price, batch, category, hub, sizes, image, notes,
    city, district
  } = req.body;

  // Validation
  const errors = [];
  if (!title?.trim()) errors.push('Title is required');
  if (!price || Number(price) <= 0) errors.push('Price must be a positive number');
  if (!['LJR Batch', 'GX Batch', 'PK 4.0', '1:1 Top Tier'].includes(batch))
    errors.push('Invalid batch');
  if (!['Sneakers', 'Apparel', 'Accessories'].includes(category))
    errors.push('Invalid category');
  if (!['Manila Hub', 'Quezon City Hub'].includes(hub))
    errors.push('Invalid hub');
  if (!Array.isArray(sizes) || sizes.length === 0)
    errors.push('At least one size is required');
  if (!image?.trim()) errors.push('Image is required');

  // Strict Manila / QC validation for hub-adjacent city
  if (city && !ALLOWED_CITIES.includes(city))
    errors.push('City must be Manila or Quezon City');
  if (district) {
    const validDistricts = city === 'Manila' ? MANILA_DISTRICTS : QC_DISTRICTS;
    if (!validDistricts.includes(district))
      errors.push(`District "${district}" is not valid for ${city}`);
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

// ---------- Admin: Update Item Status ----------
app.patch('/api/admin/items/:id', requireAdmin, (req, res) => {
  const items = readJSON(ITEMS_FILE);
  const idx = items.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Item not found' });

  const allowed = ['status', 'price', 'title', 'sizes', 'notes'];
  allowed.forEach(key => {
    if (req.body[key] !== undefined) items[idx][key] = req.body[key];
  });
  writeJSON(ITEMS_FILE, items);
  res.json(items[idx]);
});

// ---------- Admin: Delete Item ----------
app.delete('/api/admin/items/:id', requireAdmin, (req, res) => {
  let items = readJSON(ITEMS_FILE);
  const before = items.length;
  items = items.filter(i => i.id !== req.params.id);
  if (items.length === before) return res.status(404).json({ error: 'Item not found' });
  writeJSON(ITEMS_FILE, items);
  res.json({ success: true });
});

// ---------- Admin: Verify passcode ----------
app.post('/api/admin/login', (req, res) => {
  const { passcode } = req.body;
  if (passcode === ADMIN_PASSCODE) {
    return res.json({ success: true, message: 'Authenticated' });
  }
  res.status(401).json({ success: false, error: 'Invalid passcode' });
});

// ---------- Orders: Create ----------
app.post('/api/orders', (req, res) => {
  const {
    items, // [{ id, qty }]
    customer, // { name, phone, city, district, address }
    delivery, // { method, meetupSpot, riderNote }
    payment, // { method, reference }
    agreeToTerms
  } = req.body;

  const errors = [];

  // Validate items
  if (!Array.isArray(items) || items.length === 0)
    errors.push('Order must contain at least one item');

  // Validate customer
  if (!customer?.name?.trim()) errors.push('Customer name is required');
  if (!customer?.phone?.trim()) errors.push('Phone number is required');
  if (!ALLOWED_CITIES.includes(customer?.city))
    errors.push('Delivery city must be Manila or Quezon City');

  if (customer?.city) {
    const validDistricts =
      customer.city === 'Manila' ? MANILA_DISTRICTS : QC_DISTRICTS;
    if (!validDistricts.includes(customer?.district))
      errors.push(`District "${customer?.district}" is not valid for ${customer.city}`);
  }

  // Validate delivery
  if (!DELIVERY_METHODS.includes(delivery?.method))
    errors.push('Invalid delivery method');
  if (delivery?.method === 'Meetup') {
    if (!delivery?.meetupSpot?.trim())
      errors.push('Meetup spot is required for meetup orders');
  } else if (delivery?.method === 'Lalamove' || delivery?.method === 'GrabExpress') {
    if (!customer?.address?.trim())
      errors.push('Complete address is required for rider delivery');
  }

  // Validate payment
  if (!PAYMENT_METHODS.includes(payment?.method))
    errors.push('Invalid payment method');
  if (payment?.method !== 'Cash on Meetup' && !payment?.reference?.trim()) {
    errors.push('Payment reference is required for online payments');
  }

  if (!agreeToTerms) errors.push('You must agree to the Terms and Conditions');

  if (errors.length) return res.status(400).json({ error: errors.join('; ') });

  // Resolve items against current inventory
  const inventory = readJSON(ITEMS_FILE);
  const resolved = [];
  let subtotal = 0;

  for (const line of items) {
    const found = inventory.find(i => i.id === line.id);
    if (!found) {
      return res.status(400).json({ error: `Item ${line.id} not found` });
    }
    if (found.status === 'Sold Out') {
      return res.status(400).json({ error: `Item "${found.title}" is sold out` });
    }
    const qty = Math.max(1, Number(line.qty) || 1);
    subtotal += found.price * qty;
    resolved.push({ id: found.id, title: found.title, price: found.price, qty });
  }

  // Delivery fee
  const deliveryFee =
    delivery.method === 'Meetup' ? 0 : 80; // flat Lalamove/GrabExpress est.
  const total = subtotal + deliveryFee;

  // Persist order
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

// ---------- Admin: List Orders ----------
app.get('/api/admin/orders', requireAdmin, (req, res) => {
  res.json(readJSON(ORDERS_FILE));
});

// ---------- SPA fallback ----------
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------- Boot ----------
app.listen(PORT, () => {
  console.log(`\n  SW627 server running on http://localhost:${PORT}`);
  console.log(`  Admin passcode: ${ADMIN_PASSCODE}\n`);
});
