// Training plan data & content, ported from the Honolulu Marathon App Spec.

export const RACE_DATE = new Date(2026, 11, 13); // Dec 13, 2026 (a Sunday)
// Week 1 must start on a real Monday for the Mon-Sun day labels/templates to
// line up correctly, and 27 weeks later must land exactly on RACE_DATE.
// Jun 8, 2026 is the Monday of the week 27 weeks before race week.
export const PLAN_START = new Date(2026, 5, 8); // Jun 8, 2026 (a Monday)

// Calendar-safe date math. Plain `new Date(x.getTime() + n*86400000)` breaks
// across a Daylight Saving transition (a "day" isn't always exactly 24h in
// local time), which silently shifts every date computed from it by up to a
// day. This training plan spans Nov 1, 2026 (the DST fall-back), so this
// matters for real: use these instead of raw millisecond arithmetic anywhere
// a specific calendar date is being constructed or compared.
export function addDays(date, n) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + n);
  return d;
}

export function daysBetween(a, b) {
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((db - da) / 86400000);
}

export const PHASES = [
  { name: 'Foundation', color: 'var(--phase1)', soft: 'var(--teal-soft)' },
  { name: 'Base Build', color: 'var(--phase2)', soft: 'rgba(93,133,173,0.14)' },
  { name: 'Build', color: 'var(--phase3)', soft: 'rgba(122,63,91,0.14)' },
  { name: 'Peak', color: 'var(--phase4)', soft: 'rgba(255,92,52,0.14)' },
  { name: 'Taper', color: 'var(--phase5)', soft: 'var(--amber-soft)' },
];

export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const TEMPLATES = [
  [
    { code: 'M', type: 'Mobility — Hip + Ankle', detail: '30 min: 90/90 hip rotations, banded ankle circles, eccentric calf raises 3×15 slow, toe spacers 30–60 min. This is training.' },
    { code: 'R', type: 'Run / Walk', detail: "25–35 min. 3 min run / 2 min walk intervals. Nasal breathing only — if you can't breathe through your nose, slow down." },
    { code: 'S', type: 'Strength — Joint Stability', detail: 'Glute bridges, single-leg deadlift, clamshells, tibialis raises, wall sit holds. 3×12, no heavy load.' },
    { code: 'E', type: 'Easy Run', detail: '20–30 min. Run/walk if the achilles speaks up. Midfoot strike focus.' },
    { code: 'A', type: 'Active Recovery', detail: '10 min cold water foot soak, toe spacers, gentle stretch. Feet up if possible.' },
    { code: 'L', type: 'Long Run', detail: 'Easy pace throughout.' },
    { code: 'X', type: 'Cross-Train', detail: 'Pool swim 30–45 min. Bilateral rhythmic movement regulates the nervous system.' },
  ],
  [
    { code: 'M', type: 'Mobility — Hip + Thoracic', detail: '45 min: deep hip flexor work, thoracic rotation for the rib flare pattern, pigeon pose. Non-negotiable.' },
    { code: 'E', type: 'Easy Run', detail: '35–45 min steady, Zone 2 HR (full sentence pace). Nasal breathing.' },
    { code: 'S', type: 'Strength — Lower Body Load', detail: 'Single-leg RDLs (light dumbbell), Bulgarian split squats, hip thrust, lateral band walks, seated calf raises.' },
    { code: 'E', type: 'Easy + Strides', detail: '30 min easy + 4×20 sec strides — smooth acceleration, not a sprint.' },
    { code: 'F', type: 'Full Recovery', detail: 'Prioritise sleep, feet up, magnesium glycinate at night, legs up the wall 10 min.' },
    { code: 'L', type: 'Long Run', detail: 'Walk breaks allowed.' },
    { code: 'Y', type: 'Cross or Yoga', detail: 'Swim preferred, or 45 min yin yoga targeting hips, hamstrings, IT band.' },
  ],
  [
    { code: 'M', type: 'Mobility — Maintenance', detail: '30 min: target whatever felt tight on the weekend run. Foam roll IT band, calf, hip flexor.' },
    { code: 'T', type: 'Tempo Run', detail: '10 min easy warm-up + 20–25 min comfortably hard (3–4 word sentences) + 10 min cool-down.' },
    { code: 'S', type: 'Strength — Full Lower Body', detail: 'Single-leg squats, hip thrust 3×10 loaded, Romanian deadlift, calf raises 3×15 slow eccentric.' },
    { code: 'E', type: 'Medium-Long Easy', detail: '60–70 min easy. Occasionally run 10am–2pm for heat adaptation.' },
    { code: 'R', type: 'Recovery', detail: 'Epsom salt foot bath, magnesium, legs up the wall. Assess before Saturday.' },
    { code: 'L', type: 'Long Run', detail: 'Carry electrolytes. Practice fueling.' },
    { code: 'A', type: 'Active Recovery', detail: "Swim, easy walk, or restorative yoga only — protect today's adaptation." },
  ],
  [
    { code: 'X', type: 'Full Rest', detail: 'No running. Mandatory recovery after peak weekend runs.' },
    { code: 'E', type: 'Easy + Strides', detail: '40 min easy + 6×20 sec strides.' },
    { code: 'S', type: 'Strength — Maintenance', detail: 'Light strength only. Glutes, hips, single-leg stability. 2 sets, not 3.' },
    { code: 'P', type: 'Race-Pace Work', detail: '15 min easy + 3×10 min at goal marathon pace + 10 min easy.' },
    { code: 'R', type: 'Recovery', detail: 'Sleep focus. Magnesium + omega-3. Legs up the wall.' },
    { code: 'L', type: 'Peak Long Run', detail: 'Run 10am–2pm when possible to simulate Honolulu heat. Practice electrolytes + fueling.' },
    { code: 'S', type: 'Swim Only', detail: '30 min gentle swim — absorb the long run, nothing that causes fatigue.' },
  ],
  [
    { code: 'M', type: 'Mobility — Light', detail: 'Short daily mobility. Keep the achilles and hip work going, lighter volume.' },
    { code: 'E', type: 'Easy Run', detail: 'Short and easy. Legs should feel fresher each week.' },
    { code: 'S', type: 'Rest / Light Strength', detail: 'No new strength work this close to race day.' },
    { code: 'E', type: 'Easy + Short Strides', detail: 'Short easy run with a couple of light strides to stay sharp.' },
    { code: 'R', type: 'Recovery', detail: 'Sleep is the priority now. Legs up the wall nightly.' },
    { code: 'L', type: 'Long Run (reduced)', detail: "Shorter long run — trust the fitness you've built." },
    { code: 'X', type: 'Rest / Swim', detail: 'Gentle swim or full rest.' },
  ],
];

