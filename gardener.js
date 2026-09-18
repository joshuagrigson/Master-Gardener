/* gardener.js — the Master Gardener. Reads any plant from what the app already knows
   (crop, variety, stage, day count, heat units, weather, check-ins, close-ups, bed history)
   and gives the same shape of answer the Master Gardener project has always given:
   what it is doing right now, what to do this week, what to watch for, and the timing note.
   Symptom tags sharpen it; nothing here requires them.

   Zone 8a, northeast Texas by default. Durable facts carried over from the garden's own history. */

/* ---------- what the plant is doing at this point in its life ---------- */
const PHYS = {
  fruit: [
    [0.15, 'Rooting in. Top growth looks slow on purpose — the plant is spending everything below ground.'],
    [0.45, 'Building the frame. Every leaf it makes now sets the ceiling on how much fruit it can carry later.'],
    [0.65, 'Switching over. Flower buds are forming in the growing tips while the frame finishes filling out.'],
    [0.85, 'Setting fruit. Pollen is moving and the first fruits are sizing; this is the stage heat interferes with.'],
    [1.0, 'Sizing and colouring. Sugars are moving into the fruit and the plant is running on stored leaf area.'],
    [1.3, 'In its harvest window. Picking regularly is what keeps it producing.'],
    [Infinity, 'Past its window. Production tails off and quality drops; the plant is deciding whether to keep going.'],
  ],
  leafy: [
    [0.25, 'Germinating and rooting. Keep the surface from crusting or the stand goes patchy.'],
    [0.6, 'Leafing out. Growth is exponential now if water and nitrogen hold.'],
    [0.85, 'Baby-leaf size. You can start cutting outer leaves without slowing it down.'],
    [1.0, 'Full size. The clock is now running toward bolting rather than more leaf.'],
    [1.4, 'Harvest window. Cut-and-come-again keeps it productive.'],
    [Infinity, 'Bolting risk is high. Once the centre elongates the leaves turn bitter for good.'],
  ],
  root: [
    [0.2, 'Germinating. Roots are fragile and the seedbed must stay evenly moist.'],
    [0.55, 'Top growth. The leaves are building the sugar that the root will store later.'],
    [0.85, 'Bulking. The root is swelling fast; this is when steady moisture matters most.'],
    [1.0, 'Finishing. Size is nearly there and texture is at its best.'],
    [1.4, 'Ready. Pull as you need them.'],
    [Infinity, 'Over-mature. Roots go woody, split or hot once they sit too long.'],
  ],
  head: [
    [0.2, 'Establishing after transplant. Roots first, leaves after.'],
    [0.6, 'Vegetative. It is stacking the leaf count it needs before a head can form.'],
    [0.9, 'Heading. The centre is initiating; cool weather here decides head quality.'],
    [1.0, 'Head forming. Cut while the buds are still tight.'],
    [1.25, 'Harvest window. Take the main head and side shoots follow for weeks.'],
    [Infinity, 'Buds are opening. Flavour drops fast once it starts to flower.'],
  ],
  flower: [
    [0.2, 'Establishing.'], [0.6, 'Vegetative growth.'], [0.9, 'Budding up.'],
    [1.3, 'Blooming. Deadheading keeps it going.'], [Infinity, 'Setting seed. Let some drop if you want volunteers.'],
  ],
  perennial: [[Infinity, 'Perennial. It is working on next season as much as this one.']],
};
const physFor = (crop, st) => {
  const list = PHYS[crop.stages] || PHYS.fruit;
  if (crop.stages === 'perennial' || !st || st.progress == null) return list[list.length - 1][1];
  return (list.find(([t]) => st.progress < t) || list[list.length - 1])[1];
};

