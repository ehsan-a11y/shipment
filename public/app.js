// ========== NAVIGATION ==========
const pages = document.querySelectorAll('.page');
const navLinks = document.querySelectorAll('.nav-link');

navLinks.forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    const target = link.dataset.page;
    navLinks.forEach(l => l.classList.remove('active'));
    link.classList.add('active');
    pages.forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + target).classList.add('active');
    if (target === 'dashboard') loadDashboard();
    if (target === 'shipments') loadShipments();
    if (target === 'track') loadTrackDropdown();
  });
});

// ========== UTILITIES ==========
function statusClass(status) {
  return 'status-' + status.replace(/ /g, '-');
}

function statusBadge(status) {
  return `<span class="status-badge ${statusClass(status)}">${status}</span>`;
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function showAlert(el, msg, type) {
  el.className = `alert alert-${type}`;
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

// ========== DASHBOARD ==========
let statusChart, categoryChart, dailyChart;

async function loadDashboard() {
  const res = await fetch('/api/stats');
  const data = await res.json();

  document.getElementById('stat-total').textContent = data.totals.total || 0;
  document.getElementById('stat-delivered').textContent = data.totals.delivered || 0;
  document.getElementById('stat-transit').textContent = data.totals.in_transit || 0;
  document.getElementById('stat-pending').textContent = data.totals.pending || 0;

  renderStatusChart(data.statusCounts);
  renderCategoryChart(data.categoryCounts);
  renderDailyChart(data.dailyShipments);
}

function renderStatusChart(data) {
  const ctx = document.getElementById('statusChart').getContext('2d');
  if (statusChart) statusChart.destroy();

  const colors = {
    'Pending': '#ffa726',
    'Picked Up': '#42a5f5',
    'In Transit': '#7e57c2',
    'Out for Delivery': '#ab47bc',
    'Delivered': '#66bb6a',
    'Failed': '#ef5350',
    'Returned': '#90a4ae'
  };

  const labels = data.map(d => d.status);
  const counts = data.map(d => d.count);
  const bgColors = labels.map(l => colors[l] || '#ccc');

  statusChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: counts, backgroundColor: bgColors, borderWidth: 2, borderColor: '#fff' }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'right', labels: { font: { size: 12 }, padding: 14 } }
      }
    }
  });
}

function renderCategoryChart(data) {
  const ctx = document.getElementById('categoryChart').getContext('2d');
  if (categoryChart) categoryChart.destroy();

  const palette = ['#4fc3f7','#81c784','#ffb74d','#f06292','#9575cd','#4db6ac','#ff8a65','#a1887f'];
  const labels = data.map(d => d.category);
  const counts = data.map(d => d.count);

  categoryChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Shipments',
        data: counts,
        backgroundColor: palette.slice(0, labels.length),
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: '#f0f2f5' } },
        x: { grid: { display: false } }
      }
    }
  });
}

function renderDailyChart(data) {
  const ctx = document.getElementById('dailyChart').getContext('2d');
  if (dailyChart) dailyChart.destroy();

  const labels = data.map(d => {
    const date = new Date(d.date);
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  });
  const counts = data.map(d => d.count);

  dailyChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Shipments',
        data: counts,
        borderColor: '#4fc3f7',
        backgroundColor: 'rgba(79,195,247,0.12)',
        fill: true,
        tension: 0.4,
        pointRadius: 4,
        pointBackgroundColor: '#4fc3f7'
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: '#f0f2f5' } },
        x: { grid: { display: false } }
      }
    }
  });
}

// ========== ADD SHIPMENT ==========
document.getElementById('add-form').addEventListener('submit', async e => {
  e.preventDefault();
  const errEl = document.getElementById('form-error');
  const okEl = document.getElementById('form-success');
  errEl.classList.add('hidden');
  okEl.classList.add('hidden');

  const payload = {
    tracking_number: document.getElementById('tracking_number').value.trim(),
    sender_name: document.getElementById('sender_name').value.trim(),
    receiver_name: document.getElementById('receiver_name').value.trim(),
    origin: document.getElementById('origin').value.trim(),
    destination: document.getElementById('destination').value.trim(),
    weight: document.getElementById('weight').value || null,
    category: document.getElementById('category').value
  };

  const res = await fetch('/api/shipments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (!res.ok) {
    showAlert(errEl, data.error || 'Failed to create shipment', 'error');
  } else {
    showAlert(okEl, `Shipment ${data.tracking_number} created successfully!`, 'success');
    e.target.reset();
  }
});