export const LONG_RUN = { 1: 6, 2: 7, 3: 8, 4: 9, 5: 10, 6: 8, 7: 12, 8: 14, 9: 16, 10: 13, 11: 18, 12: 20, 13: 16, 14: 22, 15: 24, 16: 20, 17: 26, 18: 28, 19: 22, 20: 30, 21: 32, 22: 35, 23: 28, 24: 20, 25: 14, 26: 8 };
export const DOWN_WEEKS = new Set([6, 10, 13, 16, 19, 23]);

export function phaseIdxForWeek(w) {
  if (w <= 6) return 0;
  if (w <= 13) return 1;
  if (w <= 19) return 2;
  if (w <= 23) return 3;
  return 4;
}

export function buildWeeks() {
  const weeks = [];
  for (let w = 1; w <= 27; w++) {
    const phaseIdx = phaseIdxForWeek(w);
    const phase = PHASES[phaseIdx];
    const weekStart = addDays(PLAN_START, (w - 1) * 7);
    const weekEnd = addDays(weekStart, 6);
    const dateLabel = `${MONTHS[weekStart.getMonth()]} ${weekStart.getDate()}–${weekEnd.getDate()}`;
    const longRun = LONG_RUN[w] ?? null;
    const days = TEMPLATES[phaseIdx].map((t, i) => {
      const d = addDays(weekStart, i);
      let type = t.type, detail = t.detail, code = t.code;
      if (i === 5 && longRun) detail = `${longRun}km · ${detail}`;
      if (w === 27) {
        // Week 27 runs Mon Dec 7 - Sun Dec 13, 2026 -- race day (Dec 13) is a
        // real Sunday, landing correctly at index 6.
        if (i === 4) { type = 'Easy jog + mobility'; detail = '10 min easy jog + mobility. Lay out all gear today.'; code = 'J'; }
        else if (i === 5) { type = 'Full rest'; detail = 'Full rest. Short 5 min walk only. High-carb dinner, early bed.'; code = 'X'; }
        else if (i === 6) { type = '🌺 RACE DAY'; detail = 'Honolulu Marathon. Start ~5am. Pre-race: electrolytes + banana. Go out slower than you think.'; code = '🌺'; }
      }
      return { label: `${DAY_LABELS[i]} ${MONTHS[d.getMonth()]} ${d.getDate()}`, day: i, type, detail, code, dateObj: d, iso: isoDate(d) };
    });
    weeks.push({
      week: w, phaseIdx, phaseName: phase.name, phaseColor: phase.color, phaseSoft: phase.soft,
      dateLabel, isDown: DOWN_WEEKS.has(w), days,
      barPct: longRun ? Math.max(6, Math.round((longRun / 35) * 100)) : (w === 27 ? 100 : 6),
    });
  }
  return weeks;
}

