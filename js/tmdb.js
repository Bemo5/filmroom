// TMDB client — search films + build poster URLs.
import { TMDB_TOKEN } from './config.js';

const BASE = 'https://api.themoviedb.org/3';
export const IMG = (path, size = 'w342') =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : null;

async function tmdb(path, params = {}) {
  const url = new URL(BASE + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TMDB_TOKEN}`, accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  return res.json();
}

const year = (d) => (d ? d.slice(0, 4) : '');

export async function searchFilms(query) {
  if (!query.trim()) return [];
  const data = await tmdb('/search/movie', { query, include_adult: 'false', page: '1' });
  return (data.results || [])
    .filter((m) => m.poster_path || m.release_date)
    .slice(0, 20)
    .map((m) => ({
      tmdbId: m.id,
      title: m.title,
      year: year(m.release_date),
      posterPath: m.poster_path || null,
      overview: m.overview || '',
    }));
}
