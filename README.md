# 🎬 Filmroom

A private, Letterboxd-style film-rating web app for you and your friends — built as
a static site (works on iPhone + Android + desktop, "Add to Home Screen" for an
app feel) with a Firebase backend and film data from TMDB.

**How it works**
- **Rooms** — private spaces (you + chosen friends). Add a film, everyone posts their
  own rating + take, shown side-by-side to compare.
- **Diary** — your personal log of everything you've rated.
- **Admin (you)** — approve/deny signups, revoke or restore access, override things.
- **Stars** — the 10-star, quarter-step system from BooksPro ("X / 10", shelf-relative
  labels).

---

## Setup (~10 min, all free)

You only need to do this once.

### 1. TMDB token (film search + posters)
1. Sign up at <https://www.themoviedb.org/>.
2. **Settings ▸ API** → request a key (Developer, personal use).
3. Copy the **API Read Access Token** (the long `eyJ…`).

### 2. Firebase project (accounts + database)
1. <https://console.firebase.google.com/> → **Add project** (name `filmroom`, Analytics off).
2. **Build ▸ Authentication ▸ Get started ▸ Email/Password ▸ Enable**.
3. **Build ▸ Firestore Database ▸ Create database ▸ Production mode**.
4. **Firestore ▸ Rules** → paste the contents of [`firestore.rules`](firestore.rules) → **Publish**.
5. **⚙️ Project settings ▸ General ▸ Your apps ▸ `</>`** → register a web app → copy the
   `firebaseConfig` object.

### 3. Paste your keys
Open [`js/config.js`](js/config.js) and fill in:
- `firebaseConfig` — the object from step 2.5
- `TMDB_TOKEN` — the token from step 1
- `ADMIN_EMAIL` — the email you'll sign up with (default: `youssef.imnm@gmail.com`).
  If you change it, also update `ADMIN_EMAIL()` in `firestore.rules` and re-publish.

> These values are safe to commit — the Firestore rules are what protect your data.

### 4. First run
Sign up with your admin email first → you're auto-approved as admin. Friends sign up →
you approve them in the **Admin** tab.

---

## Run locally
It's static files, but ES modules need a server (not `file://`):

```bash
# any of these from the project folder:
npx serve .
# or
python -m http.server 8000
```
Then open the printed URL.

## Deploy (GitHub Pages)
Already hosted from this repo's `main` branch. To update: commit + push, and Pages
redeploys in ~1 min.

Live URL: `https://bemo5.github.io/filmroom/`

## Stack
Vanilla JS (ES modules) · Firebase Auth + Firestore · TMDB API · GitHub Pages. No build step.
