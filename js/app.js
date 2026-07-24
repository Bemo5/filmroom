// Filmroom SPA — router + views.
import { isConfigured } from './config.js';
import { starRow, starInput, ratingInline, ratingColor, ratingLabel, formatRating } from './stars.js';
import { IMG, searchFilms } from './tmdb.js';
import * as S from './store.js';

const app = document.getElementById('app');
let me = null;        // firebase auth user
let profile = null;   // users/{uid} doc
let cfg = { hideRevokedTakes: false };
let usersById = {};   // uid -> profile (for status lookup on takes)
let subs = [];        // active onSnapshot unsubscribers
let statusWatch = null; // live watcher on our own user doc (pending/revoked gates)
let roomTakes = {};   // filmId -> takes[] for the open room (for edit prefill)

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clearSubs = () => { subs.forEach((u) => u && u()); subs = []; };
const posterEl = (path, cls = 'poster') =>
  path ? `<img class="${cls}" src="${IMG(path)}" alt="" loading="lazy">` : `<div class="${cls} ph">🎞️</div>`;
const brand = () => `<div class="brand"><img class="brand-mark" src="assets/logo.svg" alt=""><span class="wm">Filmroom</span></div>`;

// Admin-set global themes (full cohesive palettes; see :root overrides in style.css).
const THEMES = [
  { id: 'gold',    name: 'Gold' },
  { id: 'crimson', name: 'Crimson' },
  { id: 'emerald', name: 'Emerald' },
  { id: 'ocean',   name: 'Midnight' },
];
const applyTheme = (theme) => { document.documentElement.dataset.theme = theme || 'gold'; };

// ---------------------------------------------------------------- boot
if (!isConfigured) {
  app.innerHTML = `<div class="auth-wrap"><div class="card auth-card">
    ${brand()}
    <div class="titlecard-rule"></div>
    <div class="notice info">Not configured yet. Open <b>js/config.js</b>, paste your Firebase config and TMDB token, then reload.</div>
    <p class="faint" style="font-size:13px">See <b>README.md</b> → Setup for the exact steps.</p>
  </div></div>`;
} else {
  S.watchAuth(async (user) => {
    me = user;
    clearSubs();
    if (!user) { profile = null; return renderAuth(); }
    // Just-signed-up users trigger this before their /users doc finishes
    // writing — retry briefly before assuming they're unregistered.
    profile = await S.getProfile(user.uid);
    for (let i = 0; !profile && i < 6; i++) {
      await new Promise((r) => setTimeout(r, 400));
      profile = await S.getProfile(user.uid);
    }
    if (!profile) { profile = { status: 'pending' }; }
    if (profile.status !== 'approved') {
      renderGate(profile.status === 'revoked' ? 'revoked' : 'pending');
      // Live-watch our own doc so approval (or restore) advances us automatically.
      if (statusWatch) statusWatch();
      const from = profile.status;
      statusWatch = S.watchProfile(user.uid, (p) => { if (!p || p.status !== from) location.reload(); });
      return;
    }
    cfg = await S.getAppConfig();
    applyTheme(cfg.theme);
    try {
      const users = await S.allUsers();
      usersById = Object.fromEntries(users.map((u) => [u.uid, u]));
    } catch { /* rules may restrict; take name snapshots still render */ }
    if (!location.hash) location.hash = '#/rooms';
    route();
  });
  window.addEventListener('hashchange', () => { if (profile && profile.status === 'approved') route(); });
}

