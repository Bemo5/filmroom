// Filmroom SPA — router + views.
import { isConfigured } from './config.js';
import { starRow, starInput, ratingChip, ratingLabel, formatRating } from './stars.js';
import { IMG, searchFilms } from './tmdb.js';
import * as S from './store.js';

const app = document.getElementById('app');
let me = null;        // firebase auth user
let profile = null;   // users/{uid} doc
let cfg = { hideRevokedTakes: false };
let usersById = {};   // uid -> profile (for status lookup on takes)
let subs = [];        // active onSnapshot unsubscribers

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clearSubs = () => { subs.forEach((u) => u && u()); subs = []; };
const posterEl = (path, cls = 'poster') =>
  path ? `<img class="${cls}" src="${IMG(path)}" alt="" loading="lazy">` : `<div class="${cls} ph">🎞️</div>`;
const brand = () => `<div class="brand"><img class="brand-mark" src="assets/logo.svg" alt=""><span class="wm">Filmroom</span></div>`;

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
    if (profile.status === 'pending') return renderGate('pending');
    if (profile.status === 'revoked') return renderGate('revoked');
    cfg = await S.getAppConfig();
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
      ${tab('#/diary', '📖', 'Diary')}
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
  subs.push(S.watchMyRooms(me.uid, (rooms) => {
    const box = document.getElementById('rooms');
    if (!box) return;
    if (!rooms.length) {
      box.innerHTML = `<div class="empty"><div class="ico">🍿</div>No rooms yet.<br>Create one and add your friends.</div>`;
      return;
    }
    box.innerHTML = rooms
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
      .map((r) => `<div class="card tap" onclick="location.hash='#/room/${r.id}'"><div class="room-row">
        <div class="avatar">${esc(r.emoji || '🎬')}</div>
        <div class="meta"><div class="name">${esc(r.name)}</div>
          <div class="sub">${r.members.length} member${r.members.length === 1 ? '' : 's'}</div></div>
        <div class="chev">›</div></div></div>`).join('');
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
            <div class="year">${esc(f.year)}</div>
            <div class="mt"><button class="btn outline sm" data-rate="${f.id}">★ Your rating</button></div>
            <div class="takes" id="takes-${f.id}"><div class="faint" style="font-size:13px;margin-top:12px">Loading…</div></div>
          </div>
        </div>
      </div>`).join('');
    box.querySelectorAll('[data-rate]').forEach((b) => {
      const f = films.find((x) => x.id === b.dataset.rate);
      b.onclick = () => rateSheet(f, async (rating, review) => {
        await S.saveTake(roomId, f.id, me, rating, review);
      });
    });
    films.forEach((f) => subs.push(S.watchFilmTakes(roomId, f.id, (takes) => renderTakes(f.id, takes))));
  }));
}

function renderTakes(filmId, takes) {
  const box = document.getElementById('takes-' + filmId);
  if (!box) return;
  if (!takes.length) { box.innerHTML = `<div class="faint" style="font-size:13px;margin-top:10px">No takes yet.</div>`; return; }
  box.innerHTML = takes
    .sort((a, b) => b.rating - a.rating)
    .map((t) => {
      const u = usersById[t.uid];
      const removed = u && u.status === 'revoked';
      if (removed && cfg.hideRevokedTakes) return '';
      const name = removed ? '[removed user]' : esc(t.name || (u && u.name) || 'Someone');
      return `<div class="take">
        <div class="who">
          <span class="name ${removed ? 'removed' : ''}">${name}</span>
          ${ratingChip(t.rating)}
        </div>
        ${t.review ? `<div class="body">${esc(t.review)}</div>` : ''}
      </div>`;
    }).join('') || `<div class="faint" style="font-size:13px;margin-top:10px">No visible takes.</div>`;
}

async function manageRoomSheet(room, isAdmin) {
  const users = await S.allUsers();
  usersById = Object.fromEntries(users.map((u) => [u.uid, u]));
  const inRoom = new Set(room.members);
  const approved = users.filter((u) => u.status === 'approved');
  openSheet('Manage room', `
    <div class="section-title">Members</div>
    <div class="list" id="mem"></div>
    <div class="section-title">Add people</div>
    <div class="list" id="add"></div>
    ${isAdmin ? `<button class="btn danger block mt" id="del">Delete room</button>` : ''}`);
  const mem = document.getElementById('mem');
  mem.innerHTML = approved.filter((u) => inRoom.has(u.uid)).map((u) =>
    `<div class="card row-between"><span>${esc(u.name)}${u.uid === room.createdBy ? ' <span class="faint">· owner</span>' : ''}</span>
      ${u.uid !== room.createdBy ? `<button class="btn ghost sm" data-rm="${u.uid}">Remove</button>` : ''}</div>`).join('');
  const add = document.getElementById('add');
  const outside = approved.filter((u) => !inRoom.has(u.uid));
  add.innerHTML = outside.length
    ? outside.map((u) => `<div class="card row-between"><span>${esc(u.name)}</span>
        <button class="btn sm" data-add="${u.uid}">Add</button></div>`).join('')
    : `<div class="faint" style="font-size:13px">Everyone approved is already in.</div>`;
  add.querySelectorAll('[data-add]').forEach((b) => b.onclick = async () => { await S.addMember(room.id, b.dataset.add); closeSheet(); route(); });
  mem.querySelectorAll('[data-rm]').forEach((b) => b.onclick = async () => { await S.removeMember(room.id, b.dataset.rm); closeSheet(); route(); });
  const del = document.getElementById('del');
  if (del) del.onclick = async () => {
    if (await confirmDialog({ title: 'Delete this room?', message: 'It disappears for everyone in it. Films and takes are gone for good.', confirmText: 'Delete room', danger: true })) {
      await S.deleteRoom(room.id); closeSheet(); location.hash = '#/rooms';
    }
  };
}

// ---------------------------------------------------------------- diary
function viewDiary() {
  shell(`
    <div class="page-head row-between">
      <div><h1>Your diary</h1><p class="subtitle">Every film you've rated.</p></div>
      <button class="btn primary sm" id="add">Add film</button>
    </div>
    <div id="diary" class="list"><div class="empty"><span class="spinner"></span></div></div>`);
  document.getElementById('add').onclick = () => searchSheet((film) =>
    rateSheet(film, (rating, review) => S.saveDiaryEntry(me.uid, film, rating, review)));
  subs.push(S.watchDiary(me.uid, (entries) => {
    const box = document.getElementById('diary');
    if (!box) return;
    if (!entries.length) {
      box.innerHTML = `<div class="empty"><div class="ico">📖</div>Your diary is empty.<br>Add a film you've seen.</div>`;
      return;
    }
    const shelf = entries.map((e) => e.rating);
    box.innerHTML = entries.map((e) => `
      <div class="card"><div class="film">
        ${posterEl(e.posterPath)}
        <div class="info">
          <div class="row-between"><div><div class="title">${esc(e.title)}</div>
            <div class="year">${esc(e.year)}</div></div>${ratingChip(e.rating)}</div>
          <div style="margin-top:6px">${starRow(e.rating, 15)}</div>
          <div class="rating-label">${ratingLabel(e.rating, shelf)}</div>
          ${e.review ? `<div class="take body mt">${esc(e.review)}</div>` : ''}
          <div class="mt"><button class="btn ghost sm" data-edit="${e.id}">Edit</button>
            <button class="btn ghost sm" data-del="${e.id}">Delete</button></div>
        </div></div></div>`).join('');
    box.querySelectorAll('[data-edit]').forEach((b) => { const e = entries.find((x) => x.id === b.dataset.edit);
      b.onclick = () => rateSheet(e, (rating, review) => S.saveDiaryEntry(me.uid, e, rating, review)); });
    box.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
      if (await confirmDialog({ title: 'Remove from diary?', message: 'This deletes your rating and take for this film.', confirmText: 'Remove', danger: true }))
        S.deleteDiaryEntry(me.uid, b.dataset.del);
    });
  }));
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
    </div>`);
  document.getElementById('hide').onclick = async (e) => {
    cfg.hideRevokedTakes = !cfg.hideRevokedTakes;
    e.target.textContent = cfg.hideRevokedTakes ? 'On' : 'Off';
    await S.setAppConfig({ hideRevokedTakes: cfg.hideRevokedTakes });
  };

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
  app.querySelectorAll('[data-user]').forEach((c) => c.onclick = () => adminUserDialog(users.find((u) => u.uid === c.dataset.user)));
}

// God-controls panel for one user.
function adminUserDialog(u) {
  const self = u.uid === me.uid;
  const rows = [`<button class="btn block" data-act="rename">Rename member</button>`];
  if (u.status === 'pending') {
    rows.push(`<button class="btn primary block" data-act="approve">Approve request</button>`);
    rows.push(`<button class="btn danger block" data-act="deny">Deny request</button>`);
  } else if (!self) {
    rows.push(u.role === 'admin'
      ? `<button class="btn block" data-act="demote">Remove admin</button>`
      : `<button class="btn block" data-act="promote">Make admin</button>`);
    rows.push(u.status === 'revoked'
      ? `<button class="btn primary block" data-act="restore">Restore access</button>`
      : `<button class="btn danger block" data-act="revoke">Revoke access</button>`);
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
    }
    close(); viewAdmin();
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

function rateSheet(film, onSave) {
  openSheet(film.title, `
    <div class="film mt">${posterEl(film.posterPath)}
      <div class="info"><div class="title">${esc(film.title)}</div><div class="year">${esc(film.year)}</div></div></div>
    <div class="section-title">Your rating</div>
    <div id="starHolder"></div>
    <div class="rating-label" id="rlabel"></div>
    <div class="field mt"><label>Your take (optional)</label>
      <textarea class="input" id="review" placeholder="What did you think?">${esc(film.review || '')}</textarea></div>
    <button class="btn primary block" id="save">Save</button>`);
  const holder = document.getElementById('starHolder');
  const label = document.getElementById('rlabel');
  let rating = film.rating || 0;
  const si = starInput({ value: rating, onChange: (v) => { rating = v; label.textContent = `${formatRating(v)} / 10 · ${ratingLabel(v)}`; } });
  holder.appendChild(si); si.refresh();
  if (rating) label.textContent = `${formatRating(rating)} / 10 · ${ratingLabel(rating)}`;
  document.getElementById('save').onclick = async () => {
    if (!rating) { label.textContent = 'Tap the stars to set a rating first.'; return; }
    const btn = document.getElementById('save'); btn.disabled = true; btn.textContent = 'Saving…';
    await onSave(rating, document.getElementById('review').value.trim());
    closeSheet();
  };
}