export function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function currentWeekInfo() {
  const now = new Date();
  let diff = daysBetween(PLAN_START, now);
  if (diff < 0) diff = 0;
  if (diff > 26 * 7 + 6) diff = 26 * 7 + 6;
  return { weekIdx: Math.floor(diff / 7), dayIdx: diff % 7 };
}

// Starting sets for the user-editable mobility/supplement lists (state.customMobility
// / state.customSupplements in storage.js). These are just the initial defaults --
// the user can add, edit, and delete items from here on, so treat this as seed data,
// not a fixed catalog.
export const SUPPLEMENT_DEFAULTS = [
  { id: 'omega3', name: 'Algae-Based Omega-3', dose: '2g EPA+DHA daily', why: 'Anti-inflammatory, joint lubrication, mood support — same bioavailability as fish oil.', brand: 'Algae-sourced = genuinely cruelty-free. Skip fish oil entirely.', section: 'morning' },
  { id: 'd3k2', name: 'Vitamin D3 + K2', dose: 'Per label, with fat', why: 'Bone density, immune support, mood. K2 directs calcium to bones not joints.', brand: 'D3 from lichen (vegan) — avoid lanolin-sourced D3.', section: 'morning' },
  { id: 'creatine', name: 'Creatine Monohydrate', dose: '3–5g daily', why: 'Tendon health, brain fog, endurance support, mood regulation — emerging strong evidence.', brand: 'Creapure — 100% synthetic, vegan, no animal sourcing.', section: 'morning' },
  { id: 'collagen', name: 'Marine Collagen + Vitamin C', dose: '20g + 200mg Vit C, 30–40 min before runs', why: 'Tendon and ligament repair — especially the achilles. Evidence-backed synthesis window.', brand: 'Marine (not bovine) = no animal slaughter testing.', section: 'prerun', hasReminder: true },
  { id: 'electrolytes', name: 'Electrolytes', dose: 'Runs over 60 min + race week', why: 'Sodium, potassium, magnesium — critical in Honolulu heat.', brand: 'LMNT or Redmond Re-Lyte — no artificial dyes or sweeteners.', section: 'prerun' },
  { id: 'magnesium', name: 'Magnesium Glycinate', dose: '300–400mg nightly', why: 'Muscle recovery, tendon health, sleep depth, nervous system — heavily depleted by endurance training.', brand: 'Thorne or Pure Encapsulations. No fillers.', section: 'nightly' },
  { id: 'zinc', name: 'Zinc Bisglycinate', dose: '15–25mg nightly', why: 'Counterbalances copper IUD effect, depleted by endurance training.', brand: 'Thorne or Pure Encapsulations. Take away from copper-rich foods.', section: 'nightly' },
  { id: 'tartcherry', name: 'Tart Cherry Extract', dose: '480mg before sleep, hard days', why: 'Natural COX-2 inhibitor — reduces DOMS without blunting adaptation.', brand: 'Plant-based. No testing concerns.', section: 'nightly' },
];

