const express = require('express');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || '';

let db;

async function connectDB() {
  if (db) return db;
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  db = client.db('shipment_tracker');
  return db;
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function now() {
  return new Date().toISOString();
}

// ---- GET all shipments ----
app.get('/api/shipments', async (req, res) => {
  try {
    const database = await connectDB();
    const { search, status } = req.query;
    const query = {};

    if (search) {
      const s = new RegExp(search, 'i');
      query.$or = [
        { tracking_number: s }, { sender_name: s },
        { receiver_name: s }, { origin: s }, { destination: s }
      ];
    }
    if (status && status !== 'All') query.status = status;

    const shipments = await database.collection('shipments')
      .find(query).sort({ created_at: -1 }).toArray();

    res.json(shipments.map(s => ({ ...s, id: s._id.toString() })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- GET single shipment + events ----
app.get('/api/shipments/:id', async (req, res) => {
  try {
    const database = await connectDB();
    const shipment = await database.collection('shipments').findOne({ _id: new ObjectId(req.params.id) });
    if (!shipment) return res.status(404).json({ error: 'Shipment not found' });

    const events = await database.collection('events')
      .find({ shipment_id: req.params.id }).sort({ event_time: -1 }).toArray();

    res.json({ ...shipment, id: shipment._id.toString(), events });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- POST create shipment ----
app.post('/api/shipments', async (req, res) => {
  try {
    const { tracking_number, sender_name, receiver_name, origin, destination, weight, category } = req.body;
    if (!tracking_number || !sender_name || !receiver_name || !origin || !destination) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const database = await connectDB();
    const existing = await database.collection('shipments').findOne({ tracking_number });
    if (existing) return res.status(409).json({ error: 'Tracking number already exists' });

    const shipment = {
      tracking_number, sender_name, receiver_name, origin, destination,
      weight: weight ? parseFloat(weight) : null,
      category: category || 'General',
      status: 'Pending',
      created_at: now(),
      updated_at: now()
    };

    const result = await database.collection('shipments').insertOne(shipment);
    const id = result.insertedId.toString();

    await database.collection('events').insertOne({
      shipment_id: id, status: 'Pending',
      location: origin, notes: 'Shipment created', event_time: now()
    });

    res.status(201).json({ ...shipment, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- PATCH update status ----
app.patch('/api/shipments/:id/status', async (req, res) => {
  try {
    const validStatuses = ['Pending', 'Picked Up', 'In Transit', 'Out for Delivery', 'Delivered', 'Failed', 'Returned'];
    const { status, location, notes } = req.body;
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    const database = await connectDB();
    const result = await database.collection('shipments').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { status, updated_at: now() } }
    );
    if (result.matchedCount === 0) return res.status(404).json({ error: 'Shipment not found' });

    await database.collection('events').insertOne({
      shipment_id: req.params.id, status,
      location: location || '', notes: notes || '', event_time: now()
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- DELETE shipment ----
app.delete('/api/shipments/:id', async (req, res) => {
  try {
    const database = await connectDB();
    const result = await database.collection('shipments').deleteOne({ _id: new ObjectId(req.params.id) });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Shipment not found' });

    await database.collection('events').deleteMany({ shipment_id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- GET stats ----
app.get('/api/stats', async (req, res) => {
  try {
    const database = await connectDB();
    const shipments = await database.collection('shipments').find({}).toArray();

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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Shipment Tracker running at http://localhost:${PORT}`));
}

module.exports = app;