// ========== ALL SHIPMENTS TABLE ==========
async function loadShipments() {
  const search = document.getElementById('search-input').value.trim();
  const status = document.getElementById('filter-status').value;

  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (status !== 'All') params.set('status', status);

  const res = await fetch('/api/shipments?' + params.toString());
  const shipments = await res.json();

  const tbody = document.getElementById('shipments-tbody');
  if (!shipments.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">No shipments found.</td></tr>';
    return;
  }

  tbody.innerHTML = shipments.map(s => `
    <tr>
      <td><strong>${s.tracking_number}</strong></td>
      <td>${s.sender_name}</td>
      <td>${s.receiver_name}</td>
      <td>${s.origin}</td>
      <td>${s.destination}</td>
      <td>${s.category}</td>
      <td>${statusBadge(s.status)}</td>
      <td>${formatDate(s.created_at)}</td>
      <td>
        <button class="btn btn-sm btn-secondary" onclick="openModal(${s.id})">View</button>
        <button class="btn btn-sm btn-primary" onclick="window.open('https://parcelsapp.com/en/tracking/${s.tracking_number}','_blank')" style="margin-left:4px">Track</button>
      </td>
    </tr>
  `).join('');
}

document.getElementById('search-input').addEventListener('input', loadShipments);
document.getElementById('filter-status').addEventListener('change', loadShipments);
document.getElementById('refresh-btn').addEventListener('click', loadShipments);

// ========== MODAL ==========
async function openModal(id) {
  const res = await fetch(`/api/shipments/${id}`);
  const s = await res.json();

  document.getElementById('modal-body').innerHTML = `
    <div>
      <div class="modal-row"><span>Tracking #</span><span>${s.tracking_number}</span></div>
      <div class="modal-row"><span>Status</span><span>${statusBadge(s.status)}</span></div>
      <div class="modal-row"><span>Sender</span><span>${s.sender_name}</span></div>
      <div class="modal-row"><span>Receiver</span><span>${s.receiver_name}</span></div>
      <div class="modal-row"><span>Origin</span><span>${s.origin}</span></div>
      <div class="modal-row"><span>Destination</span><span>${s.destination}</span></div>
      <div class="modal-row"><span>Category</span><span>${s.category}</span></div>
      <div class="modal-row"><span>Weight</span><span>${s.weight ? s.weight + ' kg' : '-'}</span></div>
      <div class="modal-row"><span>Created</span><span>${formatDate(s.created_at)}</span></div>
      <div class="modal-row"><span>Updated</span><span>${formatDate(s.updated_at)}</span></div>
    </div>
  `;
  document.getElementById('modal').classList.remove('hidden');
}

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', closeModal);
function closeModal() {
  document.getElementById('modal').classList.add('hidden');
}

// ========== TRACK SHIPMENT ==========
let currentTrackId = null;

async function loadTrackDropdown(preselectId) {
  const res = await fetch('/api/shipments');
  const shipments = await res.json();
  const dropdown = document.getElementById('track-dropdown');
  const current = dropdown.value;

  dropdown.innerHTML = '<option value="">-- Select a Tracking Number --</option>' +
    shipments.map(s =>
      `<option value="${s.id}" data-tracking="${s.tracking_number}">
        ${s.tracking_number} &nbsp;|&nbsp; ${s.sender_name} → ${s.receiver_name} &nbsp;[${s.status}]
      </option>`
    ).join('');

  if (preselectId) {
    dropdown.value = preselectId;
  } else if (current) {
    dropdown.value = current;
  }
}

document.getElementById('track-dropdown').addEventListener('change', function () {
  const selectedId = this.value;
  if (!selectedId) return;
  const selectedOption = this.options[this.selectedIndex];
  const trackingNum = selectedOption.dataset.tracking;
  document.getElementById('track-input').value = trackingNum;
  trackShipment(selectedId);
});

