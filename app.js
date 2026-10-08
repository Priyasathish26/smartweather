'use strict';

/* =========================================================
   Smart Weather & Travel Dashboard
   Data source: WeatherAPI.com (free key: https://www.weatherapi.com)
   Sections: Config · Storage · Api · Conditions/Icons · Rules · UI · Controller
   ========================================================= */

/* ---------- Config ---------- */
const CONFIG = {
  API_KEY: '',                       // paste your key here, or enter it in the on-page banner
  BASE_URL: 'https://api.weatherapi.com/v1/forecast.json',
  HISTORY_MAX: 5,
};

/* ---------- Storage (localStorage wrapper, safe against failures) ---------- */
const Store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
};

/* ---------- API layer ---------- */
class WeatherError extends Error {}

const getKey = () => CONFIG.API_KEY || Store.get('wx_key', '');

async function fetchWeather(query) {
  const key = getKey();
  if (!key) throw new WeatherError('Missing API key. Please enter one above.');

  const url = `${CONFIG.BASE_URL}?key=${encodeURIComponent(key)}&q=${encodeURIComponent(query)}&days=5&aqi=no&alerts=no`;
  let res;
  try {
    res = await fetch(url);
  } catch {
    throw new WeatherError('Network error. Check your connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = data?.error?.code;
    if (code === 1006) throw new WeatherError(`Couldn't find "${query}". Check the city spelling.`);
    if ([1002, 2006, 2007, 2008].includes(code)) throw new WeatherError('API key is invalid, missing or over quota.');
    throw new WeatherError(data?.error?.message || `Request failed (${res.status}).`);
  }
  return data;
}

/* ---------- Condition mapping (WeatherAPI condition codes → category) ---------- */
const CODES = {
  clear: [1000],
  partly: [1003],
  cloudy: [1006, 1009],
  fog: [1030, 1135, 1147],
  thunder: [1087, 1273, 1276, 1279, 1282],
  snow: [1066, 1069, 1114, 1117, 1204, 1207, 1210, 1213, 1216, 1219, 1222, 1225, 1237, 1249, 1252, 1255, 1258, 1261, 1264],
  rain: [1063, 1072, 1150, 1153, 1168, 1171, 1180, 1183, 1186, 1189, 1192, 1195, 1198, 1201, 1240, 1243, 1246],
};
const categoryOf = code => Object.keys(CODES).find(k => CODES[k].includes(code)) || 'cloudy';

/* ---------- SVG icons ---------- */
const SVG = (body) => `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const CLOUD = '<path d="M20 44h26a9 9 0 0 0 1-18 13 13 0 0 0-25-3 10.5 10.5 0 0 0-2 21z" fill="rgba(255,255,255,.25)"/>';
const SUN = '<circle cx="32" cy="32" r="10" fill="#fbbf24" stroke="#fbbf24"/><path stroke="#fbbf24" d="M32 8v6M32 50v6M8 32h6M50 32h6M15 15l4 4M45 45l4 4M49 15l-4 4M19 45l-4 4"/>';
const ICONS = {
  clear: SVG(SUN),
  night: SVG('<path d="M42 40A16 16 0 0 1 24 14a18 18 0 1 0 18 26z" fill="#e5e7eb" stroke="#e5e7eb"/>'),
  partly: SVG('<g transform="translate(-6 -8) scale(.7)">' + SUN + '</g>' + CLOUD),
  cloudy: SVG(CLOUD),
  fog: SVG(CLOUD + '<path d="M16 50h32M22 56h22"/>'),
  rain: SVG(CLOUD + '<path stroke="#7dd3fc" d="M24 50l-3 7M34 50l-3 7M44 50l-3 7"/>'),
  thunder: SVG(CLOUD + '<path stroke="#fbbf24" fill="#fbbf24" d="M34 44l-6 9h6l-3 7 9-11h-6z"/>'),
  snow: SVG(CLOUD + '<path stroke="#e0f2fe" d="M24 51v6M21 54h6M34 51v6M31 54h6M44 51v6M41 54h6"/>'),
};
const iconFor = (code, isDay = 1) => {
  const cat = categoryOf(code);
  return ICONS[cat === 'clear' && !isDay ? 'night' : cat];
};

/* ---------- Rule-based travel recommendations ---------- */
function buildRecommendations({ tempC, category, windKph, uv }) {
  const activities = [], pack = [], advisories = [];
  const stormy = category === 'thunder', wet = category === 'rain' || stormy;
  const snowy = category === 'snow' || tempC < 10;
  const windy = windKph >= 40;

  if (wet) {
    activities.push('Visit museums and art galleries', 'Browse indoor markets or catch a show');
    pack.push('Umbrella', 'Rain boots', 'Waterproof jacket');
    advisories.push('Avoid long road trips while it is wet.');
  }
  if (stormy) advisories.push('Thunderstorm warning: stay indoors and avoid open areas.');
  if (snowy) {
    activities.push('Try winter sports', 'Warm up in a cozy indoor café');
    pack.push('Heavy jacket', 'Thermal wear', 'Beanie and gloves');
  }
  if (tempC > 30 && !wet) {
    activities.push('Head to the beach or enjoy outdoor activities', 'Plan outings for early morning or evening');
    pack.push('Sunscreen', 'Sunglasses', 'Light cotton clothing', 'Water bottle (stay hydrated!)');
  }
  if (windy) {
    activities.push('Choose indoor activities today');
    advisories.push(`Strong winds (${Math.round(windKph)} km/h): check for travel delays and secure loose items.`);
  }
  if (category === 'fog') advisories.push('Poor visibility: drive carefully and allow extra travel time.');
  if (uv >= 8 && !wet) pack.push('High UV: wear a hat and reapply sunscreen');

  // Mild, pleasant fallback
  if (!activities.length) activities.push('Great day for a walk, sightseeing or a picnic', 'Explore local street food and parks');
  if (!pack.length) pack.push('Comfortable layers', 'Light jacket for the evening');

  return { activities, pack, advisories };
}

/* ---------- UI ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const UI = {
  unit: Store.get('wx_unit', 'c'),

  temp(c, f) { return `${Math.round(this.unit === 'c' ? c : f)}°${this.unit.toUpperCase()}`; },

  toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    $('toasts').append(el);
    setTimeout(() => el.remove(), 5000);
  },

  loading(on) { $('loader').hidden = !on; },

  renderHistory(list, onPick) {
    $('history').innerHTML = list.map(c => `<li><button type="button">${esc(c)}</button></li>`).join('');
    $('history').onclick = e => { const b = e.target.closest('button'); if (b) onPick(b.textContent); };
  },

  render(data) {
    const { location: loc, current: cur, forecast } = data;
    const cat = categoryOf(cur.condition.code);

    document.body.dataset.theme = cat;
    $('loc-name').textContent = `${loc.name}, ${loc.country}`;
    $('loc-time').textContent = new Date(loc.localtime.replace(' ', 'T')).toLocaleString([], { dateStyle: 'full', timeStyle: 'short' });
    $('temp').textContent = this.temp(cur.temp_c, cur.temp_f);
    $('condition').textContent = `${cur.condition.text} · feels like ${this.temp(cur.feelslike_c, cur.feelslike_f)}`;
    $('icon').innerHTML = iconFor(cur.condition.code, cur.is_day);
    $('humidity').textContent = `${cur.humidity}%`;
    $('wind').textContent = `${Math.round(cur.wind_kph)} km/h ${cur.wind_dir}`;
    $('uv').textContent = cur.uv;
    $('pressure').textContent = `${cur.pressure_mb} hPa`;

    const rec = buildRecommendations({ tempC: cur.temp_c, category: cat, windKph: cur.wind_kph, uv: cur.uv });
    const list = items => `<ul>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`;
    $('advisory').innerHTML = rec.advisories.length ? `<div class="advisory" role="alert">⚠️ ${rec.advisories.map(esc).join('<br>⚠️ ')}</div>` : '';
    $('recs').innerHTML = `
      <div class="rec"><h3>Things to do</h3>${list(rec.activities)}</div>
      <div class="rec"><h3>What to pack</h3>${list(rec.pack)}</div>
      <div class="rec"><h3>Feels like</h3><p>${esc(cur.condition.text)}, ${this.temp(cur.temp_c, cur.temp_f)} with ${Math.round(cur.wind_kph)} km/h wind.</p></div>`;

    $('forecast').innerHTML = forecast.forecastday.map(({ date, day }) => `
      <li>
        <div class="day">${new Date(date + 'T12:00').toLocaleDateString([], { weekday: 'short', day: 'numeric' })}</div>
        <div aria-hidden="true">${iconFor(day.condition.code)}</div>
        <div class="range">${this.temp(day.maxtemp_c, day.maxtemp_f)} / ${this.temp(day.mintemp_c, day.mintemp_f)}</div>
        <small>${esc(day.condition.text)}</small>
        <small>☔ ${day.daily_chance_of_rain}%</small>
      </li>`).join('');

    $('dashboard').hidden = false;
  },
};

/* ---------- Controller ---------- */
const App = {
  lastData: null,
  history: Store.get('wx_history', []),

  async load(query) {
    query = query.trim();
    if (!query) return;
    UI.loading(true);
    $('dashboard').hidden = true;
    try {
      this.lastData = await fetchWeather(query);
      UI.render(this.lastData);
      if (!/^-?\d/.test(query)) this.remember(this.lastData.location.name); // skip raw coordinates
    } catch (err) {
      if (err instanceof WeatherError) {
        UI.toast(err.message);
        if (err.message.startsWith('Missing') || err.message.startsWith('API key')) $('key-form').hidden = false;
      } else {
        UI.toast('Something went wrong. Please try again.');
        console.error(err);
      }
      if (this.lastData) $('dashboard').hidden = false;   // keep showing previous result
    } finally {
      UI.loading(false);
    }
  },

  remember(city) {
    this.history = [city, ...this.history.filter(c => c.toLowerCase() !== city.toLowerCase())].slice(0, CONFIG.HISTORY_MAX);
    Store.set('wx_history', this.history);
    UI.renderHistory(this.history, c => { $('city').value = c; this.load(c); });
  },

  locate() {
    if (!navigator.geolocation) return UI.toast('Geolocation is not supported by your browser.');
    UI.loading(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => this.load(`${coords.latitude},${coords.longitude}`),
      () => { UI.loading(false); UI.toast('Unable to get your location. Allow access or search by city.'); },
      { timeout: 10000 }
    );
  },

  setUnit(unit) {
    UI.unit = unit;
    Store.set('wx_unit', unit);
    document.querySelectorAll('.unit-toggle button').forEach(b => {
      const on = b.dataset.unit === unit;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on);
    });
    if (this.lastData) UI.render(this.lastData);   // re-render from cache, no new request
  },

  init() {
    $('search-form').addEventListener('submit', e => { e.preventDefault(); this.load($('city').value); });
    $('geo-btn').addEventListener('click', () => this.locate());
    document.querySelector('.unit-toggle').addEventListener('click', e => {
      const b = e.target.closest('button'); if (b) this.setUnit(b.dataset.unit);
    });
    $('key-form').addEventListener('submit', e => {
      e.preventDefault();
      Store.set('wx_key', $('api-key').value.trim());
      $('key-form').hidden = true;
      UI.toast('API key saved. Search for a city to begin.');
    });

    this.setUnit(UI.unit);
    UI.renderHistory(this.history, c => { $('city').value = c; this.load(c); });
    if (!getKey()) $('key-form').hidden = false;
    else if (this.history[0]) this.load(this.history[0]);   // reopen last searched city
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
