// Persistence layer — localStorage backed, real data (no fake/demo numbers).
import { isoDate, addDays, MOBILITY_DEFAULTS, SUPPLEMENT_DEFAULTS, EQUIPMENT_DEFAULTS, PACKING_GROUP } from './data.js';

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
      { id: 'nb1080', name: 'New Balance 1080 Fresh Foam', sub: '1080 · max cushion', km: 0, photo: null },
      { id: 'nb880', name: 'New Balance 880 Fresh Foam', sub: '880 · daily trainer — long-run test Nov 8', km: 0, photo: null },
      { id: 'nb860', name: 'New Balance 860 Stability Fresh Foam', sub: '860 · stability', km: 0, photo: null },
    ],
    shoesV2: true, // set once the shoe list has been migrated to the current three
    runLog: [], // {date, km, shoeId}
    prerace: { gear: false, electrolytes: false, banana: false, alarm: false },
    equipmentChecklist: {}, // itemId -> bool, persistent (not daily-reset)
    customEquipment: EQUIPMENT_DEFAULTS.map((e) => ({ ...e })),
    packingV1: true, // set once the packing list column has replaced "Shoes & Socks"
    customChecklist: [
      { id: 'mouthtape', label: 'Mouth tape', icon: 'ti ti-band-aid', tint: 'var(--teal)', tintSoft: 'var(--teal-soft)' },
      { id: 'stretch', label: 'Stretch / mobility', icon: 'ti ti-stretching', tint: 'var(--phase3)', tintSoft: 'rgba(122,63,91,0.14)' },
      { id: 'sauna', label: 'Sauna', icon: 'ti ti-temperature-sun', tint: '#FF5C34', tintSoft: 'rgba(255,92,52,0.14)' },
      { id: 'swim', label: 'Swim', icon: 'ti ti-swimming', tint: 'var(--phase2)', tintSoft: 'rgba(93,133,173,0.14)' },
      { id: 'run', label: 'Run', icon: 'ti ti-run', tint: 'var(--amber-text)', tintSoft: 'var(--amber-soft)' },
    ],
    customMobility: MOBILITY_DEFAULTS.map((m) => ({ ...m })),
    customSupplements: SUPPLEMENT_DEFAULTS.map((s) => ({ ...s })),
    daily: {}, // date -> { mobility:{id:bool}, mouthTape:bool, supplements:{id:bool}, checklist:{id:bool}, proteinGrams, waterMl, nasalToday, achillesToday }
    coachMessages: [], // {role, content, ts, proposals?} -- AI coach chat history. proposals: [{id, date, type, detail, reason, status: 'pending'|'applied'|'dismissed'}]
    healthProfile: '', // free-text medical/lifestyle background, sent to the coach on every message so it doesn't need re-explaining
    coachMemory: [], // {id, text, ts} -- durable facts the coach has picked up from conversation, carried forward beyond the chat window
    planOverrides: {}, // iso date -> {type, detail, reason} -- coach-proposed (and athlete-approved) swaps to that day's template-generated workout
    darkMode: true,
    racePhoto: null,
  };
}

function emptyDay() {
  return {
    mobility: {}, mouthTape: false, supplements: {}, checklist: {},
    proteinGrams: 0, proteinLog: [], waterMl: 0, nasalToday: false, achillesToday: null,
  };
}

// One-time upgrades for data saved before a change shipped. Runs on both
// localStorage loads and backup restores, and never throws away user data:
// the old shoe list is kept under retiredShoes, and any custom items in the
// old "Shoes & Socks" column move into the packing list with their checked
// state (that's keyed by item id, so it carries over untouched).
function migrate(parsed) {
  const d = defaultState();
  const out = { ...parsed };
  if (!out.shoesV2) {
    if (Array.isArray(out.shoes) && out.shoes.length) out.retiredShoes = out.shoes;
    out.shoes = d.shoes;
    out.shoesV2 = true;
  }
  if (!out.packingV1) {
    const items = (Array.isArray(out.customEquipment) ? out.customEquipment : d.customEquipment)
      .map((it) => (it.group === 'Shoes & Socks' ? { ...it, group: PACKING_GROUP } : it));
    const have = new Set(items.map((it) => it.id));
    const added = d.customEquipment.filter((it) => it.group === PACKING_GROUP && !have.has(it.id));
    out.customEquipment = [...items, ...added];
    out.packingV1 = true;
  }
  return out;
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return { ...defaultState(), ...migrate(parsed) };
  } catch {
    return defaultState();
  }
}

// Same safe-merge as load(), but for a backup file being restored rather
// than localStorage -- so an older backup missing newer fields (added after
// the backup was taken) still loads with sane defaults instead of breaking.
export function mergeWithDefaults(parsed) {
  return { ...defaultState(), ...migrate(parsed) };
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
      d = addDays(d, -1);
    } else if (iso === todayIso()) {
      // today not done yet — doesn't break streak, just don't count it
      d = addDays(d, -1);
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
