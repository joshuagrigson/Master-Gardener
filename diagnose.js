/* diagnose.js — what to photograph on a plant, what to tag when you see it,
   and a rule-based health read from crop + stage + symptoms + recent weather.
   These are field heuristics, not a diagnosis: every finding says what to check next. */

/* The six shots that actually carry diagnostic information. */
window.SHOT_PARTS = [
  { key: 'whole', label: 'Whole plant', emoji: '🪴', how: 'Stand back about 3 ft and get the entire plant with some soil around it. Shows habit, wilting, spacing and which side is suffering.' },
  { key: 'leaf-top', label: 'Leaf top', emoji: '🍃', how: 'Fill the frame with one or two leaves. Spots, mottling, yellowing patterns and vein colour all live here.' },
  { key: 'leaf-under', label: 'Leaf underside', emoji: '🔄', how: 'Flip a leaf over. Aphids, mites, whitefly, eggs and true powdery mildew hide underneath. This is the shot people skip and the one that answers the most questions.' },
  { key: 'stem', label: 'Stem base', emoji: '🌿', how: 'Get down at the soil line. Borer frass, sawdust, holes, cankers, rot and girdling show here first.' },
  { key: 'fruit', label: 'Fruit or head', emoji: '🍅', how: 'Close on the fruit, including its blossom end. Blossom-end rot, cracks, sunscald and bite marks are all fruit-side tells.' },
  { key: 'soil', label: 'Soil & mulch', emoji: '🟤', how: 'Frame the soil surface beside the stem. Shows crusting, mulch depth, standing water, salt crust and surface insects.' },
];

window.CAPTURE_TIPS = [
  'Shoot in open shade or on an overcast day. Direct sun blows out exactly the detail that matters.',
  'Get close enough that the problem fills a third of the frame, then tap to focus on it.',
  'Put a finger or a coin beside small spots so size is readable later.',
  'Take the healthy version of the same leaf too. A comparison shot is worth two problem shots.',
];

/* Tag what you can see. Keys are stored on the shot. */
window.SYMPTOMS = [
  { key: 'yellow-lower', label: 'Yellowing lower leaves', emoji: '🍂', group: 'leaf' },
  { key: 'yellow-new', label: 'Pale new growth', emoji: '🌱', group: 'leaf' },
  { key: 'spots-dark', label: 'Dark spots or rings', emoji: '🔘', group: 'leaf' },
  { key: 'spots-yellow', label: 'Yellow blotches / mottling', emoji: '🟡', group: 'leaf' },
  { key: 'white-powder', label: 'White powdery coating', emoji: '🤍', group: 'leaf' },
  { key: 'holes', label: 'Holes or chewed edges', emoji: '🕳️', group: 'leaf' },
  { key: 'curling', label: 'Curling or cupping', emoji: '🌀', group: 'leaf' },
  { key: 'sticky', label: 'Sticky, sooty or ants', emoji: '🐜', group: 'leaf' },
  { key: 'bugs', label: 'Insects visible', emoji: '🐛', group: 'leaf' },
  { key: 'webbing', label: 'Fine webbing / stippling', emoji: '🕸️', group: 'leaf' },
  { key: 'wilting', label: 'Wilting', emoji: '🥀', group: 'whole' },
  { key: 'stunted', label: 'Stunted or not growing', emoji: '📉', group: 'whole' },
  { key: 'leggy', label: 'Leggy and stretched', emoji: '📏', group: 'whole' },
  { key: 'frass', label: 'Sawdust / frass at the base', emoji: '🪵', group: 'stem' },
  { key: 'stem-damage', label: 'Split, canker or soft stem', emoji: '💔', group: 'stem' },
  { key: 'blossom-drop', label: 'Flowers dropping', emoji: '🌸', group: 'fruit' },
  { key: 'no-fruit', label: 'Flowers but no fruit', emoji: '🚫', group: 'fruit' },
  { key: 'end-rot', label: 'Dark sunken fruit bottom', emoji: '⚫', group: 'fruit' },
  { key: 'cracking', label: 'Cracked or split fruit', emoji: '🪓', group: 'fruit' },
  { key: 'sunscald', label: 'Pale papery patch on fruit', emoji: '☀️', group: 'fruit' },
  { key: 'bite-marks', label: 'Animal or bug damage on fruit', emoji: '🐿️', group: 'fruit' },
  { key: 'dry-soil', label: 'Soil dry or cracked', emoji: '🏜️', group: 'soil' },
  { key: 'wet-soil', label: 'Soil soggy or standing water', emoji: '💧', group: 'soil' },
  { key: 'crust', label: 'Crusted or white surface', emoji: '🧂', group: 'soil' },
];
window.symptomByKey = k => window.SYMPTOMS.find(s => s.key === k) || { key: k, label: k, emoji: '•', group: 'leaf' };