// ---------------------------------------------------------------- auth views
let authMode = 'login';
function renderAuth() {
  app.innerHTML = `<div class="auth-wrap"><div class="card auth-card">
    ${brand()}
    <div class="titlecard-rule"></div>
    <div class="eyebrow auth-eyebrow">Members only · Est. 2026</div>
    <div class="auth-headline">${authMode === 'login' ? 'Take your seat' : 'Join the club'}</div>
    <p class="auth-sub">${authMode === 'login'
      ? 'Log in to your rooms and diary.'
      : 'Request an account — the admin lets you in.'}</p>
    <div id="msg"></div>
    ${authMode === 'signup' ? field('name', 'Name', 'text', 'What your friends call you') : ''}
    ${field('email', 'Email', 'email', 'you@email.com')}
    ${field('password', 'Password', 'password', '••••••••')}
    <button class="btn primary block" id="go">${authMode === 'login' ? 'Log in' : 'Request access'}</button>
    <div class="switch-link">
      ${authMode === 'login'
        ? `New here? <button id="swap">Request an account</button>`
        : `Already have one? <button id="swap">Log in</button>`}
    </div>
  </div></div>`;

  document.getElementById('swap').onclick = () => { authMode = authMode === 'login' ? 'signup' : 'login'; renderAuth(); };
  document.getElementById('go').onclick = doAuth;
  app.querySelectorAll('input').forEach((i) =>
    i.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAuth(); }));
}
function field(id, label, type, ph) {
  return `<div class="field"><label for="${id}">${label}</label>
    <input class="input" id="${id}" type="${type}" placeholder="${ph}" autocomplete="off"></div>`;
}
async function doAuth() {
  const msg = document.getElementById('msg');
  const email = val('email'), password = val('password');
  const btn = document.getElementById('go');
  btn.disabled = true; msg.innerHTML = '';
  try {
    if (authMode === 'signup') {
      const name = val('name');
      if (!name) throw new Error('Please enter your name.');
      await S.signUp(name, email, password);
      // onAuthStateChanged will take over (→ pending gate, or app for admin).
    } else {
      await S.login(email, password);
    }
  } catch (e) {
    btn.disabled = false;
    msg.innerHTML = `<div class="notice err">${esc(prettyError(e))}</div>`;
  }
}
const val = (id) => document.getElementById(id).value.trim();
function prettyError(e) {
  const m = (e.code || e.message || '').toString();
  if (m.includes('email-already-in-use')) return 'That email already has an account — try logging in.';
  if (m.includes('invalid-credential') || m.includes('wrong-password') || m.includes('user-not-found')) return 'Wrong email or password.';
  if (m.includes('weak-password')) return 'Password should be at least 6 characters.';
  if (m.includes('invalid-email')) return 'That email doesn\'t look right.';
  return e.message || 'Something went wrong.';
}

function renderGate(kind) {
  const body = kind === 'pending'
    ? { t: 'Waiting for approval', s: 'Your request is in. The admin will approve you soon — check back shortly.' }
    : { t: 'Access removed', s: 'Your access to Filmroom has been revoked. Reach out to the admin if you think this is a mistake.' };
  app.innerHTML = `<div class="auth-wrap"><div class="card auth-card">
    ${brand()}
    <div class="titlecard-rule"></div>
    <div style="font-size:40px;margin:8px 0 10px">${kind === 'pending' ? '⏳' : '🚫'}</div>
    <h2>${body.t}</h2><p class="auth-sub mt">${body.s}</p>
    <button class="btn ghost block mt" id="out">Log out</button>
  </div></div>`;
  document.getElementById('out').onclick = () => S.logout();
}

// ---------------------------------------------------------------- shell + router
function shell(inner) {
  const isAdmin = profile.role === 'admin';
  const h = location.hash;
  const tab = (href, ico, label) =>
    `<button class="tab ${h.startsWith(href) ? 'active' : ''}" onclick="location.hash='${href}'">
      <span class="ico">${ico}</span>${label}</button>`;
  app.innerHTML = `
    <div class="topbar">
      ${brand()}
      <div class="spacer"></div>
      ${isAdmin ? '<span class="badge admin">admin</span>' : ''}
      <button class="btn ghost sm" id="logout">Log out</button>
    </div>
    <div class="container">${inner}</div>
    <div class="tabbar">
      ${tab('#/rooms', '🎬', 'Rooms')}
      ${tab('#/diary', '🎞️', 'My Films')}
      ${isAdmin ? tab('#/admin', '🛠️', 'Admin') : ''}
    </div>`;
  document.getElementById('logout').onclick = () => S.logout();
}

function route() {
  clearSubs();
  const h = location.hash;
  if (h.startsWith('#/room/')) return viewRoom(h.split('/')[2]);
  if (h.startsWith('#/diary')) return viewDiary();
  if (h.startsWith('#/admin')) return profile.role === 'admin' ? viewAdmin() : (location.hash = '#/rooms');
  return viewRooms();
}

// ---------------------------------------------------------------- rooms list
function viewRooms() {
  shell(`
    <div class="page-head row-between">
      <div><h1>Rooms</h1><p class="subtitle">Rate films together, privately.</p></div>
      <button class="btn primary sm" id="new">New room</button>
    </div>
    <div id="rooms" class="list"><div class="empty"><span class="spinner"></span></div></div>`);
  document.getElementById('new').onclick = newRoomSheet;
  const watchRooms = profile.role === 'admin'
    ? (cb) => S.watchAllRooms(cb, () => subs.push(S.watchMyRooms(me.uid, cb))) // fallback if rules unpublished
    : (cb) => S.watchMyRooms(me.uid, cb);
  subs.push(watchRooms((rooms) => {
    const box = document.getElementById('rooms');
    if (!box) return;
    if (!rooms.length) {
      box.innerHTML = `<div class="empty"><div class="ico">🍿</div>No rooms yet.<br>Create one and add your friends.</div>`;
      return;
    }
    const sorted = rooms.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    box.innerHTML = sorted
      .map((r) => `<div class="card tap" data-room="${r.id}"><div class="room-row">
        <div class="avatar">${esc(r.emoji || '🎬')}</div>
        <div class="meta"><div class="name">${esc(r.name)}</div>
          <div class="sub">${r.members.length} member${r.members.length === 1 ? '' : 's'}</div></div>
        <div class="chev">›</div></div></div>`).join('');
    box.querySelectorAll('[data-room]').forEach((el) => {
      const r = sorted.find((x) => x.id === el.dataset.room);
      bindHold(el, () => location.hash = '#/room/' + r.id, () => roomActionsDialog(r));
    });
  }));
}

