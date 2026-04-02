// ===========================
//  FACETRACK — MAIN.JS
// ===========================

let recognizeInterval = null;
let registerInterval  = null;
let cameraActive = false;
let allRecords = [];

// ===========================
//  CLOCK
// ===========================
function updateClock() {
  const now = new Date();
  document.getElementById('sidebarTime').textContent =
    now.toLocaleTimeString('en-US', { hour12: false });
  document.getElementById('sidebarDate').textContent =
    now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
setInterval(updateClock, 1000);
updateClock();

// ===========================
//  PAGE NAVIGATION
// ===========================
function switchPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  document.getElementById('page-' + name).classList.add('active');
  document.querySelector(`[data-page="${name}"]`).classList.add('active');

  if (name === 'dashboard') { loadDashboard(); }
  if (name === 'records')   { loadRecords(); }
  if (name === 'users')     { loadUsers(); }
}

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => switchPage(btn.dataset.page));
});

// ===========================
//  TOAST
// ===========================
let toastTimer;
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 3000);
}

// ===========================
//  DASHBOARD
// ===========================
async function loadDashboard() {
  try {
    const stats = await fetch('/stats').then(r => r.json());
    document.getElementById('statUsers').textContent = stats.total_users;
    document.getElementById('statToday').textContent = stats.today;
    document.getElementById('statTotal').textContent = stats.total_records;
  } catch (e) {}

  try {
    const att = await fetch('/attendance').then(r => r.json());
    const rows = att.data.slice(-8).reverse();
    const tbody = document.getElementById('recentBody');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-row">No records yet</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td>${r.Name}</td>
        <td><span class="badge ${r.Sex === 'M' ? 'badge-m' : 'badge-f'}">${r.Sex}</span></td>
        <td><span class="badge badge-class">${r.Class}</span></td>
        <td>${r.Time}</td>
      </tr>
    `).join('');
  } catch (e) {}
}

// ===========================
//  CAMERA HELPERS
// ===========================
async function startCamera() {
  if (cameraActive) return true;
  try {
    await fetch('/start_camera');
    cameraActive = true;
    return true;
  } catch (e) {
    showToast('Could not start camera', 'error');
    return false;
  }
}

async function stopCamera() {
  cameraActive = false;
  await fetch('/stop_camera').catch(() => {});
}

function showFeed(feedId, placeholderId) {
  const feed = document.getElementById(feedId);
  const ph   = document.getElementById(placeholderId);
  feed.src = '/video_feed?' + Date.now();
  feed.style.display = 'block';
  if (ph) ph.style.display = 'none';
}

function hideFeed(feedId, placeholderId) {
  const feed = document.getElementById(feedId);
  const ph   = document.getElementById(placeholderId);
  feed.src = '';
  feed.style.display = 'none';
  if (ph) ph.style.display = 'flex';
}

// ===========================
//  RECOGNIZE
// ===========================
async function startRecognize() {
  const ok = await startCamera();
  if (!ok) return;

  await fetch('/start_recognize');
  showFeed('recognizeFeed', 'recognizePlaceholder');
  document.getElementById('scanOverlay').style.display = 'block';
  document.getElementById('btnStartRecognize').style.display = 'none';
  document.getElementById('btnStopRecognize').style.display  = 'flex';

  recognizeInterval = setInterval(pollRecognition, 1200);
}

async function stopRecognize() {
  clearInterval(recognizeInterval);
  recognizeInterval = null;
  await fetch('/stop_recognize');
  await stopCamera();

  hideFeed('recognizeFeed', 'recognizePlaceholder');
  document.getElementById('scanOverlay').style.display = 'none';
  document.getElementById('btnStartRecognize').style.display = 'flex';
  document.getElementById('btnStopRecognize').style.display  = 'none';
}

let lastResultTime = '';
async function pollRecognition() {
  try {
    const r = await fetch('/recognition_result').then(r => r.json());
    if (!r.name || r.time === lastResultTime) return;
    lastResultTime = r.time;

    renderResult(r);
    addLog(r);
  } catch (e) {}
}

function renderResult(r) {
  const card = document.getElementById('recognizeResult');
  if (r.name === 'Unknown') {
    card.innerHTML = `
      <div class="result-success">
        <div class="result-name" style="color: var(--danger)">Unknown Face</div>
        <div class="result-time">${r.time} · Confidence: ${r.confidence}</div>
        <div class="result-status unknown" style="margin-top:12px">⚠ Not Recognized</div>
      </div>`;
    return;
  }
  const statusClass = r.saved ? 'saved' : 'duplicate';
  const statusText  = r.saved ? '✓ Attendance Marked' : '⏺ Already Marked Today';
  card.innerHTML = `
    <div class="result-success">
      <div class="result-name">${r.name}</div>
      <div class="result-time">${r.time} · Confidence: ${r.confidence}</div>
      <div class="result-status ${statusClass}" style="margin-top:12px">${statusText}</div>
    </div>`;
}

function addLog(r) {
  const list = document.getElementById('logList');
  const empty = list.querySelector('.log-empty');
  if (empty) empty.remove();

  const cls = r.name === 'Unknown' ? 'fail' : r.saved ? 'ok' : 'warn';
  const msg = r.name === 'Unknown'
    ? 'Unknown face detected'
    : r.saved
      ? `${r.name} marked present`
      : `${r.name} already marked`;

  const item = document.createElement('div');
  item.className = `log-item ${cls}`;
  item.innerHTML = `<span>${msg}</span><span class="log-time">${r.time}</span>`;
  list.prepend(item);

  // Keep only 10 items
  while (list.children.length > 10) list.lastChild.remove();
}

// ===========================
//  REGISTER
// ===========================
async function startRegister() {
  const name  = document.getElementById('regName').value.trim();
  const sex   = document.getElementById('regSex').value;
  const cls   = document.getElementById('regClass').value;

  if (!name || !sex || !cls) {
    showToast('Please fill in all fields', 'error');
    return;
  }

  const ok = await startCamera();
  if (!ok) return;

  const res = await fetch('/start_register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, sex, class: cls }),
  }).then(r => r.json());

  if (res.status !== 'ok') {
    showToast(res.message, 'error');
    return;
  }

  showFeed('registerFeed', 'registerPlaceholder');
  document.getElementById('regProgressSection').style.display = 'block';
  document.getElementById('regSuccessBanner').style.display  = 'none';
  document.getElementById('btnStartRegister').disabled = true;

  registerInterval = setInterval(pollRegister, 500);
}

async function pollRegister() {
  try {
    const s = await fetch('/register_status').then(r => r.json());
    const pct = Math.round((s.count / s.max) * 100);

    document.getElementById('regProgressFill').style.width = pct + '%';
    document.getElementById('regProgressText').textContent = `${s.count} / ${s.max}`;

    if (s.done) {
      clearInterval(registerInterval);
      registerInterval = null;
      await stopCamera();

      hideFeed('registerFeed', 'registerPlaceholder');
      document.getElementById('regSuccessBanner').style.display = 'flex';
      document.getElementById('btnStartRegister').disabled = false;

      const name = document.getElementById('regName').value.trim();
      showToast(`${name} registered successfully!`, 'success');

      document.getElementById('regName').value  = '';
      document.getElementById('regSex').value   = '';
      document.getElementById('regClass').value = '';
    }
  } catch (e) {}
}

// ===========================
//  RECORDS
// ===========================
let activeClassFilter = 'All';

async function loadRecords() {
  try {
    const att = await fetch('/attendance').then(r => r.json());
    allRecords = att.data.reverse();
    applyFilters();
  } catch (e) {
    document.getElementById('recordsBody').innerHTML =
      '<tr><td colspan="5" class="empty-row">Failed to load records</td></tr>';
  }
}

function switchClassTab(btn) {
  document.querySelectorAll('.class-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  activeClassFilter = btn.dataset.class;
  document.getElementById('searchRecords').value = '';
  applyFilters();
}

function applyFilters() {
  const q = document.getElementById('searchRecords').value.toLowerCase();
  let data = allRecords;

  // Class filter
  if (activeClassFilter !== 'All') {
    data = data.filter(r => (r.Class || '').toUpperCase() === activeClassFilter);
  }

  // Search filter
  if (q) {
    data = data.filter(r =>
      (r.Name || '').toLowerCase().includes(q) ||
      (r.Sex  || '').toLowerCase().includes(q)
    );
  }

  renderRecords(data);
}

function filterRecords() { applyFilters(); }

function renderRecords(data) {
  const tbody = document.getElementById('recordsBody');

  // Update count badge
  const label = activeClassFilter === 'All' ? 'All classes' : `Class ${activeClassFilter}`;
  document.getElementById('tabCount').textContent = `${data.length} record${data.length !== 1 ? 's' : ''} · ${label}`;

  if (!data.length) {
    const msg = activeClassFilter === 'All' ? 'No records yet' : `No records for Class ${activeClassFilter}`;
    tbody.innerHTML = `<tr><td colspan="5" class="empty-row">${msg}</td></tr>`;
    return;
  }

  const classBadgeColor = { M1: 'badge-m1', M2: 'badge-class', M3: 'badge-m3' };
  const rowClass = { M1: 'row-m1', M2: 'row-m2', M3: 'row-m3' };

  tbody.innerHTML = data.map((r, i) => {
    const cls = (r.Class || '').toUpperCase();
    return `
    <tr class="${rowClass[cls] || ''}">
      <td style="color:var(--muted);font-size:12px">${i + 1}</td>
      <td><strong>${r.Name}</strong></td>
      <td><span class="badge ${r.Sex === 'M' ? 'badge-m' : 'badge-f'}">${r.Sex}</span></td>
      <td><span class="badge badge-class">${r.Class}</span></td>
      <td>${r.Time}</td>
    </tr>`;
  }).join('');
}

async function exportAttendance() {
  window.open('/export_attendance', '_blank');
  showToast('Downloading attendance.xlsx...', 'success');
}

// ===========================
//  USERS
// ===========================
async function loadUsers() {
  try {
    const u = await fetch('/users').then(r => r.json());
    const grid = document.getElementById('usersGrid');
    if (!u.data.length) {
      grid.innerHTML = '<div class="empty-row" style="color:var(--muted);padding:32px">No users registered yet</div>';
      return;
    }
    grid.innerHTML = u.data.map(usr => `
      <div class="user-card">
        <div class="user-avatar">${usr.Name.charAt(0).toUpperCase()}</div>
        <div class="user-name">${usr.Name}</div>
        <div class="user-meta">
          <span class="badge ${usr.Sex === 'M' ? 'badge-m' : 'badge-f'}">${usr.Sex}</span>
          &nbsp;
          <span class="badge badge-class">${usr.Class}</span>
        </div>
        <button class="btn-delete" onclick="deleteUser('${usr.Name}')">Remove</button>
      </div>
    `).join('');
  } catch (e) {
    document.getElementById('usersGrid').innerHTML =
      '<div class="empty-row" style="color:var(--muted)">Failed to load users</div>';
  }
}

async function deleteUser(name) {
  if (!confirm(`Remove "${name}" and their face data?`)) return;
  await fetch('/delete_user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  showToast(`${name} removed`, 'success');
  loadUsers();
}

// ===========================
//  INIT
// ===========================
loadDashboard();