function goTrack(id) {
  navLinks.forEach(l => l.classList.remove('active'));
  document.querySelector('[data-page="track"]').classList.add('active');
  pages.forEach(p => p.classList.remove('active'));
  document.getElementById('page-track').classList.add('active');
  loadTrackDropdown(id);
  document.getElementById('track-input').value = id;
  trackShipment(id);
}

document.getElementById('track-btn').addEventListener('click', () => {
  const val = document.getElementById('track-input').value.trim();
  if (val) trackShipment(val);
});

document.getElementById('track-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const val = document.getElementById('track-input').value.trim();
    if (val) trackShipment(val);
  }
});

async function trackShipment(query) {
  document.getElementById('track-result').classList.add('hidden');
  document.getElementById('track-not-found').classList.add('hidden');

  // Try by ID first, then search by tracking number
  let res = await fetch(`/api/shipments/${query}`);
  if (!res.ok) {
    // Try searching by tracking number
    const searchRes = await fetch(`/api/shipments?search=${encodeURIComponent(query)}`);
    const list = await searchRes.json();
    if (list.length === 0) {
      document.getElementById('track-not-found').classList.remove('hidden');
      return;
    }
    res = await fetch(`/api/shipments/${list[0].id}`);
  }

  const s = await res.json();
  currentTrackId = s.id;

  document.getElementById('track-number').textContent = s.tracking_number;
  document.getElementById('track-route').textContent = `${s.origin}  →  ${s.destination}`;
  const badge = document.getElementById('track-status-badge');
  badge.textContent = s.status;
  badge.className = `status-badge ${statusClass(s.status)}`;
  document.getElementById('td-sender').textContent = s.sender_name;
  document.getElementById('td-receiver').textContent = s.receiver_name;
  document.getElementById('td-category').textContent = s.category;
  document.getElementById('td-weight').textContent = s.weight ? s.weight + ' kg' : '-';

  // Pre-select current status
  document.getElementById('new-status').value = s.status;

  // Render timeline
  const timeline = document.getElementById('timeline');
  if (!s.events || s.events.length === 0) {
    timeline.innerHTML = '<p style="color:#999;font-size:0.9rem">No tracking events yet.</p>';
  } else {
    timeline.innerHTML = s.events.map(ev => {
      const dotClass = ev.status === 'Delivered' ? 'delivered' : ev.status === 'Failed' ? 'failed' : ev.status === 'Pending' ? 'pending' : '';
      return `
        <div class="timeline-item">
          <div class="timeline-dot ${dotClass}"></div>
          <div class="timeline-status">${ev.status}${ev.location ? ' &mdash; ' + ev.location : ''}</div>
          <div class="timeline-meta">
            ${ev.notes ? ev.notes + ' &bull; ' : ''}
            ${formatDate(ev.event_time)}
          </div>
        </div>
      `;
    }).join('');
  }

  document.getElementById('track-result').classList.remove('hidden');
  document.getElementById('update-error').classList.add('hidden');
  document.getElementById('update-success').classList.add('hidden');
}

document.getElementById('update-status-btn').addEventListener('click', async () => {
  if (!currentTrackId) return;
  const status = document.getElementById('new-status').value;
  const location = document.getElementById('new-location').value.trim();
  const notes = document.getElementById('new-notes').value.trim();

  const res = await fetch(`/api/shipments/${currentTrackId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, location, notes })
  });

  const data = await res.json();
  const errEl = document.getElementById('update-error');
  const okEl = document.getElementById('update-success');

  if (!res.ok) {
    showAlert(errEl, data.error || 'Update failed', 'error');
  } else {
    showAlert(okEl, 'Status updated successfully!', 'success');
    document.getElementById('new-location').value = '';
    document.getElementById('new-notes').value = '';
    trackShipment(currentTrackId);
  }
});

document.getElementById('delete-btn').addEventListener('click', async () => {
  if (!currentTrackId) return;
  if (!confirm('Are you sure you want to delete this shipment? This cannot be undone.')) return;

  const res = await fetch(`/api/shipments/${currentTrackId}`, { method: 'DELETE' });
  if (res.ok) {
    document.getElementById('track-result').classList.add('hidden');
    document.getElementById('track-input').value = '';
    document.getElementById('track-dropdown').value = '';
    currentTrackId = null;
    loadTrackDropdown();
    alert('Shipment deleted.');
  }
});

// ========== INIT ==========
loadDashboard();