function newRoomSheet() {
  openSheet('New room', `
    ${field('rname', 'Room name', 'text', 'e.g. Sunday Horror Club')}
    <div class="field"><label>Emoji</label>
      <input class="input" id="remoji" maxlength="2" value="🎬" style="width:80px;text-align:center;font-size:22px"></div>
    <button class="btn primary block mt" id="create">Create room</button>`);
  document.getElementById('create').onclick = async () => {
    const name = val('rname'); if (!name) return;
    const id = await S.createRoom(name, val('remoji') || '🎬', me);
    closeSheet(); location.hash = '#/room/' + id;
  };
}

// ---------------------------------------------------------------- room detail
async function viewRoom(roomId) {
  roomTakes = {};
  const room = await S.getRoom(roomId);
  if (!room) { location.hash = '#/rooms'; return; }
  const isOwner = room.createdBy === me.uid;
  const isAdmin = profile.role === 'admin';
  const memberLabel = `${room.members.length} member${room.members.length === 1 ? '' : 's'}`;
  shell(`
    <button class="btn ghost sm" onclick="location.hash='#/rooms'">‹ All rooms</button>
    <div class="detail-head">
      <h1><span class="room-emoji">${esc(room.emoji)}</span> ${esc(room.name)}</h1>
      <div class="row-between mt">
        <span class="subtitle" style="margin:0">${memberLabel}</span>
        ${isOwner || isAdmin ? '<button class="btn ghost sm" id="manage">Manage room</button>' : ''}
      </div>
    </div>
    <button class="btn primary block" id="add">＋ Add a film</button>
    <div id="films" class="list mt"><div class="empty"><span class="spinner"></span></div></div>`);
  document.getElementById('add').onclick = () => searchSheet((film) => S.addFilmToRoom(roomId, film, me));
  const mng = document.getElementById('manage');
  if (mng) mng.onclick = () => manageRoomSheet(room, isAdmin);

  subs.push(S.watchRoomFilms(roomId, (films) => {
    const box = document.getElementById('films');
    if (!box) return;
    if (!films.length) {
      box.innerHTML = `<div class="empty"><div class="ico">🎞️</div>No films yet.<br>Add one to start rating.</div>`;
      return;
    }
    box.innerHTML = films.map((f) => `
      <div class="card">
        <div class="film">
          ${posterEl(f.posterPath)}
          <div class="info">
            <div class="title">${esc(f.title)}</div>
            <div class="film-meta"><span class="year-pill">${esc(f.year || '—')}</span><span class="avg" id="avg-${f.id}"></span></div>
            <div class="mt"><button class="btn outline sm" id="rate-${f.id}" data-rate="${f.id}">★ Add your rating</button></div>
            <div class="takes" id="takes-${f.id}"><div class="faint" style="font-size:13px;margin-top:12px">Loading…</div></div>
          </div>
        </div>
      </div>`).join('');
    box.querySelectorAll('[data-rate]').forEach((b) => {
      const f = films.find((x) => x.id === b.dataset.rate);
      b.onclick = () => {
        const mine = (roomTakes[f.id] || []).find((t) => t.uid === me.uid);
        rateSheet({ ...f, rating: mine ? mine.rating : 0, review: mine ? mine.review : '' }, {
          onSave: async (rating, review) => { await S.saveTake(roomId, room.name, f, me, rating, review); },
        });
      };
    });
    films.forEach((f) => subs.push(S.watchFilmTakes(roomId, f.id, (takes) => renderTakes(f.id, takes))));
  }));
}

