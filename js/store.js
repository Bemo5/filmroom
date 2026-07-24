// Firebase init + all data access (auth, users, rooms, films, takes, diary, admin).
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, updateProfile,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection,
  addDoc, getDocs, query, where, orderBy, onSnapshot, serverTimestamp,
  arrayUnion, arrayRemove,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const { firebaseConfig, ADMIN_EMAIL } = await import('./config.js' + new URL(import.meta.url).search);

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ---------- Auth ----------
export function watchAuth(cb) { return onAuthStateChanged(auth, cb); }
export function logout() { return signOut(auth); }

export async function signUp(name, email, password) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName: name });
  const isAdmin = email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  await setDoc(doc(db, 'users', cred.user.uid), {
    email, name,
    role: isAdmin ? 'admin' : 'member',
    status: isAdmin ? 'approved' : 'pending',
    createdAt: serverTimestamp(),
  });
  return cred.user;
}

export function login(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function getProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? { uid, ...snap.data() } : null;
}

// ---------- Users / admin ----------
export async function allUsers() {
  const snap = await getDocs(query(collection(db, 'users'), orderBy('createdAt', 'desc')));
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}
export function setUserStatus(uid, status) {
  return updateDoc(doc(db, 'users', uid), { status });
}
export function setUserRole(uid, role) {
  return updateDoc(doc(db, 'users', uid), { role });
}
export function renameUser(uid, name) {
  return updateDoc(doc(db, 'users', uid), { name });
}
export function deleteUser(uid) {
  return deleteDoc(doc(db, 'users', uid));
}
export function setUserVisibility(uid, visibleTo) {
  return updateDoc(doc(db, 'users', uid), { visibleTo });
}
// Live subscription to one user's own doc — used so a pending user auto-advances
// the instant an admin approves them (no manual refresh).
export function watchProfile(uid, cb) {
  return onSnapshot(doc(db, 'users', uid), (s) => cb(s.exists() ? { uid, ...s.data() } : null));
}

export async function getAppConfig() {
  const snap = await getDoc(doc(db, 'config', 'app'));
  return snap.exists() ? snap.data() : { hideRevokedTakes: false, theme: 'gold' };
}
export function setAppConfig(patch) {
  return setDoc(doc(db, 'config', 'app'), patch, { merge: true });
}

// ---------- Rooms ----------
export async function createRoom(name, emoji, user) {
  const ref = await addDoc(collection(db, 'rooms'), {
    name, emoji: emoji || '🎬',
    createdBy: user.uid, createdByName: user.displayName || user.email,
    members: [user.uid],
    createdAt: serverTimestamp(),
  });
  return ref.id;
}
export function watchMyRooms(uid, cb) {
  const q = query(collection(db, 'rooms'), where('members', 'array-contains', uid));
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))));
}
// Admin sees every room (they are effectively in all of them).
export function watchAllRooms(cb, onErr) {
  return onSnapshot(collection(db, 'rooms'), (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), onErr || (() => {}));
}
export async function getRoom(id) {
  const snap = await getDoc(doc(db, 'rooms', id));
  return snap.exists() ? { id, ...snap.data() } : null;
}
export function addMember(roomId, uid) {
  return updateDoc(doc(db, 'rooms', roomId), { members: arrayUnion(uid) });
}
export function removeMember(roomId, uid) {
  return updateDoc(doc(db, 'rooms', roomId), { members: arrayRemove(uid) });
}
export function deleteRoom(roomId) { return deleteDoc(doc(db, 'rooms', roomId)); }

// ---------- Films in a room ----------
export async function addFilmToRoom(roomId, film, user) {
  await setDoc(doc(db, 'rooms', roomId, 'films', String(film.tmdbId)), {
    tmdbId: film.tmdbId, title: film.title, year: film.year, posterPath: film.posterPath,
    addedBy: user.uid, addedByName: user.displayName || user.email,
    addedAt: serverTimestamp(),
  }, { merge: true });
}
export function watchRoomFilms(roomId, cb) {
  const q = query(collection(db, 'rooms', roomId, 'films'), orderBy('addedAt', 'desc'));
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))));
}
export function watchFilmTakes(roomId, filmId, cb) {
  const c = collection(db, 'rooms', roomId, 'films', filmId, 'takes');
  return onSnapshot(c, (s) => cb(s.docs.map((d) => ({ uid: d.id, ...d.data() }))));
}
export async function saveTake(roomId, roomName, film, user, rating, review) {
  const filmId = String(film.tmdbId);
  await setDoc(doc(db, 'rooms', roomId, 'films', filmId, 'takes', user.uid), {
    rating, review: review || '',
    name: user.displayName || user.email,
    updatedAt: serverTimestamp(),
  }, { merge: true });
  // Mirror into the user's own "room reviews" so My Films can show it, tagged by
  // room. Non-fatal: if the rules for this collection aren't published yet, the
  // take still saves and My Films just won't reflect it until they are.
  try {
    await setDoc(doc(db, 'users', user.uid, 'roomReviews', `${roomId}_${filmId}`), {
      roomId, roomName, tmdbId: film.tmdbId, title: film.title, year: film.year, posterPath: film.posterPath || null,
      rating, review: review || '', updatedAt: serverTimestamp(),
    }, { merge: true });
  } catch (e) { /* roomReviews rules not published yet */ }
}
export function watchRoomReviews(uid, cb) {
  const q = query(collection(db, 'users', uid, 'roomReviews'), orderBy('updatedAt', 'desc'));
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => {});
}

// ---------- Personal diary ----------
export function watchDiary(uid, cb) {
  const q = query(collection(db, 'users', uid, 'diary'), orderBy('updatedAt', 'desc'));
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))));
}
export async function diaryRatings(uid) {
  const s = await getDocs(collection(db, 'users', uid, 'diary'));
  return s.docs.map((d) => d.data().rating).filter((r) => typeof r === 'number');
}
export function saveDiaryEntry(uid, film, rating, review) {
  return setDoc(doc(db, 'users', uid, 'diary', String(film.tmdbId)), {
    tmdbId: film.tmdbId, title: film.title, year: film.year, posterPath: film.posterPath,
    rating, review: review || '', updatedAt: serverTimestamp(),
  }, { merge: true });
}
export function deleteDiaryEntry(uid, filmId) {
  return deleteDoc(doc(db, 'users', uid, 'diary', String(filmId)));
}

export { auth, db };