/* diagnose({ symptoms, crop, st, wx }) -> [{ sev, title, why, todo:[] }] most serious first.
   crop = the CROPS entry, st = statsFor() result, wx = { hot, cold, dry, wet } booleans (any may be undefined). */
window.diagnose = function diagnose({ symptoms = [], crop, st, wx = {} }) {
  const has = (...k) => k.some(x => symptoms.includes(x));
  const group = crop ? crop.group : 'other';
  const isCucurbit = group === 'cucurbit';
  const isNightshade = group === 'tomato' || group === 'pepper';
  const isBrassica = group === 'brassica';
  const isLeafy = group === 'leafy';
  const isRoot = group === 'root';
  const fruiting = crop && crop.stages === 'fruit';
  const out = [];
  const add = (sev, title, why, todo) => out.push({ sev, title, why, todo });

  /* --- stem / whole plant, most urgent first --- */
  if (has('frass')) add('critical', 'Squash vine borer or stem borer',
    'Sawdust-like frass at the soil line is the borer signature, not a symptom of anything else. The larva is already inside the stem.',
    ['Slit the stem lengthwise above the hole with a razor, pull the grub out, then bury that section under moist soil so it re-roots.',
      'Mound soil over the lower stem nodes on every other plant as insurance.',
      'Spinosad or Bt drench at the crown every 7-10 days while the moths are flying.']);

  if (has('wilting') && has('frass')) { /* covered above */ }
  else if (has('wilting') && has('wet-soil')) add('serious', 'Wilting in wet soil means roots, not thirst',
    'A plant wilting while the soil is soggy is drowning or has root rot. Watering more makes it worse.',
    ['Stop watering until the top 2 in dry out.', 'Check for a low spot or a clogged bed edge holding water.', 'If the stem is soft and brown at the soil line, pull the plant; that bed cell needs a break from that family.']);
  else if (has('wilting') && has('dry-soil')) add('warn', 'Simple drought stress',
    'Wilting plus dry soil is the ordinary case, especially in Texas heat.',
    ['Water deeply and slowly at the base rather than briefly every day.', 'Mulch over moist soil to hold it. Mulch over dry soil sheds light rain instead.', 'Afternoon wilt that recovers by morning is heat, not a watering failure.']);
  else if (has('wilting') && isCucurbit) add('serious', 'Check for borer or bacterial wilt',
    'A squash that wilts with moist soil is usually a borer or bacterial wilt carried by cucumber beetles.',
    ['Inspect the stem base for holes and frass first.', 'Cut a wilted stem and touch the cut ends together; if they string out when pulled apart, it is bacterial wilt and the plant will not recover.', 'Control cucumber beetles on the remaining plants.']);
  else if (has('wilting')) add('warn', 'Wilting, cause not pinned down',
    'Wilting is the most ambiguous symptom there is. Soil moisture splits the diagnosis.',
    ['Push a finger 2 in into the soil and photograph what you find.', 'Check the stem base for damage.', 'Note the time of day; midday wilt that recovers overnight is usually just heat.']);

  if (has('stem-damage')) add('serious', 'Damaged stem',
    'A split, sunken or soft stem interrupts the plant\'s plumbing and lets disease in.',
    ['Soft and brown at the soil line is rot: reduce water, improve drainage.', 'A clean split from fast growth or wind can be supported and will callus over.', 'Sunken dark cankers on tomato are worth removing the affected stem for.']);

  /* --- leaves --- */
  if (has('white-powder')) add(isCucurbit && st && st.progress > 0.7 ? 'warn' : 'serious', 'Powdery mildew',
    'A white coating that rubs off like flour is powdery mildew. On squash late in the season it is nearly inevitable and often survivable.',
    ['Remove the worst leaves and bag them, do not compost.', 'Improve airflow; water the soil, not the leaves.', 'Potassium bicarbonate or a 1:9 milk-water spray on a cloudy morning slows it.',
      isCucurbit ? 'If the plant has already carried a full crop, let it finish rather than fighting it.' : 'Keep new growth clean; it spreads fastest on young leaves.']);

  if (has('spots-dark') && isNightshade) add('serious', 'Likely early blight',
    'Dark spots with concentric rings on the lower leaves of a tomato, moving upward, is the classic early blight pattern.',
    ['Remove affected leaves as you see them; never work the plants wet.', 'Mulch heavily. The spores live in the soil and splash up.', 'Keep the lowest 12 in of stem clear of leaves.', 'Rotate nightshades out of this bed next season.']);
  else if (has('spots-dark')) add('warn', 'Leaf spot of some kind',
    'Dark spots are usually fungal or bacterial, and most respond to the same handling.',
    ['Remove and bag the worst leaves.', 'Water at the base, in the morning.', 'Photograph the leaf underside too; that often separates fungal from bacterial.']);

  if (has('webbing')) add('serious', 'Spider mites',
    'Fine webbing with tiny pale stipples is spider mites, and they explode in hot dry weather.',
    ['Spray the leaf undersides hard with water every couple of days; they hate humidity.', 'Insecticidal soap or neem, undersides first.', 'They ride on your hands. Work infested plants last.']);

  if (has('sticky') || (has('bugs') && has('curling'))) add('warn', 'Aphids',
    'Sticky honeydew, sooty black film or ants running the stems all point to aphids feeding underneath the leaves.',
    ['Blast them off with water for three days running.', 'Insecticidal soap on the undersides if they persist.', 'Ants farm them; a sticky band on woody stems helps.', 'Nasturtiums nearby work as a trap crop.']);
  else if (has('bugs')) add('warn', 'Insects present, identify before spraying',
    'Most bugs in a garden are neutral or helpful. Spraying blind costs you the predators.',
    ['Photograph the insect large enough to count legs and see wings.', 'Check the leaf undersides for eggs.', 'Hand-pick anything large; it is faster than any spray.']);

  if (has('holes') && isBrassica) add('warn', 'Cabbage worms',
    'Ragged holes in broccoli, cabbage or collards almost always mean imported cabbage worm or looper, laid by the little white butterflies.',
    ['Bt (Bacillus thuringiensis) every 7-10 days; it only affects caterpillars.', 'Look along the midrib underside for green caterpillars and eggs.', 'Row cover until heading stops the butterflies laying at all.']);
  else if (has('holes')) add('good', 'Chewing damage, usually cosmetic',
    'Small shot-hole damage on pepper and eggplant leaves is typically flea beetles, and an established plant outgrows it.',
    ['No treatment needed on healthy plants with holes on under 20% of the leaf area.', 'Seedlings are the exception; protect those with row cover.', 'Slugs leave slime trails and ragged night damage; bait or hand-pick at dusk.']);

  if (has('yellow-lower') && !has('spots-dark')) add('warn', 'Yellow lower leaves',
    'The oldest leaves yellowing first usually means nitrogen moving to new growth, or simply age, or roots sitting wet.',
    ['A balanced feed helps if new growth is also pale.', 'One or two yellow leaves at the very bottom of a mature plant is normal; pull them off.', 'If the soil is soggy, fix drainage before feeding.']);
  if (has('yellow-new')) add('warn', 'Pale new growth',
    'Yellow at the top while lower leaves stay green points to iron or a pH that is locking it out, or cold wet roots.',
    ['Check that the bed drains and has warmed up.', 'Chelated iron gives a fast answer; if it greens up in a week, that was it.', 'Blueberries want acid soil and yellow this way when the pH drifts up.']);
  if (has('spots-yellow')) add('warn', 'Mottling or yellow blotches',
    'Blotchy mosaic patterns can be a virus, magnesium shortage, or mite feeding.',
    ['Check the undersides for mites first; that is the cheapest explanation.', 'Epsom salt foliar spray tests the magnesium theory.', 'A plant with distorted, mosaic-patterned new growth is best pulled before it spreads; wash your hands after.']);
  if (has('curling') && !has('sticky')) add('warn', 'Curling leaves',
    'Tomato leaves rolling upward in heat is a stress response and not a disease. Twisted, strappy new growth is a different and more serious sign.',
    ['Heat and wind curl is cosmetic; keep water even.', 'Distorted new growth across several plants can be herbicide drift; think about anything sprayed nearby or hay mulch.', 'Check undersides for aphids.']);

  /* --- fruiting --- */
  if (has('blossom-drop') || has('no-fruit')) {
    if (wx.hot && fruiting) add('warn', 'Heat is dropping the blossoms',
      'Above about 90°F tomato and pepper pollen goes sterile and the plant sheds flowers. Your forecast has that heat in it.',
      ['Nothing to fix. It resumes when nights drop back below the mid 70s.', 'Keep water even so the plant holds its leaves for the next flush.', 'Shade cloth over the hottest hours helps if it drags on.']);
    else if (has('no-fruit') && isCucurbit) add('warn', 'Pollination, not health',
      'Squash and melons carry separate male and female flowers. Tiny fruit that yellows and drops means the female never got pollinated.',
      ['Hand-pollinate in the morning: pick a male flower, strip the petals, dust the female stigma.', 'The female is the one with a miniature fruit behind the bloom.', 'First flush is often all male; that is normal.']);
    else add('warn', 'Flowers dropping without setting',
      'Usually heat, sometimes water swings or too much nitrogen.',
      ['Keep soil moisture steady.', 'Stop high-nitrogen feeding; it pushes leaves over fruit.', 'Tap or shake tomato flowers midday to help them self-pollinate.']);
  }
  if (has('end-rot')) add('serious', 'Blossom-end rot',
    'A dark sunken patch on the bottom of the fruit is calcium failing to reach it, which is nearly always a watering problem rather than a soil shortage.',
    ['Even, deep watering is the actual fix. Mulch to buffer the swings.', 'Pick the affected fruit; it will not recover.', 'Skip the calcium spray unless a soil test says you are short.', 'Usually hits the first flush and clears by the next.']);
  if (has('cracking')) add('warn', 'Cracking or splitting fruit',
    'A dry spell followed by heavy water makes fruit swell faster than its skin.',
    ['Water on a steadier schedule; mulch buffers rain swings.', 'Pick ripening fruit before a big rain.', 'Cracked fruit is fine to eat right away, but will not store.']);
  if (has('sunscald')) add('warn', 'Sunscald',
    'A pale papery patch on the sun side means the fruit lost its leaf cover.',
    ['Do not strip any more leaves; the canopy is the sunscreen.', 'Shade cloth over exposed clusters during a heat wave.', 'Over-pruning is the usual cause.']);
  if (has('bite-marks')) add('warn', 'Something is eating the fruit',
    'Clean scoops usually mean birds or squirrels; big ragged bites at night mean rodents; a hollowed fruit with frass means a worm went in.',
    ['Netting is the only reliable answer for birds and squirrels.', 'Pick at first blush and finish ripening indoors.', 'Tomato fruitworm holes at the stem end respond to Bt while the caterpillars are small.']);

  /* --- soil & habit --- */
  if (has('crust')) add('warn', 'Crusted or white soil surface',
    'A white crust is usually salt from fertilizer or hard water; a hard crust sheds water before it soaks in.',
    ['Break the crust gently and mulch.', 'Water deeply to leach salts through.', 'Ease off soluble fertilizer for a few weeks.']);
  if (has('dry-soil') && !has('wilting')) add('warn', 'Soil drying out faster than you are watering',
    'Catching this before the plant wilts is the whole point of checking.',
    ['Water deeply and less often so the roots follow the moisture down.', 'Mulch after watering, never before.']);
  if (has('leggy')) add(crop && crop.key === 'pepper' ? 'warn' : 'good', 'Stretched growth',
    'Long internodes and a floppy habit mean the plant is reaching for light.',
    ['Under 6 hours of direct sun is the usual cause.', 'On peppers, topping the growing tip forces branching; take only the top 2-4 in, cut 1/4 in above a full node.', 'Seedlings indoors need the light within a few inches of the leaves.']);
  if (has('stunted')) add('warn', 'Stalled growth',
    'A plant that simply is not moving is usually root-bound, cold, hungry or in competition.',
    ['Check for weeds or clover crowding the stem.', 'Cool soil stalls warm-season crops; they catch up.', 'Root-knot nematodes leave knobby galls on the roots; lift a struggling plant and look.']);

  /* weather overlays that matter regardless of what was tagged */
  if (wx.cold && crop && crop.base >= 50 && st && !st.perennial) add('serious', 'Cold is coming for a tender crop',
    'Your forecast has lows at or under 36°F and this crop has no frost tolerance.',
    ['Cover overnight or harvest what is close.', 'Row cover, a sheet, even a box works. Plastic touching leaves does not.']);

  const rank = { critical: 0, serious: 1, warn: 2, good: 3 };
  return out.sort((a, b) => rank[a.sev] - rank[b.sev]);
};