function renderTakes(filmId, takes) {
  roomTakes[filmId] = takes;
  const box = document.getElementById('takes-' + filmId);
  if (!box) return;
  // Reflect the current user's own rating on the button label.
  const rb = document.getElementById('rate-' + filmId);
  if (rb) {
    const mine = takes.find((t) => t.uid === me.uid);
    rb.textContent = mine ? `★ You: ${formatRating(mine.rating)} / 10 · edit` : '★ Add your rating';
  }
  // Average across all members (respecting the hide-revoked setting).
  const avgEl = document.getElementById('avg-' + filmId);
  if (avgEl) {
    const visible = takes.filter((t) => !(usersById[t.uid]?.status === 'revoked' && cfg.hideRevokedTakes));
    if (visible.length) {
      const a = visible.reduce((s, t) => s + t.rating, 0) / visible.length;
      avgEl.innerHTML = `<span style="color:${ratingColor(a)};font-weight:800">${a.toFixed(1)}</span> avg · ${visible.length} rating${visible.length === 1 ? '' : 's'}`;
    } else avgEl.textContent = 'No ratings yet';
  }
  if (!takes.length) { box.innerHTML = `<div class="faint" style="font-size:13px;margin-top:10px">No takes yet.</div>`; return; }
  box.innerHTML = takes
    .sort((a, b) => b.rating - a.rating)
    .map((t) => {
      const u = usersById[t.uid];
      const removed = u && u.status === 'revoked';
      if (removed && cfg.hideRevokedTakes) return '';
      // Prefer the live name so admin renames reflect on old takes too.
      const name = removed ? '[removed user]' : esc((u && u.name) || t.name || 'Someone');
      return `<div class="take">
        <div class="who">
          <span class="name ${removed ? 'removed' : ''}">${name}</span>
          <span class="rating-inline">${ratingInline(t.rating, 13)}</span>
        </div>
        ${t.review ? `<div class="body">${esc(t.review)}</div>` : ''}
      </div>`;
    }).join('') || `<div class="faint" style="font-size:13px;margin-top:10px">No visible takes.</div>`;
}

async function manageRoomSheet(room, isAdmin) {
  const users = await S.allUsers();
  usersById = Object.fromEntries(users.map((u) => [u.uid, u]));
  const approved = users.filter((u) => u.status === 'approved');
  const members = new Set(room.members);
  // If the admin limited who *I* can see, only offer those people to add.
  const limit = (!isAdmin && Array.isArray(profile.visibleTo) && profile.visibleTo.length) ? new Set(profile.visibleTo) : null;

  const body = openSheet(`Manage · ${room.name}`, '');
  const render = () => {
    const inRoom = approved.filter((u) => members.has(u.uid));
    const outside = approved.filter((u) => !members.has(u.uid) && (!limit || limit.has(u.uid)));
    body.innerHTML = `
      <div class="section-title">Members (${inRoom.length})</div>
      <div class="list">${inRoom.map((u) => {
        const owner = u.uid === room.createdBy;
        // Owners and admins can't be removed by anyone; admin can remove others.
        const canRemove = !owner && u.role !== 'admin' && (isAdmin || room.createdBy === me.uid);
        return `<div class="card row-between">
          <span class="u-name">${esc(u.name)}${owner ? ' <span class="faint" style="font-weight:500">· owner</span>' : ''}${u.role === 'admin' ? ' <span class="badge admin">admin</span>' : ''}</span>
          ${canRemove ? `<button class="btn ghost sm" data-rm="${u.uid}">Remove</button>` : ''}</div>`;
      }).join('')}</div>
      <div class="section-title">Add people</div>
      <div class="list">${outside.length
        ? outside.map((u) => `<div class="card row-between"><span class="u-name">${esc(u.name)}</span>
            <button class="btn sm" data-add="${u.uid}">Add</button></div>`).join('')
        : `<div class="faint" style="font-size:13px">${limit ? 'No one else is available to you.' : 'Everyone approved is already in.'}</div>`}</div>
      ${(isAdmin || room.createdBy === me.uid) ? `<button class="btn danger block mt" id="del">Delete room</button>` : ''}`;

    body.querySelectorAll('[data-add]').forEach((b) => b.onclick = async () => {
      b.disabled = true; await S.addMember(room.id, b.dataset.add); members.add(b.dataset.add); render();
    });
    body.querySelectorAll('[data-rm]').forEach((b) => b.onclick = async () => {
      b.disabled = true; await S.removeMember(room.id, b.dataset.rm); members.delete(b.dataset.rm); render();
    });
    const del = body.querySelector('#del');
    if (del) del.onclick = async () => {
      if (await confirmDialog({ title: 'Delete this room?', message: 'It disappears for everyone in it. Films and takes are gone for good.', confirmText: 'Delete room', danger: true })) {
        await S.deleteRoom(room.id); closeSheet(); location.hash = '#/rooms';
      }
    };
  };
  render();
}