/* ---------- durable garden facts, carried from this garden's own history ---------- */
window.GARDENER_PRINCIPLES = [
  'Water deeply first, then mulch over moist soil. Mulch seals in what is already there; a dry mulch layer sheds light rain before it reaches the roots.',
  'Deep and infrequent beats shallow and daily. Shallow water grows shallow roots.',
  'Above about 90°F tomatoes and peppers drop blossoms. That is heat, not a deficiency, and it fixes itself when the nights cool.',
  'Never put a nightshade in the same bed two years running, and keep potatoes out of the tomato bed entirely.',
];

/* ---------- this week's work, by crop and stage ---------- */
function tasksFor(crop, st, ctx) {
  const t = [];
  const g = crop.group, key = crop.key, pr = st.progress;
  const hot = ctx.wx && ctx.wx.hot, cold = ctx.wx && ctx.wx.cold, dry = ctx.wx && ctx.wx.dry;
  const add = (pri, text) => t.push({ pri, text });

  if (g === 'tomato' && !st.perennial) {
    if (pr >= 0.3 && pr < 0.75) add(1, 'Stake or cage it now if you have not: 5-6 ft stakes, loose ties every 8-12 in. Do it before fruit weight and summer storms, not after.');
    if (pr >= 0.35 && pr < 0.9) add(3, 'Light-prune the lowest leaves so nothing touches the soil. Blight splashes up from below.');
    if (pr >= 0.4 && pr < 0.8) add(4, 'Suckers are optional. Pinch small ones if you want airflow; leave woody flowering leaders, trusses and any self-rooted stems.');
    if (pr >= 0.75) add(2, 'Pick at first blush and finish ripening on the counter. It beats the birds and the splitting, and the plant puts the energy into the next truss.');
    if (pr >= 0.6 && hot) add(2, 'Blossom drop this week is the heat. Keep water even so the plant holds its leaves for the flush that follows.');
  }
  if (g === 'pepper' && !st.perennial) {
    if (pr < 0.5) add(2, 'Shape it once, early: pinch the central king bud on a small stocky plant, or top the growing tip on a tall leggy one. Cut about 1/4 in above the first full node and take only the top 2-4 in.');
    if (pr < 0.6) add(4, 'Leggy usually means under 6 hours of direct sun, not a feeding problem.');
    add(5, 'Keep clover and mulch pulled back a few inches from the stems.');
    if (pr >= 0.7) add(2, 'Pick the first few peppers small. Early picking pushes the plant into a heavier second set.');
    if (cold) add(1, 'Peppers do not take frost. Strip the plant before the first hard night; they finish fine indoors.');
  }
  if (g === 'cucurbit') {
    add(2, 'Check the stem base for sawdust frass every few days. The borer is the thing that kills a healthy squash overnight.');
    if (pr >= 0.4) add(3, 'White speckling on the TOP of the leaves is this plant\'s natural variegation, not mildew. Turn a leaf over before you treat anything.');
    if (pr >= 0.5) add(3, 'If small fruit yellows and drops, hand-pollinate in the morning: a male flower, petals stripped, dusted on the female stigma.');
    if (pr >= 0.6) add(2, 'Pick young and pick often. One marrow left on the vine shuts down the whole plant.');
  }
  if (g === 'brassica') {
    if (pr >= 0.3) add(2, 'Check leaf undersides along the midrib for cabbage worm eggs. Bt every 7-10 days handles them and nothing else.');
    if (pr >= 0.85) add(1, 'Cut the main head while the buds are still tight. Side shoots keep coming for weeks after.');
  }
  if (g === 'leafy') {
    if (pr >= 0.6) add(2, 'Cut outer leaves and leave the centre. It keeps producing for weeks instead of finishing at once.');
    if (hot) add(2, 'Heat pushes these to bolt. Harvest ahead of a hot spell rather than after it.');
  }
  if (g === 'root') {
    if (pr < 0.3) add(2, 'Keep the seedbed surface damp through germination. A crust is what turns a good sowing into a patchy row.');
    if (pr >= 0.3 && pr < 0.6) add(3, 'Thin to spacing now. Crowded roots stay small no matter how well you feed them.');
    if (pr >= 0.7) add(3, 'Steady water from here. Dry then soaked is what splits roots.');
    if (key === 'potato' && pr >= 0.3 && pr < 0.8) add(2, 'Hill soil up the stems as they grow so no tuber sees daylight.');
  }
  if (g === 'berry' || st.perennial) {
    if (key === 'blackberry' || key === 'raspberry') add(3, 'Cut the canes that fruited this year right to the ground and keep this year\'s new canes. They are next year\'s crop.');
    if (key === 'venus-flytrap') { add(2, 'Distilled, rain or RO water only, in the tray. Tap water will kill it.'); add(3, 'Morning sun only in Texas heat. A single black lower leaf is normal — trim it at the base.'); }
    if (key === 'blueberry') add(3, 'Keep the soil acid, pH 4.5 to 5.5. Yellow leaves with green veins here mean the pH has drifted up.');
    if (key === 'asparagus') add(4, 'No harvest in year one, light in year two, full from year three. Let the ferns stand until they brown.');
  }
  if (dry) add(1, 'Water deeply this week, then mulch over the moist soil. Not the other way round.');
  if (st.left != null && st.left <= 7 && st.left > 0) add(1, `First harvest is about ${st.left} day${st.left === 1 ? '' : 's'} out. Have somewhere to put it.`);
  if (st.progress != null && st.progress >= 1.3) add(1, 'This one is past its window. Decide: keep picking, or pull it and give the space to a fall crop.');
  return t.sort((a, b) => a.pri - b.pri).map(x => x.text);
}

