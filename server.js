const express = require('express');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GIST_ID = process.env.GIST_ID;
const GIST_FILENAME = 'initial-db.json';
const AFTERSHIP_KEY = process.env.AFTERSHIP_KEY || '';

// ---- GitHub Gist DB helpers ----
function gistRequest(method, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.github.com',
      path: `/gists/${GIST_ID}`,
      method,
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'shipment-tracker',
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    };
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => resolve(JSON.parse(raw)));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function loadDB() {
  const gist = await gistRequest('GET');
  const content = gist.files[GIST_FILENAME].content;
  return JSON.parse(content);
}

async function saveDB(db) {
  await gistRequest('PATCH', {
    files: { [GIST_FILENAME]: { content: JSON.stringify(db, null, 2) } }
  });
}

function now() { return new Date().toISOString(); }

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- GET all shipments ----
app.get('/api/shipments', async (req, res) => {
  try {
    const db = await loadDB();
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
    if (status && status !== 'All') shipments = shipments.filter(sh => sh.status === status);
    res.json([...shipments].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---- GET single shipment + events ----
app.get('/api/shipments/:id', async (req, res) => {
  try {
    const db = await loadDB();
    const id = parseInt(req.params.id);
    const shipment = db.shipments.find(s => s.id === id);
    if (!shipment) return res.status(404).json({ error: 'Shipment not found' });
    const events = db.events.filter(e => e.shipment_id === id)
      .sort((a, b) => new Date(b.event_time) - new Date(a.event_time));
    res.json({ ...shipment, events });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---- POST create shipment ----
app.post('/api/shipments', async (req, res) => {
  try {
    const { tracking_number, sender_name, receiver_name, origin, destination, weight, category } = req.body;
    if (!tracking_number || !sender_name || !receiver_name || !origin || !destination)
      return res.status(400).json({ error: 'Missing required fields' });

    const db = await loadDB();
    if (db.shipments.find(s => s.tracking_number === tracking_number))
      return res.status(409).json({ error: 'Tracking number already exists' });

    const shipment = {
      id: db.nextShipmentId++, tracking_number, sender_name, receiver_name,
      origin, destination, weight: weight ? parseFloat(weight) : null,
      category: category || 'General', status: 'In Transit',
      created_at: now(), updated_at: now()
    };
    db.shipments.push(shipment);
    db.events.push({ id: db.nextEventId++, shipment_id: shipment.id, status: 'In Transit', location: origin, notes: 'Shipment created', event_time: now() });
    await saveDB(db);
    res.status(201).json(shipment);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---- PATCH update status ----
app.patch('/api/shipments/:id/status', async (req, res) => {
  try {
    const validStatuses = ['Pending', 'Picked Up', 'In Transit', 'Out for Delivery', 'Delivered', 'Failed', 'Returned'];
    const { status, location, notes } = req.body;
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    const db = await loadDB();
    const id = parseInt(req.params.id);
    const shipment = db.shipments.find(s => s.id === id);
    if (!shipment) return res.status(404).json({ error: 'Shipment not found' });

    shipment.status = status;
    shipment.updated_at = now();
    db.events.push({ id: db.nextEventId++, shipment_id: id, status, location: location || '', notes: notes || '', event_time: now() });
    await saveDB(db);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---- DELETE shipment ----
app.delete('/api/shipments/:id', async (req, res) => {
  try {
    const db = await loadDB();
    const id = parseInt(req.params.id);
    const idx = db.shipments.findIndex(s => s.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Shipment not found' });
    db.shipments.splice(idx, 1);
    db.events = db.events.filter(e => e.shipment_id !== id);
    await saveDB(db);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---- GET stats ----
app.get('/api/stats', async (req, res) => {
  try {
    const db = await loadDB();
    const shipments = db.shipments;
    const statusMap = {}, catMap = {}, dayMap = {};
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    let delivered = 0, in_transit = 0, pending = 0;

    shipments.forEach(s => {
      statusMap[s.status] = (statusMap[s.status] || 0) + 1;
      catMap[s.category] = (catMap[s.category] || 0) + 1;
      if (new Date(s.created_at) >= thirtyDaysAgo) {
        const date = s.created_at.slice(0, 10);
        dayMap[date] = (dayMap[date] || 0) + 1;
      }
      if (s.status === 'Delivered') delivered++;
      if (s.status === 'In Transit') in_transit++;
      if (s.status === 'Pending') pending++;
    });

    res.json({
      statusCounts: Object.entries(statusMap).map(([status, count]) => ({ status, count })),
      categoryCounts: Object.entries(catMap).map(([category, count]) => ({ category, count })),
      dailyShipments: Object.entries(dayMap).sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count })),
      totals: { total: shipments.length, delivered, in_transit, pending }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---- GET external tracking from AfterShip ----
app.get('/api/external-track/:tracking_number', async (req, res) => {
  if (!AFTERSHIP_KEY) return res.json({ events: [], error: 'No tracking API key configured' });

  const trackingNumber = encodeURIComponent(req.params.tracking_number);

  const options = {
    hostname: 'api.aftership.com',
    path: `/v4/trackings?tracking_numbers=${trackingNumber}&fields=checkpoints,tag,expected_delivery`,
    method: 'GET',
    headers: {
      'aftership-api-key': AFTERSHIP_KEY,
      'Content-Type': 'application/json'
    }
  };

  try {
    const data = await new Promise((resolve, reject) => {
      const req2 = https.request(options, r => {
        let raw = '';
        r.on('data', chunk => raw += chunk);
        r.on('end', () => resolve(JSON.parse(raw)));
      });
      req2.on('error', reject);
      req2.end();
    });

    if (data.meta.code !== 200) return res.json({ events: [], error: data.meta.message });

    const trackings = data.data.trackings;
    if (!trackings || trackings.length === 0) return res.json({ events: [] });

    const tracking = trackings[0];
    const events = (tracking.checkpoints || []).map(cp => ({
      date: cp.checkpoint_time || cp.created_at,
      status: cp.message || cp.tag,
      location: [cp.city, cp.state, cp.country_name].filter(Boolean).join(', '),
      tag: cp.tag
    }));

    res.json({ events, current_status: tracking.tag, slug: tracking.slug });
  } catch (err) {
    res.status(500).json({ events: [], error: err.message });
  }
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Running at http://localhost:${PORT}`));
}

module.exports = app;