// ---------------------------------------------------------------- diary
function viewDiary() {
  shell(`
    <div class="page-head row-between">
      <div><h1>My Films</h1><p class="subtitle" id="diaryStat">Every film you've rated.</p></div>
      <button class="btn primary sm" id="add">Add film</button>
    </div>
    <div id="diary"><div class="empty"><span class="spinner"></span></div></div>`);
  const openEntry = (e) => rateSheet(e, {
    onSave: (rating, review) => S.saveDiaryEntry(me.uid, e, rating, review),
    onDelete: async () => {
      if (await confirmDialog({ title: 'Remove this film?', message: 'Deletes your rating and take from My Films.', confirmText: 'Remove', danger: true })) {
        await S.deleteDiaryEntry(me.uid, e.tmdbId); return true;
      }
    },
  });
  document.getElementById('add').onclick = () => searchSheet((film) =>
    rateSheet(film, { onSave: (rating, review) => S.saveDiaryEntry(me.uid, film, rating, review) }));

  // Merge personal diary entries with reviews you left in rooms (each tagged).
  let diary = [], roomReviews = [];
  const render = () => {
    const box = document.getElementById('diary');
    if (!box) return;
    const items = [
      ...diary.map((e) => ({ ...e, kind: 'personal', ts: e.updatedAt?.seconds || 0 })),
      ...roomReviews.map((r) => ({ ...r, kind: 'room', ts: r.updatedAt?.seconds || 0 })),
    ].sort((a, b) => b.ts - a.ts);
    if (!items.length) {
      box.innerHTML = `<div class="empty"><div class="ico">🎞️</div><b>No films yet.</b><br>Add a film, or rate one in a room.</div>`;
      const stat = document.getElementById('diaryStat');
      if (stat) stat.textContent = 'Every film you’ve rated — here and in rooms.';
      return;
    }
    const shelf = items.map((i) => i.rating);
    const avg = shelf.reduce((s, r) => s + r, 0) / shelf.length;
    const stat = document.getElementById('diaryStat');
    if (stat) stat.innerHTML = `${items.length} rating${items.length === 1 ? '' : 's'} · <span style="color:${ratingColor(avg)};font-weight:700">${avg.toFixed(1)}</span> average`;
    box.innerHTML = `<div class="list">${items.map((i, idx) => {
      const tag = i.kind === 'room'
        ? `<span class="src-tag room">In ${esc(i.roomName || 'a room')}</span>`
        : `<span class="src-tag">My Films</span>`;
      return `<div class="card tap" data-idx="${idx}"><div class="film">
        ${posterEl(i.posterPath)}
        <div class="info">
          <div class="title">${esc(i.title)}</div>
          <div class="film-meta"><span class="year-pill">${esc(i.year || '—')}</span>${tag}</div>
          <div class="rating-inline mt">${ratingInline(i.rating, 15)}
            <span class="faint" style="font-size:12.5px">· ${ratingLabel(i.rating, shelf)}</span></div>
          ${i.review ? `<div class="body" style="margin-top:8px">${esc(i.review)}</div>` : ''}
        </div></div></div>`;
    }).join('')}</div>`;
    box.querySelectorAll('[data-idx]').forEach((el) => el.onclick = () => {
      const i = items[+el.dataset.idx];
      if (i.kind === 'room') location.hash = '#/room/' + i.roomId;
      else openEntry(i);
    });
  };
  subs.push(S.watchDiary(me.uid, (e) => { diary = e; render(); }));
  subs.push(S.watchRoomReviews(me.uid, (r) => { roomReviews = r; render(); }));
}

// ---------------------------------------------------------------- admin
function userBadge(u) {
  if (u.role === 'admin') return '<span class="badge admin">admin</span>';
  if (u.status === 'revoked') return '<span class="badge revoked">revoked</span>';
  if (u.status === 'pending') return '<span class="badge pending">pending</span>';
  return '';
}