/* ---------- what to watch for at this stage ---------- */
function watchFor(crop, st, ctx) {
  const w = [], g = crop.group, pr = st.progress;
  if (g === 'tomato') { w.push('Dark ringed spots low on the plant moving upward — early blight.'); if (pr >= 0.7) w.push('A dark sunken patch on the fruit bottom means water swings, not a calcium shortage.'); }
  if (g === 'pepper') w.push('Small shot-holes in the leaves are flea beetles and are cosmetic on an established plant.');
  if (g === 'cucurbit') { w.push('Sudden wilt with moist soil: check the stem base before you blame the watering.'); w.push('True powdery mildew lives on the leaf underside.'); }
  if (g === 'brassica') w.push('Ragged holes and green caterpillars along the midrib.');
  if (g === 'leafy') w.push('A centre that starts to elongate is the bolt beginning. Flavour goes within days.');
  if (g === 'root') w.push('Shoulders pushing out of the soil — cover them or they turn green and bitter.');
  if (ctx.wx && ctx.wx.cold && crop.base >= 50 && !st.perennial) w.push('Lows at or under 36°F are in the forecast and this crop has no frost tolerance.');
  if (ctx.wx && ctx.wx.hot && crop.stages === 'fruit') w.push('Highs at or above 90°F: expect flowers to drop until it breaks.');
  if (st.sinceLog != null && st.sinceLog >= 14) w.push(`No check-in for ${st.sinceLog} days. A quick rating and a close-up is how this stays useful.`);
  return w;
}

/* ---------- the headline verdict ---------- */
function headline(crop, st, ctx) {
  const name = crop.name.toLowerCase();
  if (st.perennial) return { sev: 'good', text: `Established ${name}, year ${Math.floor(st.days / 365) + 1}. Judge it by the season, not a day count.` };
  const pr = st.progress;
  if (pr >= 1.3) return { sev: 'serious', text: `Past its window by ${st.days - st.dtm} days. Quality is falling; decide whether to keep it.` };
  if (pr >= 1.0) return { sev: 'good', text: `In the harvest window since ${st.eta ? ctx.fmtDate(st.eta) : 'recently'}. Pick regularly and it keeps going.` };
  if (pr >= 0.85) return { sev: 'good', text: `Day ${st.days} of ${st.dtm}. Finishing — first pick around ${ctx.fmtDate(st.eta)}.` };
  if (pr >= 0.65) return { sev: 'good', text: `Day ${st.days} of ${st.dtm}. Setting fruit; harvest about ${ctx.fmtDate(st.eta)}.` };
  if (pr >= 0.45) return { sev: 'good', text: `Day ${st.days} of ${st.dtm}. Coming into flower. On schedule.` };
  if (pr >= 0.15) return { sev: 'good', text: `Day ${st.days} of ${st.dtm}. Building its frame. This is the stage that decides the yield.` };
  return { sev: 'good', text: `Day ${st.days} of ${st.dtm}. Settling in. Slow top growth now is normal.` };
}

