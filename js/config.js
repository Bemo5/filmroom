// ============================================================================
//  FILL THESE IN — see README.md, section "Setup".  (Two blocks, ~5 min.)
// ============================================================================

// 1) Firebase — Project settings ▸ General ▸ Your apps ▸ </> ▸ config object.
//    These values are safe to be public; Firestore rules do the real protection.
export const firebaseConfig = {
  apiKey: "AIzaSyCvIxS1wSOcQ1MB9KGiO2jgQ6uiSxnDXyk",
  authDomain: "filmroom-59cc2.firebaseapp.com",
  projectId: "filmroom-59cc2",
  storageBucket: "filmroom-59cc2.firebasestorage.app",
  messagingSenderId: "149692345370",
  appId: "1:149692345370:web:c357e14fda0da608b235a3",
};

// 2) TMDB — themoviedb.org ▸ Settings ▸ API ▸ "API Read Access Token" (eyJ...).
export const TMDB_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJmOTdiM2Q1YzZlOTNhYmViNGFkYTE0ODBjMmZkOTUxMCIsIm5iZiI6MTc4NDg5NDA3NS4wNjQ5OTk4LCJzdWIiOiI2YTYzNTI3YjAyMDQ0NTFmY2E4ZmQ2NDQiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.MH_flhZo_nnGnPdP9fliu_n5jo8wltQHuXmDGyPySuM";

// 3) The email that should be the super-admin (auto-approved, admin powers).
export const ADMIN_EMAIL = "youssef.imnm@gmail.com";

// Helper the app uses to detect an unconfigured install.
export const isConfigured =
  firebaseConfig.apiKey !== "PASTE_ME" && TMDB_TOKEN !== "PASTE_ME";