export const MOBILITY_DEFAULTS = [
  { id: 'calfRaises', name: 'Eccentric calf raises', sub: '3×15, slow 3-count down', icon: 'ti ti-stairs-up', color: 'var(--teal)' },
  { id: 'hipRotations', name: '90/90 hip rotations', sub: '2 min each side', icon: 'ti ti-rotate', color: 'var(--phase2)' },
  { id: 'pigeonPose', name: 'Pigeon pose', sub: '90 sec each side', icon: 'ti ti-yoga', color: 'var(--phase3)' },
  { id: 'footRolling', name: 'Foot rolling', sub: 'Lacrosse ball under the arch', icon: 'ti ti-circle-dot', color: 'var(--coral)' },
  { id: 'toeSpacers', name: 'Toe spacers', sub: '30 min wear', icon: 'ti ti-shoe', color: '#20221E' },
  { id: 'legsUpWall', name: 'Legs up the wall', sub: '10 min', icon: 'ti ti-arrow-big-up-lines', color: 'var(--teal)' },
];

export const PRERACE_LABELS = {
  gear: 'Lay out all race-day gear',
  electrolytes: 'Electrolytes packed for the morning',
  banana: 'Banana ready for pre-race',
  alarm: 'Alarm set — early wake for 5am start',
};

// Recommended equipment, from the training spec's Gear & Equipment section.
// Checked state persists in state.equipmentChecklist (storage.js) -- this
// list itself is the catalog, not per-item user data.
export const EQUIPMENT_ITEMS = [
  { id: 'injinji-socks', group: 'Shoes & Socks', name: 'Injinji toe socks', note: 'Separates toes, prevents bunion blisters, allows natural foot function.' },
  { id: 'slant-board', group: 'Recovery', name: 'Slant board (calf raise step)', note: 'Eccentric calf raises — non-negotiable daily achilles protocol.' },
  { id: 'lacrosse-ball', group: 'Recovery', name: 'Lacrosse ball (natural rubber)', note: 'Daily foot rolling, hip and glute release.' },
  { id: 'foam-roller', group: 'Recovery', name: 'Foam roller (full length)', note: 'Thoracic spine before runs, IT band, calf, hip flexor.' },
  { id: 'correct-toes', group: 'Recovery', name: 'Correct Toes spacers', note: 'Daily toe realignment, bunion management. Order from correcttoes.com.' },
  { id: 'resistance-bands', group: 'Recovery', name: 'Resistance bands (loop set)', note: 'Hip abduction, clamshells, lateral walks, glute activation.' },
  { id: 'dumbbells', group: 'Recovery', name: 'Light dumbbells (5–10 lb pair)', note: 'Single-leg RDLs, Bulgarian split squats, hip work.' },
  { id: 'yoga-mat', group: 'Recovery', name: 'Yoga mat (natural rubber)', note: 'Daily mobility + Yoga Nidra. No PVC.' },
  { id: 'yoga-blocks', group: 'Recovery', name: 'Yoga blocks (cork, set of 2)', note: '90/90, pigeon pose, hip flexor work.' },
  { id: 'massage-gun', group: 'Recovery', name: 'Massage gun', note: 'Post-run calf and glute recovery, achilles area.' },
  { id: 'compression-socks', group: 'Recovery', name: 'Compression socks (knee high)', note: 'After long runs and on travel days (Honolulu flights).' },
  { id: 'epsom-salts', group: 'Recovery', name: 'Epsom salts (large bag)', note: 'Post-run foot soaks and full baths. Transdermal magnesium.' },
  { id: 'ice-packs', group: 'Recovery', name: 'Reusable gel ice packs', note: 'Targeted icing if achilles or right foot is hot/swollen.' },
  { id: 'wedge-pillow', group: 'Recovery', name: 'Leg elevation wedge pillow', note: 'Post-run lymph drainage and hip decompression nightly.' },
  { id: 'mouth-tape', group: 'Accessories', name: 'Mouth tape (Hostage Tape)', note: 'Nightly use. Nasal breathing conversion.' },
  { id: 'nasal-saline', group: 'Accessories', name: 'Nasal saline rinse (NeilMed)', note: 'Keeps nasal passages clear for nasal breathing training.' },
  { id: 'nasal-strips', group: 'Accessories', name: 'Nasal dilator strips', note: 'High-intensity runs during nasal breathing adaptation.' },
  { id: 'hydration-vest', group: 'Accessories', name: 'Running hydration vest', note: 'Needed from Phase 3 onward (runs over 90 min).' },
  { id: 'running-hat', group: 'Accessories', name: 'Lightweight vented running hat', note: 'Sun protection for training and race day.' },
  { id: 'moisture-kit', group: 'Accessories', name: 'Bamboo / moisture-wicking running kit', note: 'Anti-chafe, seamless. Matters after 16km+.' },
  { id: 'body-glide', group: 'Accessories', name: 'Body Glide anti-chafe balm', note: 'Vegan formula. Thighs, underarms, sports bra line, toes.' },
];