/* ---------- the full read on one plant ---------- */
window.gardenerRead = function gardenerRead(ctx) {
  const { crop, st } = ctx;
  const h = headline(crop, st, ctx);
  const out = {
    headline: h.text, sev: h.sev,
    doing: physFor(crop, st),
    tasks: tasksFor(crop, st, ctx),
    watch: watchFor(crop, st, ctx),
    timing: [],
    heat: null,
  };
  /* heat units, when the history covers enough of the season to mean anything */
  if (ctx.gdd && ctx.gdd.covered >= 14) {
    const band = crop.gdd;
    let line = `${ctx.gdd.gdd} growing degree days accumulated since planting, base ${crop.base}°F.`;
    if (band) {
      const pct = Math.round((ctx.gdd.gdd / band[0]) * 100);
      line += ` This crop typically needs ${band[0]}–${band[1]} to first harvest, so it has banked about ${pct}% of the low end.`;
      if (st.progress != null && pct < st.progress * 100 - 20) line += ' It is running behind the calendar because the season has been cool.';
      else if (st.progress != null && pct > st.progress * 100 + 20) line += ' The heat has pushed it ahead of the calendar; check it early.';
    }
    out.heat = line;
  }
  /* season and rotation */
  if (ctx.daysToFrost != null && !st.perennial) {
    if (st.left != null && st.left > ctx.daysToFrost && crop.base >= 50) out.timing.push(`First frost is about ${ctx.daysToFrost} days out and this needs roughly ${st.left} more. It will not finish outdoors — plan to cover it or harvest early.`);
    else if (ctx.daysToFrost <= 21 && crop.base >= 50) out.timing.push(`About ${ctx.daysToFrost} days to the average first frost. Have a cover ready or plan the final pick.`);
  }
  if (ctx.rotationWarning) out.timing.push(ctx.rotationWarning);
  if (ctx.companion) out.timing.push(ctx.companion);
  return out;
};

/* ---------- what can still go in the ground ---------- */
window.plantingWindows = function plantingWindows(ctx) {
  const { crops, daysToFrost, daysToLastFrost, month } = ctx;
  const out = [];
  for (const crop of crops) {
    if (crop.key === 'custom' || crop.stages === 'perennial' || crop.indoor) continue;
    const dtm = crop.dtm + (crop.from === 'transplant' ? 0 : 0);
    const warm = crop.base >= 50;
    if (warm) {
      if (daysToFrost != null && dtm + 10 <= daysToFrost) out.push({ crop, note: `${dtm} days to harvest, about ${daysToFrost} until frost. It fits.`, fit: 'go' });
      else if (daysToFrost != null && dtm <= daysToFrost + 14) out.push({ crop, note: `${dtm} days needed against roughly ${daysToFrost} of season. Only with a cover.`, fit: 'tight' });
    } else {
      /* cool-season: the fall window here runs roughly August through October, spring runs February through March */
      if ([8, 9, 10].includes(month) || [2, 3].includes(month)) out.push({ crop, note: `${dtm} days. ${[8, 9, 10].includes(month) ? 'Fall window is open now.' : 'Spring window is open now.'}`, fit: 'go' });
      else if (month === 11 && crop.base <= 40) out.push({ crop, note: 'Hardy enough to overwinter if it goes in soon.', fit: 'tight' });
    }
  }
  const rank = { go: 0, tight: 1 };
  return out.sort((a, b) => rank[a.fit] - rank[b.fit] || a.crop.dtm - b.crop.dtm);
};