async function viewAdmin() {
  shell(`
    <div class="page-head"><h1>Admin</h1><p class="subtitle">Approvals, access, and settings.</p></div>
    <div id="pending"></div>
    <div class="section-title">Everyone · tap to manage</div>
    <div id="all" class="list"></div>
    <div class="section-title">Settings</div>
    <div class="card row-between">
      <div><b>Hide revoked members' takes</b>
        <div class="faint" style="font-size:13px;margin-top:2px">Off = takes stay, shown as “[removed user]”.</div></div>
      <button class="btn sm" id="hide" style="min-width:64px">${cfg.hideRevokedTakes ? 'On' : 'Off'}</button>
    </div>
    <div class="section-title">Theme · applies to everyone</div>
    <div class="theme-grid" id="themes">
      ${THEMES.map((t) => `<button class="theme-swatch ${((cfg.theme || 'gold') === t.id) ? 'active' : ''}" data-theme="${t.id}" data-theme-preview="${t.id}">
        <span class="sw"></span><span class="tn">${t.name}</span></button>`).join('')}
    </div>`);
  document.getElementById('hide').onclick = async (e) => {
    cfg.hideRevokedTakes = !cfg.hideRevokedTakes;
    e.target.textContent = cfg.hideRevokedTakes ? 'On' : 'Off';
    await S.setAppConfig({ hideRevokedTakes: cfg.hideRevokedTakes });
  };
  document.getElementById('themes').querySelectorAll('[data-theme]').forEach((b) => b.onclick = async () => {
    cfg.theme = b.dataset.theme;
    applyTheme(cfg.theme);
    document.querySelectorAll('.theme-swatch').forEach((s) => s.classList.toggle('active', s.dataset.theme === cfg.theme));
    await S.setAppConfig({ theme: cfg.theme });
  });

  const users = await S.allUsers();
  usersById = Object.fromEntries(users.map((u) => [u.uid, u]));
  const pending = users.filter((u) => u.status === 'pending');
  const pend = document.getElementById('pending');
  if (pending.length) {
    pend.innerHTML = `<div class="section-title">Pending requests</div><div class="list">` +
      pending.map((u) => `<div class="card row-between">
        <div><div class="u-name">${esc(u.name)} <span class="badge pending">pending</span></div>
          <div class="u-email">${esc(u.email)}</div></div>
        <div style="display:flex;gap:8px">
          <button class="btn primary sm" data-ok="${u.uid}">Approve</button>
          <button class="btn danger sm" data-no="${u.uid}">Deny</button></div></div>`).join('') + `</div>`;
  }
  document.getElementById('all').innerHTML = users.map((u) => `
    <div class="card tap row-between" data-user="${u.uid}">
      <div><div class="u-name">${esc(u.name)} ${userBadge(u)}${u.uid === me.uid ? '<span class="faint" style="font-weight:500">· you</span>' : ''}</div>
        <div class="u-email">${esc(u.email)}</div></div>
      <div class="chev">›</div></div>`).join('');

  const rerun = () => viewAdmin();
  pend?.querySelectorAll('[data-ok]').forEach((b) => b.onclick = async () => { await S.setUserStatus(b.dataset.ok, 'approved'); rerun(); });
  pend?.querySelectorAll('[data-no]').forEach((b) => b.onclick = async () => {
    if (await confirmDialog({ title: 'Deny this request?', message: 'They won’t be able to log in.', confirmText: 'Deny', danger: true })) {
      await S.setUserStatus(b.dataset.no, 'revoked'); rerun();
    }
  });
  app.querySelectorAll('[data-user]').forEach((c) => c.onclick = () => adminUserDialog(users.find((u) => u.uid === c.dataset.user), users));
}

// God-controls panel for one user.
function adminUserDialog(u, allUsers = []) {
  const self = u.uid === me.uid;
  const rows = [`<button class="btn block" data-act="rename">Rename member</button>`];
  if (u.status === 'pending') {
    rows.push(`<button class="btn primary block" data-act="approve">Approve request</button>`);
    rows.push(`<button class="btn danger block" data-act="deny">Deny request</button>`);
  } else if (!self) {
    rows.push(u.role === 'admin'
      ? `<button class="btn block" data-act="demote">Remove admin</button>`
      : `<button class="btn block" data-act="promote">Make admin</button>`);
    rows.push(`<button class="btn block" data-act="visibility">Limit who they can see</button>`);
    rows.push(u.status === 'revoked'
      ? `<button class="btn primary block" data-act="restore">Restore access</button>`
      : `<button class="btn danger block" data-act="revoke">Revoke access</button>`);
    rows.push(`<button class="btn danger block" data-act="delete">Delete user</button>`);
  }
  const ov = modal(`
    <div class="u-name" style="font-size:19px">${esc(u.name)} ${userBadge(u)}</div>
    <div class="dialog-sub">${esc(u.email)}${self ? ' · this is you' : ''}</div>
    <div class="dialog-list">${rows.join('')}</div>
    <button class="btn ghost block mt" data-x>Close</button>`);
  const close = () => ov.remove();
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.querySelector('[data-x]').onclick = close;
  ov.querySelectorAll('[data-act]').forEach((b) => b.onclick = async () => {
    const act = b.dataset.act;
    if (act === 'rename') {
      const name = await promptDialog({ title: 'Rename member', label: 'Display name', value: u.name, confirmText: 'Save name' });
      if (name && name !== u.name) await S.renameUser(u.uid, name);
    } else if (act === 'approve' || act === 'restore') {
      await S.setUserStatus(u.uid, 'approved');
    } else if (act === 'deny' || act === 'revoke') {
      if (!(await confirmDialog({ title: act === 'deny' ? 'Deny this request?' : `Revoke ${u.name}?`,
        message: act === 'deny' ? 'They won’t be able to log in.' : 'They lose access immediately. Their past takes stay, marked “[removed user]”.',
        confirmText: act === 'deny' ? 'Deny' : 'Revoke', danger: true }))) return;
      await S.setUserStatus(u.uid, 'revoked');
    } else if (act === 'promote') {
      if (!(await confirmDialog({ title: `Make ${u.name} an admin?`, message: 'They’ll get full god-controls, including over other members.', confirmText: 'Make admin' }))) return;
      await S.setUserRole(u.uid, 'admin');
    } else if (act === 'demote') {
      await S.setUserRole(u.uid, 'member');
    } else if (act === 'visibility') {
      await visibilityDialog(u, allUsers);
    } else if (act === 'delete') {
      if (!(await confirmDialog({ title: `Delete ${u.name}?`, message: 'Removes their account and access completely. This can’t be undone.', confirmText: 'Delete user', danger: true }))) return;
      await S.deleteUser(u.uid);
    }
    close(); viewAdmin();
  });
}

