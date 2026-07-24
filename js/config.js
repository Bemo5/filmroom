// ============================================================================
//  FILL THESE IN — see README.md, section "Setup".  (Two blocks, ~5 min.)
// ============================================================================

// 1) Firebase — Project settings ▸ General ▸ Your apps ▸ </> ▸ config object.
//    These values are safe to be public; Firestore rules do the real protection.
export const firebaseConfig = {
  apiKey: "PASTE_ME",
  authDomain: "PASTE_ME.firebaseapp.com",
  projectId: "PASTE_ME",
  storageBucket: "PASTE_ME.appspot.com",
  messagingSenderId: "PASTE_ME",
  appId: "PASTE_ME",
};

// 2) TMDB — themoviedb.org ▸ Settings ▸ API ▸ "API Read Access Token" (eyJ...).
export const TMDB_TOKEN = "PASTE_ME";

// 3) The email that should be the super-admin (auto-approved, admin powers).
export const ADMIN_EMAIL = "youssef.imnm@gmail.com";

// Helper the app uses to detect an unconfigured install.
export const isConfigured =
  firebaseConfig.apiKey !== "PASTE_ME" && TMDB_TOKEN !== "PASTE_ME";