/* ---------- the whole-garden check ---------- */
window.gardenCheck = function gardenCheck(ctx) {
  const items = [];
  const add = (pri, sev, title, detail, link) => items.push({ pri, sev, title, detail, ...link });

  /* per plant, the single most important thing */
  for (const r of ctx.reads) {
    const { p, crop, st, read } = r;
    const where = `${crop.emoji} ${p.variety || crop.name} · ${r.bedName}`;
    const ready = st.left != null && st.left <= 0 && st.progress < 1.3;
    /* housekeeping reminders never outrank real garden work */
    const flag = r.flag && r.flag.kind === 'stale-log' ? null : r.flag;
    if (read.sev === 'serious' || read.sev === 'critical') add(1, read.sev, where, read.headline, { plantingId: p.id });
    else if (flag) add(flag.sev === 'critical' ? 1 : 2, flag.sev, where, flag.text, { plantingId: p.id, shotId: flag.shotId });
    else if (ready) add(2, 'good', where, 'Ready to pick. Keeping up with it is what keeps it producing.', { plantingId: p.id });
    else if (r.flag && r.flag.kind === 'stale-log') add(6, 'good', where, `${r.flag.text}. A rating and a close-up is what keeps the read sharp.`, { plantingId: p.id });
    else if (read.tasks.length && st.left != null && st.left <= 14) add(3, 'warn', where, read.tasks[0], { plantingId: p.id });
    else if (read.tasks.length) add(4, 'good', where, read.tasks[0], { plantingId: p.id });
  }

  /* garden-wide */
  if (ctx.water) add(ctx.water.sev === 'serious' ? 1 : 3, ctx.water.sev, 'Watering', ctx.water.text, {});
  if (ctx.daysToFrost != null) {
    if (ctx.daysToFrost <= 14) add(1, 'serious', 'Frost is close', `About ${ctx.daysToFrost} days to the average first frost. Pick what is close, cover what is tender, and let the hardy things take the cold — it sweetens them.`, {});
    else if (ctx.daysToFrost <= 45) add(3, 'warn', 'Season is closing', `About ${ctx.daysToFrost} days to the average first frost. Anything warm-season going in now needs a cover to finish.`, {});
  }
  if (ctx.emptyCells > 0 && ctx.windows.length) {
    const names = ctx.windows.slice(0, 4).map(w => w.crop.name.toLowerCase()).join(', ');
    add(4, 'good', 'Open ground', `${ctx.emptyCells} empty cell${ctx.emptyCells === 1 ? '' : 's'} across your beds. What fits the remaining season: ${names}.`, {});
  }
  for (const w of ctx.rotationWarnings) add(2, 'warn', 'Rotation', w, {});
  if (ctx.staleBeds.length) add(5, 'good', 'Photos', `No new photo in a month for ${ctx.staleBeds.join(', ')}. A fresh shot keeps the overlay honest.`, {});

  const rank = { critical: 0, serious: 1, warn: 2, good: 3 };
  items.sort((a, b) => a.pri - b.pri || rank[a.sev] - rank[b.sev]);
  const urgent = items.filter(i => i.pri === 1).length;
  const ready = ctx.reads.filter(r => r.st.left != null && r.st.left <= 0 && r.st.progress < 1.3).length;
  let summary;
  if (!ctx.reads.length) summary = 'Nothing planted yet. Tag what is in the ground and the check starts working.';
  else if (urgent) summary = `${urgent} thing${urgent === 1 ? '' : 's'} want${urgent === 1 ? 's' : ''} attention today${ready ? `, and ${ready} ${ready === 1 ? 'is' : 'are'} ready to pick` : ''}.`;
  else if (ready) summary = `Nothing urgent. ${ready} ${ready === 1 ? 'planting is' : 'plantings are'} ready to pick.`;
  else summary = 'Garden looks steady. Nothing needs you today.';
  return { summary, items };
};