// Admin picks exactly who a member is allowed to see when adding people.
function visibilityDialog(u, users) {
  return new Promise((resolve) => {
    const others = users.filter((x) => x.uid !== u.uid && x.status === 'approved');
    const cur = new Set(Array.isArray(u.visibleTo) ? u.visibleTo : []);
    const ov = modal(`
      <h2>Who ${esc(u.name)} can see</h2>
      <div class="dialog-sub">Only checked people appear when they add members. Check none = everyone.</div>
      <div class="dialog-list" style="max-height:46vh;overflow:auto">
        ${others.length ? others.map((x) => `<label class="check-row"><input type="checkbox" data-uid="${x.uid}" ${cur.has(x.uid) ? 'checked' : ''}><span>${esc(x.name)}</span></label>`).join('') : '<div class="faint" style="font-size:13px">No one else yet.</div>'}
      </div>
      <div class="dialog-actions">
        <button class="btn ghost" data-x>Cancel</button>
        <button class="btn primary" data-ok>Save</button></div>`);
    const done = (v) => { ov.remove(); resolve(v); };
    ov.querySelector('[data-x]').onclick = () => done(false);
    ov.querySelector('[data-ok]').onclick = async () => {
      const sel = [...ov.querySelectorAll('input:checked')].map((i) => i.dataset.uid);
      await S.setUserVisibility(u.uid, sel);
      done(true);
    };
    ov.addEventListener('click', (e) => { if (e.target === ov) done(false); });
  });
}

