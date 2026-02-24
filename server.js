const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.DB_PATH
  ? path.join(process.env.DB_PATH, 'db.json')
  : path.join(__dirname, 'db.json');

// ---- Simple JSON "database" ----
function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    const empty = { shipments: [], events: [], nextShipmentId: 1, nextEventId: 1 };
    fs.writeFileSync(DB_FILE, JSON.stringify(empty, null, 2));
    return empty;
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function now() {
  return new Date().toISOString();
}

// ---- Middleware ----
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- GET all shipments ----
app.get('/api/shipments', (req, res) => {
  const db = loadDB();
  const { search, status } = req.query;
  let shipments = db.shipments;

  if (search) {
    const s = search.toLowerCase();
    shipments = shipments.filter(sh =>
      sh.tracking_number.toLowerCase().includes(s) ||
      sh.sender_name.toLowerCase().includes(s) ||
      sh.receiver_name.toLowerCase().includes(s) ||
      sh.origin.toLowerCase().includes(s) ||
      sh.destination.toLowerCase().includes(s)
    );
  }
  if (status && status !== 'All') {
    shipments = shipments.filter(sh => sh.status === status);
  }

  shipments = [...shipments].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(shipments);
});

// ---- GET single shipment + events ----
app.get('/api/shipments/:id', (req, res) => {
  const db = loadDB();
  const id = parseInt(req.params.id);
  const shipment = db.shipments.find(s => s.id === id);
  if (!shipment) return res.status(404).json({ error: 'Shipment not found' });

  const events = db.events
    .filter(e => e.shipment_id === id)
    .sort((a, b) => new Date(b.event_time) - new Date(a.event_time));

  res.json({ ...shipment, events });
});

// ---- POST create shipment ----
app.post('/api/shipments', (req, res) => {
  const { tracking_number, sender_name, receiver_name, origin, destination, weight, category } = req.body;

  if (!tracking_number || !sender_name || !receiver_name || !origin || !destination) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const db = loadDB();

  if (db.shipments.find(s => s.tracking_number === tracking_number)) {
    return res.status(409).json({ error: 'Tracking number already exists' });
  }

  const shipment = {
    id: db.nextShipmentId++,
    tracking_number,
    sender_name,
    receiver_name,
    origin,
    destination,
    weight: weight ? parseFloat(weight) : null,
    category: category || 'General',
    status: 'Pending',
    created_at: now(),
    updated_at: now()
  };

  db.shipments.push(shipment);

  // Initial event
  db.events.push({
    id: db.nextEventId++,
    shipment_id: shipment.id,
    status: 'Pending',
    location: origin,
    notes: 'Shipment created',
    event_time: now()
  });

  saveDB(db);
  res.status(201).json(shipment);
});

// ---- PATCH update status ----
app.patch('/api/shipments/:id/status', (req, res) => {
  const validStatuses = ['Pending', 'Picked Up', 'In Transit', 'Out for Delivery', 'Delivered', 'Failed', 'Returned'];
  const { status, location, notes } = req.body;

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const db = loadDB();
  const id = parseInt(req.params.id);
  const shipment = db.shipments.find(s => s.id === id);
  if (!shipment) return res.status(404).json({ error: 'Shipment not found' });

  shipment.status = status;
  shipment.updated_at = now();

  db.events.push({
    id: db.nextEventId++,
    shipment_id: id,
    status,
    location: location || '',
    notes: notes || '',
    event_time: now()
  });

  saveDB(db);
  res.json({ success: true });
});

// ---- DELETE shipment ----
app.delete('/api/shipments/:id', (req, res) => {
  const db = loadDB();
  const id = parseInt(req.params.id);
  const idx = db.shipments.findIndex(s => s.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Shipment not found' });

  db.shipments.splice(idx, 1);
  db.events = db.events.filter(e => e.shipment_id !== id);
  saveDB(db);
  res.json({ success: true });
});

// ---- GET stats ----
app.get('/api/stats', (req, res) => {
  const db = loadDB();
  const shipments = db.shipments;

  // Status counts
  const statusMap = {};
  shipments.forEach(s => {
    statusMap[s.status] = (statusMap[s.status] || 0) + 1;
  });
  const statusCounts = Object.entries(statusMap).map(([status, count]) => ({ status, count }));

  // Category counts
  const catMap = {};
  shipments.forEach(s => {
    catMap[s.category] = (catMap[s.category] || 0) + 1;
  });
  const categoryCounts = Object.entries(catMap).map(([category, count]) => ({ category, count }));

  // Daily shipments (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const dayMap = {};
  shipments
    .filter(s => new Date(s.created_at) >= thirtyDaysAgo)
    .forEach(s => {
      const date = s.created_at.slice(0, 10);
      dayMap[date] = (dayMap[date] || 0) + 1;
    });
  const dailyShipments = Object.entries(dayMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  const totals = {
    total: shipments.length,
    delivered: shipments.filter(s => s.status === 'Delivered').length,
    in_transit: shipments.filter(s => s.status === 'In Transit').length,
    pending: shipments.filter(s => s.status === 'Pending').length
  };

  res.json({ statusCounts, dailyShipments, categoryCounts, totals });
});

app.listen(PORT, () => {
  console.log(`Shipment Tracker running at http://localhost:${PORT}`);
});
