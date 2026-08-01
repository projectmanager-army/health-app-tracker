import {
  PHASES, buildWeeks, currentWeekInfo, isoDate, MONTHS,
  SUPP_INFO, MOBILITY_LABELS, PRERACE_LABELS, CYCLE_DATA, cyclePhaseForDay,
  iconFor, RACE_DATE, addDays, daysBetween,
} from './data.js';
import { load, save, getDay, setDay, today, mobilityStreak, mouthTapeStreak, mergeWithDefaults } from './storage.js';

let state = load();
const ui = {
  tab: 'home',
  selectedDay: null,     // {week, label, type, detail}
  selectedSupp: null,    // supp info object
  showColdHeat: false,
  showReadinessPopover: false,
  reportPeriod: 'week',
  newChecklistItem: '',
  showCycleDatePicker: false,
  toast: null,
  integrations: { oura: false, strava: false, configured: { oura: false, strava: false } },
  ouraLive: null,      // {score, day} | {error}
  ouraSummary: null,   // {readiness, sleep, activity} | {error}
  stravaSyncing: false,
  proteinLookupQuery: '',
  proteinLookupResult: null,  // {description, proteinPer100g} | {error} | null
  proteinLookupLoading: false,
  proteinLookupGrams: 100,
};

const WEEKS = buildWeeks();
// let, not const: rolled over automatically at midnight by checkMidnightRollover()
// so mobility/supplements/checklist/water/protein reset to a fresh day without
// needing a page reload.
let TODAY_ISO = today();

function persist() { save(state); }

function toast(msg) {
  ui.toast = msg;
  render();
  setTimeout(() => { ui.toast = null; render(); }, 1800);
}

// ---------------- helpers ----------------

// Whole calendar days remaining until race day, DST-safe (see addDays/
// daysBetween in data.js -- raw millisecond math drifts across Nov 1, 2026).
function computeDaysToRace() {
  return Math.max(0, daysBetween(new Date(), RACE_DATE));
}

// Cycle day is always derived fresh from cycleStartDate, never cached --
// a stored value only updates when something explicitly recomputes it, which
// silently goes stale if the tab isn't open at the exact moment a day rolls
// over (laptop asleep, tab closed). Deriving it on every read means it's
// correct on any page load or render, no matter when you last had it open.
function currentCycleDay() {
  if (state.cycleStartDate) {
    const start = new Date(state.cycleStartDate + 'T00:00:00');
    const diff = daysBetween(start, new Date());
    return ((diff % 28) + 28) % 28 + 1;
  }
  return state.cycleDay || 1;
}

function getReadiness() {
  if (ui.integrations.oura && ui.ouraLive && typeof ui.ouraLive.score === 'number') {
    return ui.ouraLive.score;
  }
  return state.ouraReadiness;
}

function fmtKm(km) {
  return `${Math.round(km * 10) / 10} km`;
}