export const CYCLE_DATA = {
  menstrual: { label: 'Menstrual', color: 'var(--coral)', soft: 'var(--coral-soft)', length: '"Winter" · days 1–5', note: '"Winter" — rest, iron-rich foods, gentle movement.', groups: [
    { name: 'Veggies', items: 'Kale, beets, mushrooms, sea veggies, sweet potato, root veggies' },
    { name: 'Fruits', items: 'Dark berries, concord grapes, watermelon' },
    { name: 'Grains', items: 'Buckwheat, wild rice' },
    { name: 'Protein', items: 'Kidney beans, sardines, grass-fed red meat, shellfish' },
    { name: 'Extras', items: 'Miso, sea salt, trace minerals, dark chocolate' },
  ] },
  follicular: { label: 'Follicular', color: 'var(--teal)', soft: 'var(--teal-soft)', length: '"Spring" · days 6–13', note: '"Spring" — rising energy, good for harder sessions.', groups: [
    { name: 'Veggies', items: 'Artichokes, broccoli, carrots, lettuces, zucchini' },
    { name: 'Fruits', items: 'Avocado, citrus, pomegranate, plum' },
    { name: 'Grains', items: 'Oats, barley, rye' },
    { name: 'Protein', items: 'Lentils, eggs, poultry, trout, shellfish' },
    { name: 'Extras', items: 'Nut butter, olives, sauerkraut, kimchi' },
  ] },
  ovulatory: { label: 'Ovulatory', color: 'var(--phase4)', soft: 'rgba(255,92,52,0.14)', length: '"Summer" · days 14–16', note: '"Summer" — peak energy, best window for PRs.', groups: [
    { name: 'Veggies', items: 'Brussels sprouts, bell pepper, asparagus, spinach' },
    { name: 'Fruits', items: 'Coconut, fig, strawberry, cantaloupe' },
    { name: 'Grains', items: 'Quinoa, amaranth' },
    { name: 'Protein', items: 'Wild-caught salmon, eggs, tuna, shrimp, lamb' },
    { name: 'Extras', items: 'Dark chocolate, maca, kimchi, sauerkraut' },
  ] },
  luteal: { label: 'Luteal', color: 'var(--phase3)', soft: 'rgba(122,63,91,0.14)', length: '"Fall" · days 17–28', note: '"Fall" — energy tapering, prioritize recovery.', groups: [
    { name: 'Veggies', items: 'Cabbage, cauliflower, celery, sweet potato, squash' },
    { name: 'Fruits', items: 'Apple, date, peach, pear' },
    { name: 'Grains', items: 'Brown rice, millet' },
    { name: 'Protein', items: 'Chickpea, navy bean, turkey, cod, grass-fed beef' },
    { name: 'Extras', items: 'Dark chocolate, peppermint tea, magnesium' },
  ] },
};

export function cyclePhaseForDay(day) {
  if (day <= 5) return { id: 'menstrual', ...CYCLE_DATA.menstrual };
  if (day <= 13) return { id: 'follicular', ...CYCLE_DATA.follicular };
  if (day <= 16) return { id: 'ovulatory', ...CYCLE_DATA.ovulatory };
  return { id: 'luteal', ...CYCLE_DATA.luteal };
}

export const SESSION_ICONS = [
  ['Long', 'ti ti-route'], ['Tempo', 'ti ti-gauge'], ['Race-Pace', 'ti ti-gauge'], ['Strength', 'ti ti-barbell'],
  ['Mobility', 'ti ti-stretching'], ['Recovery', 'ti ti-battery-2'], ['Rest', 'ti ti-moon'], ['Cross', 'ti ti-swimming'],
  ['Swim', 'ti ti-swimming'], ['Yoga', 'ti ti-yoga'], ['RACE', 'ti ti-flag-2'],
];
export function iconFor(type) {
  return (SESSION_ICONS.find(([k]) => type.includes(k)) || ['', 'ti ti-run'])[1];
}