// ---------------------------------------------------------------- sheets
function openSheet(title, inner) {
  closeSheet();
  const ov = document.createElement('div');
  ov.className = 'overlay'; ov.id = 'overlay';
  ov.innerHTML = `<div class="sheet"><div class="sheet-head"><h2>${esc(title)}</h2>
    <button class="x" id="closeX">×</button></div><div id="sheetBody">${inner}</div></div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', (e) => { if (e.target === ov) closeSheet(); });
  document.getElementById('closeX').onclick = closeSheet;
  return document.getElementById('sheetBody');
}
function closeSheet() { document.getElementById('overlay')?.remove(); }

// Clean in-app dialogs — replace native alert/confirm/prompt. They stack above sheets.
function modal(inner) {
  const ov = document.createElement('div');
  ov.className = 'overlay dialog-overlay';
  ov.innerHTML = `<div class="dialog">${inner}</div>`;
  document.body.appendChild(ov);
  return ov;
}
function confirmDialog({ title, message = '', confirmText = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    const ov = modal(`<h2>${esc(title)}</h2>${message ? `<p class="dialog-msg">${esc(message)}</p>` : ''}
      <div class="dialog-actions">
        <button class="btn ghost" data-x>Cancel</button>
        <button class="btn ${danger ? 'solid-danger' : 'primary'}" data-ok>${esc(confirmText)}</button>
      </div>`);
    const done = (v) => { ov.remove(); resolve(v); };
    ov.querySelector('[data-x]').onclick = () => done(false);
    ov.querySelector('[data-ok]').onclick = () => done(true);
    ov.addEventListener('click', (e) => { if (e.target === ov) done(false); });
  });
}
function promptDialog({ title, label, value = '', confirmText = 'Save' } = {}) {
  return new Promise((resolve) => {
    const ov = modal(`<h2>${esc(title)}</h2>
      <div class="field mt"><label>${esc(label)}</label>
        <input class="input" id="pmt" value="${esc(value)}"></div>
      <div class="dialog-actions">
        <button class="btn ghost" data-x>Cancel</button>
        <button class="btn primary" data-ok>${esc(confirmText)}</button></div>`);
    const input = ov.querySelector('#pmt');
    setTimeout(() => { input.focus(); input.select(); }, 40);
    const done = (v) => { ov.remove(); resolve(v); };
    ov.querySelector('[data-x]').onclick = () => done(null);
    ov.querySelector('[data-ok]').onclick = () => done(input.value.trim());
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(input.value.trim()); });
    ov.addEventListener('click', (e) => { if (e.target === ov) done(null); });
  });
}

// Tap vs long-press (or right-click) on the same element.
function bindHold(el, onTap, onHold) {
  let timer = null, sx = 0, sy = 0;
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  el.addEventListener('pointerdown', (e) => {
    sx = e.clientX; sy = e.clientY;
    timer = setTimeout(() => { timer = null; navigator.vibrate?.(12); onHold(); }, 480);
  });
  el.addEventListener('pointermove', (e) => {
    if (timer && (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10)) cancel();
  });
  el.addEventListener('pointerup', () => { if (timer) { cancel(); onTap(); } });
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); cancel(); navigator.vibrate?.(12); onHold(); });
}

function roomActionsDialog(r) {
  const canDelete = r.createdBy === me.uid || profile.role === 'admin';
  const ov = modal(`
    <div class="u-name" style="font-size:19px">${esc(r.emoji || '🎬')} ${esc(r.name)}</div>
    <div class="dialog-sub">${r.members.length} member${r.members.length === 1 ? '' : 's'}</div>
    <div class="dialog-list">
      <button class="btn block" data-act="open">Open room</button>
      ${canDelete ? `<button class="btn danger block" data-act="delete">Delete room</button>` : ''}
    </div>
    <button class="btn ghost block mt" data-x>Close</button>`);
  const close = () => ov.remove();
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.querySelector('[data-x]').onclick = close;
  ov.querySelector('[data-act="open"]').onclick = () => { close(); location.hash = '#/room/' + r.id; };
  const delBtn = ov.querySelector('[data-act="delete"]');
  if (delBtn) delBtn.onclick = async () => {
    close();
    if (await confirmDialog({ title: 'Delete this room?', message: `“${r.name}” disappears for everyone in it. Films and takes are gone for good.`, confirmText: 'Delete room', danger: true }))
      await S.deleteRoom(r.id);
  };
}

function searchSheet(onPick) {
  const body = openSheet('Add a film', `
    ${field('q', 'Search films', 'text', 'Type a title…')}
    <div id="results" class="list"></div>`);
  const input = document.getElementById('q'); input.focus();
  const results = document.getElementById('results');
  let t;
  input.addEventListener('input', () => {
    clearTimeout(t);
    const q = input.value.trim();
    if (!q) { results.innerHTML = ''; return; }
    results.innerHTML = `<div class="empty"><span class="spinner"></span></div>`;
    t = setTimeout(async () => {
      try {
        const films = await searchFilms(q);
        results.innerHTML = films.length
          ? films.map((f, i) => `<div class="result" data-i="${i}">
              ${posterEl(f.posterPath)}
              <div><div class="title">${esc(f.title)}</div><div class="year">${esc(f.year)}</div></div></div>`).join('')
          : `<div class="faint" style="font-size:13px">No matches.</div>`;
        results.querySelectorAll('[data-i]').forEach((r) => r.onclick = () => {
          closeSheet(); onPick(films[r.dataset.i]);
        });
      } catch (e) {
        results.innerHTML = `<div class="notice err">Search failed — check your TMDB token. (${esc(e.message)})</div>`;
      }
    }, 300);
  });
}

function rateSheet(film, { onSave, onDelete } = {}) {
  openSheet(film.title, `
    <div class="film mt">${posterEl(film.posterPath)}
      <div class="info"><div class="title">${esc(film.title)}</div><div class="year">${esc(film.year)}</div></div></div>
    <div class="section-title">Your rating</div>
    <div id="starHolder"></div>
    <div class="rating-label" id="rlabel"></div>
    <div class="field mt"><label>Your take (optional)</label>
      <textarea class="input" id="review" placeholder="What did you think?">${esc(film.review || '')}</textarea></div>
    <button class="btn primary block" id="save">Save</button>
    ${onDelete ? `<button class="btn ghost block mt" id="del">Remove film</button>` : ''}`);
  const holder = document.getElementById('starHolder');
  const label = document.getElementById('rlabel');
  let rating = film.rating || 0;
  const showLabel = (v) => { label.textContent = `${formatRating(v)} / 10 · ${ratingLabel(v)}`; };
  const si = starInput({ value: rating, onChange: (v) => { rating = v; showLabel(v); } });
  holder.appendChild(si); si.refresh();
  if (rating) showLabel(rating);
  document.getElementById('save').onclick = async () => {
    if (!rating) { label.textContent = 'Tap the stars to set a rating first.'; return; }
    const btn = document.getElementById('save'); btn.disabled = true; btn.textContent = 'Saving…';
    await onSave(rating, document.getElementById('review').value.trim());
    closeSheet();
  };
  const del = document.getElementById('del');
  if (del) del.onclick = async () => { if (await onDelete()) closeSheet(); };
}
