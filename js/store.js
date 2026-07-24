// Firebase init + all data access (auth, users, rooms, films, takes, diary, admin).
import { firebaseConfig, ADMIN_EMAIL } from './config.js';
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

export async function getAppConfig() {
  const snap = await getDoc(doc(db, 'config', 'app'));
  return snap.exists() ? snap.data() : { hideRevokedTakes: false };
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
export function saveTake(roomId, filmId, user, rating, review) {
  return setDoc(doc(db, 'rooms', roomId, 'films', filmId, 'takes', user.uid), {
    rating, review: review || '',
    name: user.displayName || user.email,
    updatedAt: serverTimestamp(),
  }, { merge: true });
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