function ring(size, strokeWidth, pct, color, trackColor = 'var(--surface2)') {
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (c * Math.max(0, Math.min(100, pct))) / 100;
  const cx = size / 2, cy = size / 2;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${trackColor}" stroke-width="${strokeWidth}"></circle>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${offset}" transform="rotate(-90 ${cx} ${cy})"></circle>
  </svg>`;
}

function gradIcon(icon, c1, c2, size) {
  return `<div class="gradient-icon-wrap" style="width:${size}px;height:${size}px;">
    <div class="gradient-icon-blob" style="background:${c1};"></div>
    <i class="${icon} gradient-icon" style="font-size:${Math.round(size * 0.55)}px;background-image:linear-gradient(135deg,${c1},${c2});"></i>
  </div>`;
}

function checkBtn({ done, small, action, id }) {
  return `<button class="check ${small ? 'check-sm' : ''} ${done ? 'done' : ''}" data-action="${action}" data-id="${id ?? ''}">
    <i class="${done ? 'ti ti-check' : 'ti ti-circle'}"></i>
  </button>`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function buildChartPaths(values, w, h) {
  const n = values.length;
  if (n < 2) return { linePath: '', areaPath: '' };
  const max = Math.max(...values, 1);
  const stepX = w / (n - 1);
  const pts = values.map((v, i) => [i * stepX, h - (v / max) * h * 0.9 - h * 0.05]);
  let line = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) line += ` L ${pts[i][0]},${pts[i][1]}`;
  const area = `${line} L ${w},${h} L 0,${h} Z`;
  return { linePath: line, areaPath: area };
}

function chartSvg(values, w, h, color, gradId) {
  const { linePath, areaPath } = buildChartPaths(values, w, h);
  return `<svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="overflow:visible;">
    <defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.45"></stop>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"></stop>
    </linearGradient></defs>
    <path d="${areaPath}" fill="url(#${gradId})"></path>
    <path d="${linePath}" fill="none" stroke="${color}" stroke-width="5" stroke-opacity="0.35" style="filter:blur(4px);"></path>
    <path d="${linePath}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>
  </svg>`;
}

function sumRunKmForDate(iso) {
  return state.runLog.filter((r) => r.date === iso).reduce((a, r) => a + r.km, 0);
}

function currentWeek() {
  const { weekIdx } = currentWeekInfo();
  return WEEKS[weekIdx];
}

function weeklyKm() {
  const wk = currentWeek();
  return wk.days.reduce((a, d) => a + sumRunKmForDate(d.iso), 0);
}

// ---------------- header ----------------

function renderHeader() {
  const tabs = [
    ['home', 'ti ti-home', 'Home'],
    ['overview', 'ti ti-chart-bar', 'Overview'],
    ['plan', 'ti ti-calendar', 'Plan'],
    ['mobility', 'ti ti-stretching', 'Mobility'],
    ['supplements', 'ti ti-apple', 'Nutrition'],
    ['cycle', 'ti ti-moon-stars', 'Cycle'],
    ['shoes', 'ti ti-shoe', 'Shoes'],
    ['race', 'ti ti-flag-2', 'Race Day'],
  ];
  return `
  <div class="header">
    <div class="header-left">
      <div class="header-logo"><img src="assets/runner-icon.png" alt="Runner icon"></div>
      <div class="header-title">Honolulu<span> Training Tracker</span></div>
    </div>
    <div class="header-nav">
      ${tabs.map(([id, icon, label]) => `
        <button class="nav-btn ${ui.tab === id ? 'active' : ''}" data-action="tab" data-tab="${id}">
          <i class="${icon}"></i>${label}
        </button>`).join('')}
    </div>
    <div style="position:relative;">
      <div class="header-readiness" data-action="toggle-readiness"><i class="ti ti-heartbeat"></i>Readiness ${getReadiness()}</div>
      ${ui.showReadinessPopover ? renderIntegrationsPopover() : ''}
    </div>
  </div>`;
}

function renderIntegrationsPopover() {
  const { oura, strava, configured } = ui.integrations;
  const ouraLive = ui.ouraLive;

  const ouraSection = oura
    ? `<div class="integ-row">
        <div class="integ-row-head"><i class="ti ti-heartbeat" style="color:var(--teal);"></i>Oura <span class="integ-connected">connected</span></div>
        ${ouraLive && typeof ouraLive.score === 'number'
          ? `<div class="integ-value">${ouraLive.score} <span class="integ-value-sub">readiness · ${ouraLive.day ?? ''}</span></div>`
          : `<div class="integ-error">${ouraLive?.error === 'unauthorized' ? 'Token expired — generate a new one in server/config.json.' : 'Could not load readiness yet.'}</div>`}
        <button class="btn-ghost" style="margin-top:8px;padding:6px 0;font-size:11.5px;" data-action="refresh-oura">Refresh</button>
      </div>`
    : configured.oura
      ? `<div class="integ-row"><div class="integ-row-head"><i class="ti ti-heartbeat"></i>Oura</div><div class="integ-error">Not connecting — check the token in server/config.json.</div></div>`
      : `<div class="integ-row">
          <div class="integ-row-head"><i class="ti ti-heartbeat"></i>Oura</div>
          <div class="integ-hint">Add a Personal Access Token to <code>server/config.json</code> to sync readiness automatically.</div>
          <label style="display:block;margin-top:8px;">Manual readiness</label>
          <input type="range" min="40" max="100" step="1" value="${state.ouraReadiness}" data-action="set-readiness">
          <div class="val">${state.ouraReadiness}</div>
        </div>`;

  const stravaSection = strava
    ? `<div class="integ-row">
        <div class="integ-row-head"><i class="ti ti-run" style="color:var(--coral);"></i>Strava <span class="integ-connected">connected</span></div>
        <button class="btn-ghost" style="margin-top:8px;padding:6px 0;font-size:11.5px;" data-action="sync-strava">${ui.stravaSyncing ? 'Syncing…' : 'Sync runs now'}</button>
        <button class="btn-ghost" style="margin-top:6px;padding:6px 0;font-size:11.5px;" data-action="disconnect-strava">Disconnect</button>
      </div>`
    : configured.strava
      ? `<div class="integ-row">
          <div class="integ-row-head"><i class="ti ti-run"></i>Strava</div>
          <a class="btn-ghost" style="margin-top:8px;padding:6px 0;font-size:11.5px;display:block;text-align:center;color:var(--text);" href="/auth/strava/login">Connect Strava</a>
        </div>`
      : `<div class="integ-row">
          <div class="integ-row-head"><i class="ti ti-run"></i>Strava</div>
          <div class="integ-hint">Add a Client ID/Secret to <code>server/config.json</code>, then reconnect.</div>
        </div>`;

  return `<div class="readiness-popover" data-action="stop">${ouraSection}${stravaSection}</div>`;
}

// ---------------- sidebar ----------------

function renderSidebar() {
  const daysToRace = computeDaysToRace();
  const digits = String(daysToRace).padStart(3, '0').split('');
  const wk = currentWeek();
  const { dayIdx } = currentWeekInfo();
  const todayDay = wk.days[dayIdx];
  const readiness = getReadiness();
  const day = getDay(state, TODAY_ISO);

  const checklist = state.customChecklist.map((item) => ({
    ...item,
    done: !!day.checklist[item.id],
  }));

  return `
  <div class="sidebar">
    <div class="card countdown-card">
      <div class="blob" style="width:140px;height:140px;background:var(--teal);filter:blur(30px);opacity:0.35;top:-50px;left:-40px;"></div>
      <div class="blob" style="width:120px;height:120px;background:var(--coral);filter:blur(30px);opacity:0.3;bottom:-40px;right:-30px;"></div>
      <div class="blob" style="width:90px;height:90px;background:var(--phase3);filter:blur(26px);opacity:0.25;top:10px;right:10px;"></div>
      <div class="countdown-label">Countdown</div>
      <div class="countdown-title">Honolulu Marathon</div>
      <div class="countdown-digits" id="countdown-digits">
        ${digits.map((d) => `<div class="countdown-digit"><div class="split"></div><span>${d}</span></div>`).join('')}
      </div>
      <div class="countdown-sub">Days · Dec 13, 2026</div>
    </div>

    <div class="card card-pad-sm">
      <div class="today-eyebrow">Today's session</div>
      <div class="today-type">${esc(todayDay.type)}</div>
      <div class="today-detail">${esc(todayDay.detail)}</div>
      ${readiness < 70 ? `<div class="recovery-note"><i class="ti ti-battery-2"></i>Readiness is low — consider an easier version.</div>` : ''}
      <div class="today-coaching">
        <div class="today-coaching-row"><i class="ti ti-map-pin"></i><div>${wk.phaseIdx >= 3 ? 'Try to run 10am–2pm today to simulate Honolulu heat.' : 'Flat, familiar route — save new terrain for down weeks.'}</div></div>
        <div class="today-coaching-row"><i class="ti ti-gauge"></i><div>${todayDay.type.includes('Long') ? 'Nasal breathing only, conversational pace throughout.' : (todayDay.type.includes('Tempo') || todayDay.type.includes('Race-Pace')) ? 'Warm up easy, settle into effort only once breathing is smooth.' : 'Keep it easy — this is aerobic base, not a workout.'}</div></div>
        <div class="today-coaching-row"><i class="ti ti-shoe"></i><div>ASICS Gel-Nimbus for anything over 90 min; NB Fresh Foam otherwise.</div></div>
      </div>
    </div>

    <div class="card card-pad-sm">
      <div class="checklist-title">Daily checklist</div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${checklist.map((item) => `
          <div class="checklist-row" data-action="toggle-checklist" data-id="${item.id}">
            <div class="checklist-icon" style="background:${item.tintSoft};"><i class="${item.icon}" style="color:${item.tint};"></i></div>
            <div class="checklist-label">${esc(item.label)}</div>
            ${checkBtn({ done: item.done, small: true, action: 'toggle-checklist', id: item.id })}
          </div>`).join('')}
      </div>
      <div class="checklist-add">
        <input id="new-checklist-input" placeholder="Add habit…" value="${esc(ui.newChecklistItem)}" data-action="new-checklist-input">
        <button data-action="add-checklist"><i class="ti ti-plus"></i></button>
      </div>
    </div>
  </div>`;
}

// ---------------- home ----------------

function digitTiles(value, digitCount) {
  const digits = String(Math.max(0, Math.round(value))).padStart(digitCount, '0').split('');
  return `<div class="digit-tiles">${digits.map((d) => `<div class="digit-tile"><span>${d}</span></div>`).join('')}</div>`;
}

function renderOuraHeroCard() {
  if (!ui.integrations.oura) {
    return `<div class="oura-hero-card not-connected">
      <div class="oura-hero-head"><div class="oura-hero-title">Oura today</div></div>
      <div class="oura-hero-hint">Connect Oura (readiness pill in the header) to see readiness, sleep, and activity here.</div>
    </div>`;
  }

  const s = ui.ouraSummary;
  if (!s) {
    return `<div class="oura-hero-card">
      <div class="oura-hero-head"><div class="oura-hero-title">Oura today</div></div>
      <div class="oura-hero-hint">Loading…</div>
    </div>`;
  }
  if (s.error) {
    return `<div class="oura-hero-card">
      <div class="oura-hero-head">
        <div class="oura-hero-title">Oura today</div>
        <button class="oura-hero-refresh" data-action="refresh-oura-summary">Refresh</button>
      </div>
      <div class="oura-hero-hint">${s.error === 'unauthorized' ? 'Token expired — update it in server config.' : 'Could not load Oura data.'}</div>
    </div>`;
  }

  const rows = [
    { label: 'Readiness', value: s.readiness?.score, icon: 'ti ti-heartbeat' },
    { label: 'Sleep', value: s.sleep?.score, icon: 'ti ti-moon' },
    { label: 'Activity', value: s.activity?.score, icon: 'ti ti-flame' },
  ];

  return `<div class="oura-hero-card">
    <div class="oura-hero-head">
      <div class="oura-hero-title">Oura today</div>
      <button class="oura-hero-refresh" data-action="refresh-oura-summary">Refresh</button>
    </div>
    ${rows.map((r) => `
      <div class="oura-hero-row">
        <div class="oura-hero-row-left"><i class="${r.icon}"></i><span>${r.label.toUpperCase()}</span></div>
        <div class="oura-hero-row-value">${r.value != null ? r.value : '—'}</div>
      </div>`).join('')}
  </div>`;
}

function renderHomeSideCol(wk, km) {
  const steps = ui.integrations.oura && ui.ouraSummary && !ui.ouraSummary.error ? ui.ouraSummary.activity?.steps : null;

  return `<div class="home-side-col">
    <div class="side-card">
      ${gradIcon('ti ti-calendar-event', 'var(--phase2)', 'var(--teal)', 48)}
      <div class="side-card-body">
        <div class="side-card-title">${wk.phaseName}</div>
        <div class="side-card-sub">Current phase</div>
      </div>
    </div>
    <div class="side-card">
      ${gradIcon('ti ti-route', 'var(--coral)', 'var(--phase3)', 48)}
      <div class="side-card-body">
        <div class="side-card-label">km this week</div>
        ${digitTiles(km, 3)}
      </div>
    </div>
    <div class="side-card">
      ${gradIcon('ti ti-walk', 'var(--phase3)', 'var(--coral)', 48)}
      <div class="side-card-body">
        <div class="side-card-label">steps today</div>
        ${steps != null ? digitTiles(steps, 5) : '<div class="side-card-sub">Connect Oura for step data</div>'}
      </div>
    </div>
  </div>`;
}

function renderHome() {
  const wk = currentWeek();
  const day = getDay(state, TODAY_ISO);
  const now = new Date();
  const todayLabel = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const { weekIdx } = currentWeekInfo();

  const cycleDayNum = currentCycleDay();
  const cyclePhase = cyclePhaseForDay(cycleDayNum);
  const dots = Array.from({ length: 28 }, (_, i) => `<div class="cycle-dot" style="background:${i + 1 === cycleDayNum ? cyclePhase.color : 'var(--surface2)'};"></div>`).join('');

  const km = weeklyKm();
  const mobilityDoneCount = Object.keys(MOBILITY_LABELS).filter((id) => day.mobility[id]).length;

  return `
  <div>
    <div style="margin-bottom:16px;">
      <div class="welcome-title">Welcome back</div>
      <div class="welcome-sub">${todayLabel} · Week ${wk.week} of 27 · ${wk.phaseName}</div>
    </div>

    <div class="home-hero-grid">
      ${renderOuraHeroCard()}
      ${renderHomeSideCol(wk, km)}
    </div>

    <div class="card cycle-card">
      <div class="cycle-head">
        <div class="cycle-head-left">
          ${gradIcon('ti ti-moon-stars', cyclePhase.color, 'var(--teal)', 34)}
          <div class="cycle-title">Cycle tracking</div>
        </div>
        <span class="cycle-badge" style="background:${cyclePhase.soft};color:${cyclePhase.color};">${cyclePhase.label}</span>
      </div>
      <div class="cycle-note">Day ${cycleDayNum} of 28 · ${cyclePhase.note}</div>
      <div class="cycle-dots">${dots}</div>
      <div class="cycle-foods">
        <div class="cycle-foods-label">Recommended foods</div>
        <div class="cycle-foods-text">${cyclePhase.groups.map((g) => g.items).join(', ')}</div>
      </div>
    </div>

    <div class="two-col-grid">
      <div class="card link-card-dark" data-action="tab" data-tab="plan">
        <div class="link-card-dark-head"><div>Long run build &amp; taper</div><i class="ti ti-arrow-up-right"></i></div>
        ${chartSvg(WEEKS.map((w) => w.barPct), 300, 90, 'var(--teal)', 'lrGrad')}
      </div>
      <div class="card link-card" data-action="tab" data-tab="mobility">
        <div class="link-card-head"><div>Mobility today</div><i class="ti ti-arrow-up-right"></i></div>
        <div class="link-card-num">${mobilityDoneCount}/6</div>
        <div class="link-card-sub">non-negotiables done</div>
      </div>
    </div>

    <div class="two-col-grid-even">
      <div class="card ring-card">
        ${ring(70, 7, (day.waterMl / 2200) * 100, 'var(--phase2)')}
        <div style="flex:1;">
          <div class="ring-card-title">Water</div>
          <div class="ring-card-sub">${day.waterMl}ml of 2200ml</div>
          <div class="quick-adds">
            <button class="quick-add-btn" data-action="add-water" data-ml="250">+250ml</button>
            <button class="quick-add-btn" data-action="add-water" data-ml="500">+500ml</button>
            <button class="quick-add-btn" data-action="add-water" data-ml="750">+750ml</button>
          </div>
        </div>
      </div>
      <div class="card ring-card">
        ${ring(70, 7, (day.proteinGrams / 110) * 100, 'var(--teal)')}
        <div style="flex:1;">
          <div class="ring-card-title">Protein</div>
          <div class="ring-card-sub">${day.proteinGrams}g of 110g</div>
          <div class="quick-adds">
            <button class="quick-add-btn" data-action="add-protein" data-g="7">+ Egg</button>
            <button class="quick-add-btn" data-action="add-protein" data-g="25">+ Shake</button>
            <button class="quick-add-btn" data-action="add-protein" data-g="30">+ Meal</button>
          </div>
        </div>
      </div>
    </div>

    <div class="card cold-heat-card" data-action="open-coldheat">
      <div class="cold-heat-head"><div>Cold &amp; heat therapy</div><i class="ti ti-arrow-up-right"></i></div>
      <div class="cold-heat-row">
        <div class="cold-heat-tile" style="background:rgba(74,184,212,0.10);">
          <div class="cold-heat-tile-title" style="color:#4AB8D4;"><i class="ti ti-snowflake"></i>Cold</div>
          <div class="cold-heat-tile-num">3–4× / wk</div>
          <div class="cold-heat-tile-sub">2–4 min, 10–15°C</div>
        </div>
        <div class="cold-heat-tile" style="background:rgba(255,92,52,0.10);">
          <div class="cold-heat-tile-title" style="color:#FF5C34;"><i class="ti ti-flame"></i>Sauna</div>
          <div class="cold-heat-tile-num">3–4× / wk</div>
          <div class="cold-heat-tile-sub">15–20 min, infrared</div>
        </div>
      </div>
      <div class="cold-heat-warn"><i class="ti ti-alert-triangle"></i>Vasovagal + seizure history — always sit to exit, never plunge alone</div>
    </div>
  </div>`;
}

// ---------------- overview ----------------

// Number of calendar days since the earliest record in state.daily (inclusive
// of today). Used so "avg per day" divides by days you've actually been
// using the tracker, not the full nominal period -- otherwise a brand-new
// user selecting "week" would have today's real numbers averaged against six
// days that predate the app even existing for them, making the average look
// artificially low no matter how consistently they log.
function daysSinceFirstUse() {
  const keys = Object.keys(state.daily);
  if (keys.length === 0) return 1;
  const earliest = keys.sort()[0];
  const earliestDate = new Date(earliest + 'T00:00:00');
  const diff = daysBetween(earliestDate, new Date()) + 1;
  return Math.max(1, diff);
}

function buildReport(period) {
  const days = period === 'week' ? 7 : period === 'month' ? 30 : 189;
  const effectiveDays = Math.min(days, daysSinceFirstUse());
  let totalKm = 0, totalWater = 0, totalProtein = 0, mobilitySum = 0, suppSum = 0, checklistSum = 0;
  const dayBars = [];
  const mobilityCount = Object.keys(MOBILITY_LABELS).length;
  const suppCount = Object.keys(SUPP_INFO).length;
  const checklistCount = Math.max(1, state.customChecklist.length);

  for (let i = 0; i < days; i++) {
    const d = addDays(new Date(), -(days - 1 - i));
    const iso = isoDate(d);
    const rec = state.daily[iso];
    const km = sumRunKmForDate(iso);
    const water = rec ? rec.waterMl : 0;
    const protein = rec ? rec.proteinGrams : 0;
    const mobilityDone = rec ? Object.values(rec.mobility || {}).filter(Boolean).length : 0;
    const suppDone = rec ? Object.values(rec.supplements || {}).filter(Boolean).length : 0;
    const checklistDone = rec ? Object.values(rec.checklist || {}).filter(Boolean).length : 0;
    totalKm += km; totalWater += water; totalProtein += protein;
    mobilitySum += (mobilityDone / mobilityCount) * 100;
    suppSum += (suppDone / suppCount) * 100;
    checklistSum += (checklistDone / checklistCount) * 100;
    dayBars.push({ km, label: `${MONTHS[d.getMonth()]} ${d.getDate()}` });
  }

  const bucketed = days > 14 ? bucketBars(dayBars, 14) : dayBars;

  return {
    periodLabel: period === 'week' ? 'last 7 days' : period === 'month' ? 'last 30 days' : 'all time',
    totalKmLabel: fmtKm(totalKm),
    avgKmLabel: fmtKm(totalKm / effectiveDays),
    avgWaterLabel: `${Math.round(totalWater / effectiveDays)}ml`,
    avgProteinLabel: `${Math.round(totalProtein / effectiveDays)}g`,
    mobilityPct: Math.round(mobilitySum / effectiveDays),
    suppPct: Math.round(suppSum / effectiveDays),
    checklistPct: Math.round(checklistSum / effectiveDays),
    kmValues: bucketed.map((b) => b.km),
  };
}

function bucketBars(bars, n) {
  const size = Math.ceil(bars.length / n);
  const out = [];
  for (let i = 0; i < bars.length; i += size) {
    const chunk = bars.slice(i, i + size);
    const avgKm = chunk.reduce((a, b) => a + b.km, 0) / chunk.length;
    out.push({ km: avgKm });
  }
  return out;
}

function renderOverview() {
  const report = buildReport(ui.reportPeriod);
  const periods = [['week', 'Week'], ['month', 'Month'], ['all', 'All']];
  return `
  <div>
    <div class="page-head">
      <div>
        <div class="page-title">Overview</div>
        <div class="page-sub">Progress across every tracked habit.</div>
      </div>
      <div class="period-toggle">
        ${periods.map(([id, label]) => `<button class="period-btn ${ui.reportPeriod === id ? 'active' : ''}" data-action="report-period" data-period="${id}">${label}</button>`).join('')}
      </div>
    </div>

    <div class="stats-grid3">
      <div class="card">
        <div class="stat-card-head"><i class="ti ti-route" style="color:var(--teal);"></i><div class="stat-card-head-label">Distance</div></div>
        <div class="stat-card-num">${report.totalKmLabel}</div>
        <div class="stat-card-sub">${report.avgKmLabel} avg / day</div>
      </div>
      <div class="card">
        <div class="stat-card-head"><i class="ti ti-droplet" style="color:var(--phase2);"></i><div class="stat-card-head-label">Water</div></div>
        <div class="stat-card-num">${report.avgWaterLabel}</div>
        <div class="stat-card-sub">avg per day · target 2200ml</div>
      </div>
      <div class="card">
        <div class="stat-card-head"><i class="ti ti-meat" style="color:var(--amber-text);"></i><div class="stat-card-head-label">Protein</div></div>
        <div class="stat-card-num">${report.avgProteinLabel}</div>
        <div class="stat-card-sub">avg per day · target 110g</div>
      </div>
    </div>

    <div class="ring-stats-grid">
      <div class="card ring-stat">
        ${ring(72, 7, report.mobilityPct, 'var(--phase3)')}
        <div class="ring-stat-num">${report.mobilityPct}%</div>
        <div class="ring-stat-label">Mobility adherence</div>
      </div>
      <div class="card ring-stat">
        ${ring(72, 7, report.suppPct, 'var(--teal)')}
        <div class="ring-stat-num">${report.suppPct}%</div>
        <div class="ring-stat-label">Supplement adherence</div>
      </div>
      <div class="card ring-stat">
        ${ring(72, 7, report.checklistPct, 'var(--amber-text)')}
        <div class="ring-stat-num">${report.checklistPct}%</div>
        <div class="ring-stat-label">Daily checklist adherence</div>
      </div>
    </div>

    <div class="chart-card">
      <div class="chart-card-title">Distance per day — ${report.periodLabel}</div>
      ${chartSvg(report.kmValues, 300, 110, 'var(--teal)', 'ovGrad')}
    </div>

    <div class="card backup-card">
      <div class="backup-card-head">
        <div>
          <div class="backup-card-title">Backup &amp; restore</div>
          <div class="backup-card-sub">Your data lives only in this browser. Export it periodically so a browser data-clear, a new device, or switching browsers never loses it.</div>
        </div>
      </div>
      <div class="backup-card-actions">
        <button class="quick-add-btn lg" data-action="export-backup"><i class="ti ti-download"></i> Download backup</button>
        <button class="quick-add-btn lg" data-action="import-backup-trigger"><i class="ti ti-upload"></i> Restore from backup</button>
        <input type="file" accept="application/json" id="import-backup-input" style="display:none;" data-action="import-backup-input">
      </div>
    </div>
  </div>`;
}

// ---------------- plan ----------------

function renderPlan() {
  const { weekIdx, dayIdx } = currentWeekInfo();
  const wk = currentWeek();

  const thisWeekDays = wk.days.map((d, i) => {
    const isToday = i === dayIdx;
    const short = d.type.length > 20 ? d.type.slice(0, 18) + '…' : d.type;
    return { d, isToday, short };
  });

  return `
  <div>
    <div class="plan-head">
      <div class="page-title">27-week plan</div>
      <div class="phase-legend">
        ${PHASES.map((p) => `<div class="phase-legend-item"><span class="phase-legend-dot" style="background:${p.color};"></span>${p.name}</div>`).join('')}
      </div>
    </div>
    <div class="plan-sub">Click any day for the full session detail.</div>

    <div class="this-week-title">This week</div>
    <div class="this-week-grid">
      ${thisWeekDays.map(({ d, isToday, short }) => `
        <div class="this-week-day ${isToday ? 'today' : ''}" data-action="open-day" data-week="${wk.week}" data-day="${d.day}">
          <div class="this-week-day-name">${d.label.split(' ')[0]}</div>
          <div class="this-week-day-num">${d.label.split(' ').slice(-1)[0]}</div>
          <div class="this-week-day-icon-wrap">
            ${gradIcon(iconFor(d.type), isToday ? '#20221E' : wk.phaseColor, isToday ? 'rgba(32,34,30,0.5)' : 'var(--coral)', 36)}
          </div>
          <div class="this-week-day-short">${esc(short)}</div>
        </div>`).join('')}
    </div>

    ${WEEKS.map((w) => `
      <div class="week-row">
        <div class="week-row-label">Week ${w.week}<div class="week-row-date">${w.dateLabel}</div></div>
        <div class="week-row-days">
          ${w.days.map((d) => {
            const isToday = w.week === weekIdx + 1 && d.day === dayIdx;
            const bg = isToday ? w.phaseColor : w.phaseSoft;
            const fg = isToday ? '#fff' : w.phaseColor;
            return `<div class="week-day-chip" style="background:${bg};color:${fg};" data-action="open-day" data-week="${w.week}" data-day="${d.day}">
              <div class="week-day-chip-label">${d.label.split(' ')[0]}</div>
              <div class="week-day-chip-code">${d.code}</div>
            </div>`;
          }).join('')}
        </div>
        ${w.isDown ? `<span class="down-week-badge">down week</span>` : ''}
      </div>`).join('')}
  </div>`;
}

// ---------------- mobility ----------------

function renderMobility() {
  const day = getDay(state, TODAY_ISO);
  const doneCount = Object.keys(MOBILITY_LABELS).filter((id) => day.mobility[id]).length;
  const missed = Math.max(0, 6 - doneCount);

  const items = Object.keys(MOBILITY_LABELS).map((id) => {
    const [name, sub, icon, color] = MOBILITY_LABELS[id];
    const done = !!day.mobility[id];
    const streak = mobilityStreak(state, id);
    return `
      <div class="card mobility-row" data-action="toggle-mobility" data-id="${id}">
        <div class="mobility-icon-wrap">${gradIcon(icon, color, 'var(--coral)', 42)}</div>
        <div style="flex:1;">
          <div class="mobility-name">${esc(name)}</div>
          <div class="mobility-sub">${esc(sub)}</div>
        </div>
        ${checkBtn({ done, action: 'toggle-mobility', id })}
        <div class="mobility-streak"><i class="ti ti-flame" style="color:${color};"></i>${streak}</div>
      </div>`;
  }).join('');

  const mtDone = day.mouthTape;
  const mtStreak = mouthTapeStreak(state);

  return `
  <div>
    <div class="page-title" style="margin-bottom:4px;">Daily mobility</div>
    <div class="page-sub" style="margin-bottom:18px;">The achilles, hips and breathing work — non-negotiable.</div>
    ${missed > 0 ? `<div class="missed-note"><i class="ti ti-mood-neutral"></i>You have ${missed} item${missed === 1 ? '' : 's'} left today — no worries, just pick back up.</div>` : ''}
    <div class="mobility-grid">${items}</div>
    <div class="nightly-label">Nightly</div>
    <div class="card nightly-row" data-action="toggle-mouthtape">
      ${checkBtn({ done: mtDone, action: 'toggle-mouthtape' })}
      <div style="flex:1;">
        <div class="mobility-name">Mouth tape</div>
        <div class="mobility-sub">Nasal breathing conversion, every night</div>
      </div>
      <div class="mobility-streak"><i class="ti ti-flame" style="color:var(--teal);"></i>${mtStreak}</div>
    </div>
  </div>`;
}

// ---------------- supplements ----------------

function renderProteinLookupResult() {
  const r = ui.proteinLookupResult;
  if (!r) return '';

  if (r.error) {
    const msg = {
      no_config: 'Add a USDA FoodData Central API key to server/config.json to enable lookup.',
      no_query: 'Type a food name first.',
      unauthorized: 'USDA API key invalid — check server/config.json.',
    }[r.error] || 'Could not look that up right now.';
    return `<div class="integ-error" style="margin-top:8px;">${esc(msg)}</div>`;
  }
  if (r.found === false) {
    return `<div class="integ-hint" style="margin-top:8px;">No match found — try a different or simpler search term.</div>`;
  }

  const grams = ui.proteinLookupGrams;
  const estimated = Math.round((r.proteinPer100g * grams) / 100);
  return `
    <div class="protein-lookup-match">
      <div class="protein-lookup-match-desc">${esc(r.description)} — ${r.proteinPer100g}g protein per 100g</div>
      <div class="protein-lookup-match-row">
        <input type="number" min="0" id="protein-lookup-grams" value="${grams}" data-action="protein-lookup-grams-input">
        <span class="protein-lookup-match-g">g ≈ ${estimated}g protein</span>
        <button class="quick-add-btn lg" data-action="protein-lookup-add" data-grams="${estimated}">Add ${estimated}g</button>
      </div>
    </div>`;
}

function renderSupplements() {
  const day = getDay(state, TODAY_ISO);
  const proteinPct = (day.proteinGrams / 110) * 100;
  const waterPct = (day.waterMl / 2200) * 100;

  const suppRow = (id) => {
    const info = SUPP_INFO[id];
    const done = !!day.supplements[id];
    return `
      <div class="card supp-row">
        ${checkBtn({ done, small: true, action: 'toggle-supp', id })}
        <div class="supp-row-body" data-action="open-supp" data-id="${id}">
          <div class="supp-row-name">${esc(info.name)}</div>
          <div class="supp-row-dose">${esc(info.dose)}</div>
          ${info.hasReminder ? `<div class="supp-reminder"><i class="ti ti-bell"></i> reminder 40 min before runs</div>` : ''}
        </div>
        <i class="ti ti-leaf" style="color:var(--teal);"></i>
      </div>`;
  };

  const morning = Object.keys(SUPP_INFO).filter((id) => SUPP_INFO[id].section === 'morning');
  const prerun = Object.keys(SUPP_INFO).filter((id) => SUPP_INFO[id].section === 'prerun');
  const nightly = Object.keys(SUPP_INFO).filter((id) => SUPP_INFO[id].section === 'nightly');

  return `
  <div>
    <div class="page-title" style="margin-bottom:4px;">Nutrition</div>
    <div class="page-sub" style="margin-bottom:18px;">Water, protein, and the cruelty-free supplement stack — click any item to see why it's there.</div>

    <div class="card supp-hero">
      ${ring(76, 8, proteinPct, 'var(--teal)')}
      <div style="flex:1;min-width:0;">
        <div class="supp-hero-title">Protein today</div>
        <div class="supp-hero-sub">${day.proteinGrams}g of 110g target — recovery &amp; tendon repair.</div>
        <div class="quick-adds">
          <button class="quick-add-btn lg" data-action="add-protein" data-g="7">+ Egg (7g)</button>
          <button class="quick-add-btn lg" data-action="add-protein" data-g="25">+ Shake (25g)</button>
          <button class="quick-add-btn lg" data-action="add-protein" data-g="30">+ Meal (30g)</button>
          <button class="quick-add-btn lg" data-action="add-protein" data-g="10">+ Snack (10g)</button>
          <button class="quick-add-btn lg" data-action="add-protein" data-g="20">+ Greek Yogurt (20g)</button>
          <button class="quick-add-btn lg" data-action="add-protein" data-g="31">+ Chicken Breast (31g)</button>
          <button class="quick-add-btn lg" data-action="add-protein" data-g="25">+ Salmon (25g)</button>
          <button class="quick-add-btn lg" data-action="add-protein" data-g="24">+ Protein Powder (24g)</button>
          <button class="quick-add-btn lg" data-action="add-protein" data-g="8">+ Tofu (8g)</button>
          <button class="quick-add-btn lg" data-action="add-protein" data-g="8">+ Peanut Butter (8g)</button>
          <button class="quick-add-btn reset" data-action="reset-protein">Reset</button>
        </div>

        <div class="protein-manual-row">
          <input type="number" min="0" id="protein-manual-input" placeholder="Grams" class="protein-manual-input">
          <button class="quick-add-btn lg" data-action="add-protein-manual">Add</button>
        </div>

        <div class="protein-lookup">
          <div class="protein-lookup-label">Don't know the protein content? Look it up:</div>
          <div class="protein-lookup-row">
            <input type="text" id="protein-lookup-input" placeholder="e.g. chicken breast" value="${esc(ui.proteinLookupQuery)}" data-action="protein-lookup-input">
            <button class="quick-add-btn lg" data-action="protein-lookup-search">${ui.proteinLookupLoading ? 'Looking up…' : 'Look up'}</button>
          </div>
          ${renderProteinLookupResult()}
        </div>
      </div>
    </div>

    <div class="card supp-hero">
      ${ring(76, 8, waterPct, 'var(--phase2)')}
      <div style="flex:1;min-width:0;">
        <div class="supp-hero-title">Water today</div>
        <div class="supp-hero-sub">${day.waterMl}ml of 2200ml target.</div>
        <div class="quick-adds">
          <button class="quick-add-btn lg" data-action="add-water" data-ml="250">+250ml</button>
          <button class="quick-add-btn lg" data-action="add-water" data-ml="500">+500ml</button>
          <button class="quick-add-btn lg" data-action="add-water" data-ml="750">+750ml</button>
          <button class="quick-add-btn reset" data-action="reset-water">Reset</button>
        </div>

        <div class="protein-manual-row">
          <input type="number" min="0" id="water-manual-input" placeholder="ml" class="protein-manual-input">
          <button class="quick-add-btn lg" data-action="add-water-manual">Add</button>
        </div>
      </div>
    </div>

    <div class="supp-cols">
      <div>
        <div class="supp-col-head"><span class="supp-col-dot" style="background:var(--amber-text);"></span><div class="supp-col-label">Morning</div></div>
        ${morning.map(suppRow).join('')}
      </div>
      <div>
        <div class="supp-col-head"><span class="supp-col-dot" style="background:var(--phase2);"></span><div class="supp-col-label">Pre-run</div></div>
        ${prerun.map(suppRow).join('')}
      </div>
      <div>
        <div class="supp-col-head"><span class="supp-col-dot" style="background:var(--phase3);"></span><div class="supp-col-label">Nightly</div></div>
        ${nightly.map(suppRow).join('')}
      </div>
    </div>
  </div>`;
}

// ---------------- cycle ----------------

function renderCycle() {
  const cycleDay = currentCycleDay();
  const phase = cyclePhaseForDay(cycleDay);
  const activeId = ui.selectedCyclePhaseId || phase.id;
  const activePhase = CYCLE_DATA[activeId];
  const dots = Array.from({ length: 28 }, (_, i) => `<div class="cycle-dot" style="height:8px;border-radius:4px;background:${i + 1 === cycleDay ? phase.color : 'var(--surface2)'};"></div>`).join('');

  return `
  <div>
    <div class="page-title" style="margin-bottom:4px;">Cycle tracking</div>
    <div class="page-sub" style="margin-bottom:18px;">Track your phase and eat with it.</div>

    <div class="card" style="padding:22px;margin-bottom:20px;">
      <div class="cycle-head">
        <div class="cycle-head-left">
          ${gradIcon('ti ti-moon-stars', phase.color, 'var(--teal)', 40)}
          <div style="font-size:16px;font-weight:800;">Day ${cycleDay} of 28</div>
        </div>
        <span class="cycle-badge" style="background:${phase.soft};color:${phase.color};font-size:11.5px;padding:4px 10px;">${phase.label}</span>
      </div>
      <div class="cycle-note" style="margin-bottom:14px;">${phase.note}</div>
      <div class="cycle-dots" style="margin-bottom:16px;">${dots}</div>
      <div style="margin-top:14px;text-align:center;">
        <button class="btn-ghost" style="flex:none;padding:8px 14px;" data-action="toggle-cycle-datepicker">${state.cycleStartDate ? 'Update period start date' : 'Set period start date'}</button>
      </div>
      ${ui.showCycleDatePicker ? `
        <div style="margin-top:10px;display:flex;gap:8px;justify-content:center;align-items:center;">
          <input type="date" id="cycle-start-input" value="${state.cycleStartDate ?? ''}" style="border:0.5px solid var(--border);background:var(--surface2);border-radius:9px;padding:8px 10px;font-size:12.5px;color:var(--text);">
          <button class="btn-ghost" style="flex:none;padding:8px 14px;background:var(--teal);color:#20221E;" data-action="save-cycle-start">Save</button>
        </div>` : ''}
    </div>

    <div style="font-size:14px;font-weight:700;margin-bottom:4px;">Cycle syncing foods</div>
    <div style="font-size:12.5px;color:var(--sub);margin-bottom:12px;">Recommended foods for each phase — tap to browse.</div>
    <div class="cycle-phase-buttons">
      ${Object.keys(CYCLE_DATA).map((id) => {
        const d = CYCLE_DATA[id];
        const active = id === activeId;
        return `<button class="cycle-phase-btn" style="background:${active ? d.color : 'var(--surface2)'};color:${active ? '#fff' : 'var(--text)'};" data-action="select-cycle-phase" data-id="${id}">${d.label}</button>`;
      }).join('')}
    </div>
    <div class="card">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <span style="width:9px;height:9px;border-radius:50%;background:${activePhase.color};display:inline-block;"></span>
        <div style="font-size:15px;font-weight:700;">${activePhase.label} phase</div>
      </div>
      <div style="font-size:12px;color:var(--sub);margin-bottom:16px;">${activePhase.length}</div>
      <div class="food-groups-grid">
        ${activePhase.groups.map((g) => `<div><div class="food-group-label">${g.name}</div><div class="food-group-items">${esc(g.items)}</div></div>`).join('')}
      </div>
    </div>
  </div>`;
}

// ---------------- shoes ----------------

function renderShoes() {
  return `
  <div>
    <div class="page-title" style="margin-bottom:4px;">Shoe tracker</div>
    <div class="page-sub" style="margin-bottom:18px;">Rotate two pairs — retire at 500km.</div>
    <div class="shoes-grid">
      ${state.shoes.map((sh, i) => {
        const pct = Math.min(100, Math.round((sh.km / 500) * 100));
        const warn = sh.km >= 450;
        const ringColor = warn ? 'var(--coral)' : 'var(--teal)';
        const blobColor = i === 0 ? 'var(--teal)' : 'var(--phase2)';
        return `
        <div class="card shoe-card">
          <div class="shoe-blob" style="background:${blobColor};"></div>
          <div class="shoe-photo" data-action="shoe-photo" data-id="${sh.id}">
            ${sh.photo ? `<img src="${sh.photo}" alt="${esc(sh.name)}">` : `<span>Drop / click to add a shoe photo</span>`}
          </div>
          <input type="file" accept="image/*" id="shoe-file-${sh.id}" style="display:none;" data-action="shoe-photo-input" data-id="${sh.id}">
          <div class="shoe-body">
            <div class="shoe-ring">
              ${ring(88, 7, pct, ringColor)}
              <div class="shoe-ring-pct">${pct}%</div>
            </div>
            <div style="flex:1;min-width:140px;">
              <div class="shoe-name">${esc(sh.name)}</div>
              <div class="shoe-sub">${esc(sh.sub)}</div>
              <div class="shoe-km">${fmtKm(sh.km)} of ${fmtKm(500)}</div>
              ${warn ? `<div class="shoe-warn"><i class="ti ti-alert-triangle"></i>approaching retirement</div>` : ''}
            </div>
          </div>
          <div class="shoe-add">
            <input placeholder="Add km" id="shoe-input-${sh.id}" inputmode="decimal">
            <button data-action="add-shoe-km" data-id="${sh.id}"><i class="ti ti-plus"></i>Log</button>
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

// ---------------- race day ----------------

function renderRace() {
  const daysToRace = computeDaysToRace();
  const day = getDay(state, TODAY_ISO);

  const prerace = Object.keys(PRERACE_LABELS).map((id) => ({
    id, label: PRERACE_LABELS[id], done: !!state.prerace[id],
  }));

  return `
  <div>
    <div class="race-hero" data-action="race-photo" ${state.racePhoto ? `style="background-image:url(${state.racePhoto});background-size:cover;background-position:center;"` : ''}>
      <input type="file" accept="image/*" id="race-photo-file" style="display:none;" data-action="race-photo-input">
      <div class="race-hero-overlay"></div>
      <div class="race-hero-content">
        <div class="race-hero-eyebrow">Race day countdown ${state.racePhoto ? '' : '· click to add a photo'}</div>
        <div class="race-hero-days" id="race-hero-days">${daysToRace} days · Dec 13, 2026</div>
        <div class="race-hero-sub">Honolulu, HI · start ~5:00am</div>
      </div>
    </div>
    <div class="race-grid">
      <div class="card">
        <div class="race-card-head">${gradIcon('ti ti-clipboard-check', 'var(--teal)', 'var(--phase2)', 36)}<div class="race-card-title">Pre-race checklist</div></div>
        ${prerace.map((item) => `
          <div class="prerace-row" data-action="toggle-prerace" data-id="${item.id}">
            ${checkBtn({ done: item.done, small: true, action: 'toggle-prerace', id: item.id })}
            <div class="prerace-label">${esc(item.label)}</div>
          </div>`).join('')}
      </div>
      <div class="card">
        <div class="race-card-head">${gradIcon('ti ti-gauge', 'var(--phase2)', 'var(--teal)', 38)}<div class="race-card-title">Pacing strategy</div></div>
        <div class="race-card-body">Go out 30–45 sec/km slower than goal pace for the first 10km. Run/walk is a legitimate strategy. Negative split is the ideal — only achievable by starting conservatively.</div>
      </div>
      <div class="card">
        <div class="race-card-head">${gradIcon('ti ti-sun', 'var(--coral)', 'var(--phase5)', 38)}<div class="race-card-title">Heat management</div></div>
        <div class="race-card-body">Course gets hot fast after sunrise. Pour water on wrists, neck and head at every aid station from km 25. Walking aid stations is strategy, not failure.</div>
      </div>
      <div class="card">
        <div class="race-card-head">${gradIcon('ti ti-droplet', 'var(--teal)', 'var(--phase2)', 38)}<div class="race-card-title">Fueling schedule</div></div>
        <div class="race-card-body">Fuel every 40–45 min from km 10. Dates + banana, or Maurten gels. Electrolytes every 45 min from km 15.</div>
      </div>
      <div class="card race-span2">
        <div class="race-card-head">${gradIcon('ti ti-flag-2', 'var(--phase3)', 'var(--coral)', 38)}<div class="race-card-title">Aid station reminders</div></div>
        <div class="race-card-body">Water on wrists/neck/head from km 25. Electrolytes from km 15, every 45 min. Walk through — grab, sip, breathe, go.</div>
      </div>
    </div>
  </div>`;
}

// ---------------- modals ----------------

function renderModals() {
  let html = '';

  if (ui.selectedDay) {
    const d = ui.selectedDay;
    html += `
    <div class="modal-overlay" data-action="close-day">
      <div class="modal" data-action="stop">
        <div class="modal-head">
          <div><div class="modal-eyebrow">Week ${d.week} · ${d.label}</div><div class="modal-title">${esc(d.type)}</div></div>
          <button class="modal-close" data-action="close-day"><i class="ti ti-x"></i></button>
        </div>
        <div class="modal-body">${esc(d.detail)}</div>
      </div>
    </div>`;
  }

  if (ui.selectedSupp) {
    const s = ui.selectedSupp;
    html += `
    <div class="modal-overlay" data-action="close-supp">
      <div class="modal" data-action="stop">
        <div class="modal-head">
          <div class="modal-title">${esc(s.name)}</div>
          <button class="modal-close" data-action="close-supp"><i class="ti ti-x"></i></button>
        </div>
        <div class="modal-body" style="margin-bottom:10px;">${esc(s.why)}</div>
        <div class="modal-sub">${esc(s.brand)}</div>
      </div>
    </div>`;
  }

  if (ui.showColdHeat) {
    html += `
    <div class="modal-overlay" data-action="close-coldheat">
      <div class="modal wide" data-action="stop">
        <div class="modal-head">
          <div class="modal-title">Cold &amp; heat protocol</div>
          <button class="modal-close" data-action="close-coldheat"><i class="ti ti-x"></i></button>
        </div>
        <div class="coldheat-alert">
          <i class="ti ti-alert-triangle"></i>
          <div>Vasovagal syncope + seizure history. Biggest risk is standing up too fast after exiting cold. Always sit to exit; never plunge alone, especially the first 6–8 weeks.</div>
        </div>
        <div class="coldheat-section-label" style="color:#4AB8D4;">Cold progression</div>
        <div class="coldheat-section-body">
          <div><strong>Weeks 1–3:</strong> cold shower endings, 30–60 sec, stay standing.</div>
          <div><strong>Weeks 4–5:</strong> extend to 2–3 min, practice the sit-to-exit routine.</div>
          <div><strong>Week 6+:</strong> cold plunge, 2–4 min, never alone, sit 30 sec before standing.</div>
          <div style="color:var(--sub);margin-top:4px;">Söberg protocol target: 11 min/week total, split across 3–4 sessions.</div>
        </div>
        <div class="coldheat-section-label" style="color:#D4894A;">Sauna</div>
        <div class="coldheat-section-body">Infrared 45–65°C to start (lower autonomic demand); build to traditional sauna after 4–6 weeks. 3–4×/week, 15–20 min. Stay seated, hydrate before and after, exit at first dizziness. Evening sessions (3–7pm) help sleep onset. Target: 57 min/week total.</div>
        <div class="coldheat-section-label">Non-negotiables</div>
        <div class="coldheat-section-body" style="margin-bottom:0;">Sit to exit, every time. Know the warning signs — tunnel vision, nausea, sudden warmth, pallor — and lie down with legs elevated immediately. No hot shower right after cold (rapid vasodilation raises syncope risk). No sauna combined with fasting or alcohol. Contrast therapy only after 6–8 weeks symptom-free, and only with someone present.</div>
      </div>
    </div>`;
  }

  return html;
}

// ---------------- render root ----------------

function render() {
  const app = document.getElementById('app');
  const tabContent = {
    home: renderHome, overview: renderOverview, plan: renderPlan, mobility: renderMobility,
    supplements: renderSupplements, cycle: renderCycle, shoes: renderShoes, race: renderRace,
  }[ui.tab]();

  app.innerHTML = `
    <div data-theme="${state.darkMode ? 'dark' : 'light'}" style="min-height:100vh;background:var(--bg);color:var(--text);">
      ${renderHeader()}
      <div class="layout">
        ${renderSidebar()}
        <div class="main">${tabContent}</div>
      </div>
    </div>
    ${renderModals()}
    ${ui.toast ? `<div class="toast">${esc(ui.toast)}</div>` : ''}
  `;

  attachInputHandlers();
}

function attachInputHandlers() {
  const readinessInput = document.querySelector('[data-action="set-readiness"]');
  if (readinessInput) {
    readinessInput.addEventListener('input', (e) => {
      state.ouraReadiness = parseInt(e.target.value, 10);
      persist();
      render();
    });
  }
  const checklistInput = document.getElementById('new-checklist-input');
  if (checklistInput) {
    checklistInput.addEventListener('input', (e) => { ui.newChecklistItem = e.target.value; });
    checklistInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAddChecklist(); });
  }
  const proteinLookupInput = document.getElementById('protein-lookup-input');
  if (proteinLookupInput) {
    proteinLookupInput.addEventListener('input', (e) => { ui.proteinLookupQuery = e.target.value; });
    proteinLookupInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') proteinLookupSearch(); });
  }
  // Patches just the live estimate + Add button in place (not a full render)
  // so the grams input keeps focus while you type.
  const lookupGramsInput = document.getElementById('protein-lookup-grams');
  if (lookupGramsInput) {
    lookupGramsInput.addEventListener('input', (e) => {
      const grams = parseFloat(e.target.value) || 0;
      ui.proteinLookupGrams = grams;
      if (ui.proteinLookupResult && ui.proteinLookupResult.found) {
        const estimated = Math.round((ui.proteinLookupResult.proteinPer100g * grams) / 100);
        const gLabel = document.querySelector('.protein-lookup-match-g');
        const addBtn = document.querySelector('[data-action="protein-lookup-add"]');
        if (gLabel) gLabel.textContent = `g ≈ ${estimated}g protein`;
        if (addBtn) { addBtn.textContent = `Add ${estimated}g`; addBtn.dataset.grams = String(estimated); }
      }
    });
  }
}

// ---------------- actions ----------------

function toggleMobility(id) {
  const day = getDay(state, TODAY_ISO);
  setDay(state, TODAY_ISO, { mobility: { ...day.mobility, [id]: !day.mobility[id] } });
  persist(); render();
}
function toggleMouthTape() {
  const day = getDay(state, TODAY_ISO);
  setDay(state, TODAY_ISO, { mouthTape: !day.mouthTape });
  persist(); render();
}
function toggleSupp(id) {
  const day = getDay(state, TODAY_ISO);
  setDay(state, TODAY_ISO, { supplements: { ...day.supplements, [id]: !day.supplements[id] } });
  persist(); render();
}
function toggleChecklist(id) {
  const day = getDay(state, TODAY_ISO);
  setDay(state, TODAY_ISO, { checklist: { ...day.checklist, [id]: !day.checklist[id] } });
  persist(); render();
}
function togglePrerace(id) {
  state.prerace = { ...state.prerace, [id]: !state.prerace[id] };
  persist(); render();
}
function addProtein(g) {
  const day = getDay(state, TODAY_ISO);
  setDay(state, TODAY_ISO, { proteinGrams: Math.max(0, day.proteinGrams + g) });
  persist(); render();
}
function resetProtein() {
  setDay(state, TODAY_ISO, { proteinGrams: 0 });
  persist(); render();
}
function addProteinManual() {
  const input = document.getElementById('protein-manual-input');
  const g = parseFloat(input.value);
  if (!g || g <= 0) return;
  addProtein(Math.round(g));
}
async function proteinLookupSearch() {
  const query = ui.proteinLookupQuery.trim();
  if (!query) return;
  ui.proteinLookupLoading = true;
  ui.proteinLookupResult = null;
  render();
  try {
    ui.proteinLookupResult = await fetch(`/api/nutrition/protein?food=${encodeURIComponent(query)}`).then((r) => r.json());
  } catch {
    ui.proteinLookupResult = { error: 'network' };
  }
  ui.proteinLookupGrams = 100;
  ui.proteinLookupLoading = false;
  render();
}
function proteinLookupAdd(grams) {
  addProtein(grams);
  ui.proteinLookupQuery = '';
  ui.proteinLookupResult = null;
  toast(`Added ${grams}g protein`);
}
function addWater(ml) {
  const day = getDay(state, TODAY_ISO);
  setDay(state, TODAY_ISO, { waterMl: Math.max(0, day.waterMl + ml) });
  persist(); render();
}
function resetWater() {
  setDay(state, TODAY_ISO, { waterMl: 0 });
  persist(); render();
}
function addWaterManual() {
  const input = document.getElementById('water-manual-input');
  const ml = parseFloat(input.value);
  if (!ml || ml <= 0) return;
  addWater(Math.round(ml));
}
function doAddChecklist() {
  const label = ui.newChecklistItem.trim();
  if (!label) return;
  const tints = [
    ['var(--teal)', 'var(--teal-soft)'], ['var(--phase2)', 'rgba(93,133,173,0.14)'],
    ['var(--phase3)', 'rgba(122,63,91,0.14)'], ['var(--coral)', 'var(--coral-soft)'],
    ['var(--amber-text)', 'var(--amber-soft)'],
  ];
  const t = tints[state.customChecklist.length % tints.length];
  const id = 'custom-' + Date.now();
  state.customChecklist = [...state.customChecklist, { id, label, icon: 'ti ti-circle-check', tint: t[0], tintSoft: t[1] }];
  ui.newChecklistItem = '';
  persist(); render();
}
function selectCyclePhase(id) {
  ui.selectedCyclePhaseId = id;
  render();
}
function addShoeKm(id) {
  const input = document.getElementById(`shoe-input-${id}`);
  const val = parseFloat(input.value);
  if (!val || val <= 0) return;
  state.shoes = state.shoes.map((sh) => sh.id === id ? { ...sh, km: sh.km + val } : sh);
  state.runLog = [...state.runLog, { date: TODAY_ISO, km: val, shoeId: id }];
  persist(); render();
  toast(`Logged ${val}km`);
}
function shoePhotoPick(id) {
  document.getElementById(`shoe-file-${id}`).click();
}
function shoePhotoSet(id, file) {
  const reader = new FileReader();
  reader.onload = () => {
    state.shoes = state.shoes.map((sh) => sh.id === id ? { ...sh, photo: reader.result } : sh);
    persist(); render();
  };
  reader.readAsDataURL(file);
}
function racePhotoPick() {
  document.getElementById('race-photo-file').click();
}
function racePhotoSet(file) {
  const reader = new FileReader();
  reader.onload = () => {
    state.racePhoto = reader.result;
    persist(); render();
  };
  reader.readAsDataURL(file);
}
// ---------------- integrations (Oura / Strava) ----------------

async function fetchStatus() {
  try {
    const res = await fetch('/api/status').then((r) => r.json());
    ui.integrations = { oura: !!res.oura, strava: !!res.strava, configured: res.configured || { oura: false, strava: false } };
  } catch {
    ui.integrations = { oura: false, strava: false, configured: { oura: false, strava: false } };
  }
  render();
  if (ui.integrations.oura) { fetchOuraReadiness(false); fetchOuraSummary(false); }
  if (ui.integrations.strava) syncStrava(false);
}

async function fetchOuraReadiness(manual) {
  try {
    ui.ouraLive = await fetch('/api/oura/readiness').then((r) => r.json());
  } catch {
    ui.ouraLive = { error: 'network' };
  }
  render();
  if (manual) toast(typeof ui.ouraLive.score === 'number' ? `Oura readiness: ${ui.ouraLive.score}` : 'Could not refresh Oura readiness');
}

async function fetchOuraSummary(manual) {
  try {
    ui.ouraSummary = await fetch('/api/oura/summary').then((r) => r.json());
  } catch {
    ui.ouraSummary = { connected: true, error: 'network' };
  }
  render();
  if (manual) toast(ui.ouraSummary.error ? 'Could not refresh Oura data' : 'Oura data refreshed');
}

async function syncStrava(manual) {
  ui.stravaSyncing = true; render();
  try {
    const res = await fetch('/api/strava/activities?days=120').then((r) => r.json());
    if (res.connected && res.activities) {
      const existingIds = new Set(state.runLog.map((r) => r.sourceId).filter(Boolean));
      let added = 0;
      for (const a of res.activities) {
        if (existingIds.has(a.id)) continue;
        state.runLog.push({ date: a.date, km: a.km, sourceId: a.id, source: 'strava', name: a.name });
        added++;
      }
      if (added) persist();
      if (manual) toast(added ? `Synced ${added} run${added === 1 ? '' : 's'} from Strava` : 'Strava is up to date');
    } else if (manual) {
      toast('Could not sync Strava');
    }
  } catch {
    if (manual) toast('Could not sync Strava');
  }
  ui.stravaSyncing = false; render();
}

async function disconnectStrava() {
  try { await fetch('/api/strava/disconnect'); } catch { /* ignore */ }
  ui.integrations.strava = false;
  render();
  toast('Strava disconnected');
}

function handleOAuthRedirectParams() {
  const params = new URLSearchParams(window.location.search);
  const strava = params.get('strava');
  if (strava) {
    if (strava === 'connected') toast('Strava connected!');
    else if (strava === 'denied') toast('Strava connection was declined');
    else toast('Strava connection failed');
    window.history.replaceState({}, '', window.location.pathname);
  }
}

// Recomputes the race countdown and patches just the digit/text nodes in
// place, so it stays accurate across midnight without a full re-render
// (which would blow away focus/typed input elsewhere on the page).
function updateCountdownDisplays() {
  const daysToRace = computeDaysToRace();

  const digitsEl = document.getElementById('countdown-digits');
  if (digitsEl) {
    const digits = String(daysToRace).padStart(3, '0').split('');
    digitsEl.innerHTML = digits.map((d) => `<div class="countdown-digit"><div class="split"></div><span>${d}</span></div>`).join('');
  }

  const raceDaysEl = document.getElementById('race-hero-days');
  if (raceDaysEl) {
    raceDaysEl.textContent = `${daysToRace} days · Dec 13, 2026`;
  }
}

// Detects a real calendar-day change (e.g. the tab was left open past midnight)
// and rolls today's tracking state over to a fresh day. Because mobility/
// supplements/checklist/water/protein are all keyed by TODAY_ISO in
// state.daily, simply advancing TODAY_ISO to the new date and re-rendering is
// enough -- getDay() returns a blank day for a date with no stored entry yet,
// so everything appears unchecked/zeroed with no separate "reset" step needed.
function checkMidnightRollover() {
  const nowIso = today();
  if (nowIso === TODAY_ISO) return;
  TODAY_ISO = nowIso;
  // Cycle day is derived fresh by currentCycleDay() on every render, so
  // there's nothing to recompute here -- just re-render to pick it up.
  render();
  toast("New day — today's tracking has reset.");
}

function saveCycleStart() {
  const input = document.getElementById('cycle-start-input');
  if (!input || !input.value) return;
  state.cycleStartDate = input.value;
  ui.showCycleDatePicker = false;
  persist(); render();
}

// ---------------- backup / restore ----------------

function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `honolulu-tracker-backup-${TODAY_ISO}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('Backup downloaded');
}

function importBackupTrigger() {
  document.getElementById('import-backup-input').click();
}

function importBackupFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try {
      parsed = JSON.parse(reader.result);
    } catch {
      toast('That file is not a valid backup');
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      toast('That file is not a valid backup');
      return;
    }
    state = mergeWithDefaults(parsed);
    persist();
    render();
    toast('Backup restored');
  };
  reader.onerror = () => toast('Could not read that file');
  reader.readAsText(file);
}

// ---------------- event delegation ----------------

document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-action]');
  if (!target) {
    if (ui.showReadinessPopover) { ui.showReadinessPopover = false; render(); }
    return;
  }
  const action = target.dataset.action;
  const id = target.dataset.id;

  switch (action) {
    case 'tab':
      ui.tab = target.dataset.tab;
      ui.selectedDay = null; ui.selectedSupp = null;
      render();
      window.scrollTo({ top: 0, behavior: 'instant' });
      break;
    case 'toggle-readiness':
      e.stopPropagation();
      ui.showReadinessPopover = !ui.showReadinessPopover;
      render();
      break;
    case 'toggle-mobility': toggleMobility(id); break;
    case 'toggle-mouthtape': toggleMouthTape(); break;
    case 'toggle-supp': toggleSupp(id); break;
    case 'open-supp': ui.selectedSupp = SUPP_INFO[id]; render(); break;
    case 'close-supp': ui.selectedSupp = null; render(); break;
    case 'toggle-checklist': toggleChecklist(id); break;
    case 'add-checklist': doAddChecklist(); break;
    case 'toggle-prerace': togglePrerace(id); break;
    case 'add-water': addWater(parseInt(target.dataset.ml, 10)); break;
    case 'reset-water': resetWater(); break;
    case 'add-water-manual': addWaterManual(); break;
    case 'add-protein': addProtein(parseInt(target.dataset.g, 10)); break;
    case 'reset-protein': resetProtein(); break;
    case 'add-protein-manual': addProteinManual(); break;
    case 'protein-lookup-search': proteinLookupSearch(); break;
    case 'protein-lookup-add': proteinLookupAdd(parseInt(target.dataset.grams, 10)); break;
    case 'open-day': {
      const week = parseInt(target.dataset.week, 10);
      const dayIdx = parseInt(target.dataset.day, 10);
      const wk = WEEKS[week - 1];
      const d = wk.days[dayIdx];
      ui.selectedDay = { week, label: d.label, type: d.type, detail: d.detail };
      render();
      break;
    }
    case 'close-day': ui.selectedDay = null; render(); break;
    case 'open-coldheat': ui.showColdHeat = true; render(); break;
    case 'close-coldheat': ui.showColdHeat = false; render(); break;
    case 'select-cycle-phase': selectCyclePhase(id); break;
    case 'toggle-cycle-datepicker': ui.showCycleDatePicker = !ui.showCycleDatePicker; render(); break;
    case 'save-cycle-start': saveCycleStart(); break;
    case 'export-backup': exportBackup(); break;
    case 'import-backup-trigger': importBackupTrigger(); break;
    case 'report-period': ui.reportPeriod = target.dataset.period; render(); break;
    case 'add-shoe-km': addShoeKm(id); break;
    case 'shoe-photo': shoePhotoPick(id); break;
    case 'race-photo': racePhotoPick(); break;
    case 'refresh-oura': fetchOuraReadiness(true); fetchOuraSummary(true); break;
    case 'refresh-oura-summary': fetchOuraSummary(true); break;
    case 'sync-strava': syncStrava(true); break;
    case 'disconnect-strava': disconnectStrava(); break;
    case 'stop': e.stopPropagation(); break;
    default: break;
  }
});

document.addEventListener('change', (e) => {
  const shoeTarget = e.target.closest('[data-action="shoe-photo-input"]');
  if (shoeTarget && shoeTarget.files[0]) {
    shoePhotoSet(shoeTarget.dataset.id, shoeTarget.files[0]);
  }
  const raceTarget = e.target.closest('[data-action="race-photo-input"]');
  if (raceTarget && raceTarget.files[0]) {
    racePhotoSet(raceTarget.files[0]);
  }
  const backupTarget = e.target.closest('[data-action="import-backup-input"]');
  if (backupTarget && backupTarget.files[0]) {
    importBackupFile(backupTarget.files[0]);
    backupTarget.value = ''; // allow re-importing the same filename later
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (ui.selectedDay || ui.selectedSupp || ui.showColdHeat) {
      ui.selectedDay = null; ui.selectedSupp = null; ui.showColdHeat = false;
      render();
    }
  }
});

handleOAuthRedirectParams();
render();
fetchStatus();
setInterval(() => {
  updateCountdownDisplays();
  checkMidnightRollover();
}, 60000);
