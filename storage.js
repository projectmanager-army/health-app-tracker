// Persistence layer — localStorage backed, real data (no fake/demo numbers).
import { isoDate, MOBILITY_LABELS, PRERACE_LABELS } from './data.js';

const KEY = 'honolulu-tracker-v1';

function todayIso() {
  return isoDate(new Date());
}

function defaultState() {
  return {
    ouraReadiness: 78,
    cycleStartDate: null, // iso date of day 1 of last period; null until user sets it
    selectedCyclePhaseId: null,
    shoes: [
      { id: 'nb', name: 'NB Fresh Foam', sub: 'Primary — wide, Weeks 1–8', km: 0, photo: null },
      { id: 'asics', name: 'ASICS Gel-Nimbus 27 Wide (2E)', sub: 'Rotation / race day', km: 0, photo: null },
    ],
    runLog: [], // {date, km, shoeId}
    prerace: { gear: false, electrolytes: false, banana: false, alarm: false },
    customChecklist: [
      { id: 'mouthtape', label: 'Mouth tape', icon: 'ti ti-band-aid', tint: 'var(--teal)', tintSoft: 'var(--teal-soft)' },
      { id: 'stretch', label: 'Stretch / mobility', icon: 'ti ti-stretching', tint: 'var(--phase3)', tintSoft: 'rgba(122,63,91,0.14)' },
      { id: 'sauna', label: 'Sauna', icon: 'ti ti-temperature-sun', tint: '#FF5C34', tintSoft: 'rgba(255,92,52,0.14)' },
      { id: 'swim', label: 'Swim', icon: 'ti ti-swimming', tint: 'var(--phase2)', tintSoft: 'rgba(93,133,173,0.14)' },
      { id: 'run', label: 'Run', icon: 'ti ti-run', tint: 'var(--amber-text)', tintSoft: 'var(--amber-soft)' },
    ],
    daily: {}, // date -> { mobility:{id:bool}, mouthTape:bool, supplements:{id:bool}, checklist:{id:bool}, proteinGrams, waterMl, nasalToday, achillesToday }
    darkMode: true,
    racePhoto: null,
  };
}

function emptyDay() {
  return {
    mobility: {}, mouthTape: false, supplements: {}, checklist: {},
    proteinGrams: 0, waterMl: 0, nasalToday: false, achillesToday: null,
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return { ...defaultState(), ...parsed };
  } catch {
    return defaultState();
  }
}

export function save(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function getDay(state, iso) {
  return state.daily[iso] ? { ...emptyDay(), ...state.daily[iso] } : emptyDay();
}

export function setDay(state, iso, patch) {
  const day = getDay(state, iso);
  const merged = { ...day, ...patch };
  state.daily = { ...state.daily, [iso]: merged };
  return state;
}

export function today() {
  return todayIso();
}

// Streak = consecutive days (ending today) where the given predicate on that day's record is true.
export function computeStreak(state, predicate, maxLookback = 400) {
  let streak = 0;
  let d = new Date();
  for (let i = 0; i < maxLookback; i++) {
    const iso = isoDate(d);
    const day = state.daily[iso];
    if (day && predicate(day)) {
      streak++;
      d = new Date(d.getTime() - 86400000);
    } else if (iso === todayIso()) {
      // today not done yet — doesn't break streak, just don't count it
      d = new Date(d.getTime() - 86400000);
    } else {
      break;
    }
  }
  return streak;
}

export function mobilityStreak(state, id) {
  return computeStreak(state, (day) => day.mobility && day.mobility[id]);
}

export function mouthTapeStreak(state) {
  return computeStreak(state, (day) => day.mouthTape);
}
