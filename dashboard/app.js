// Launch Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, the live-token set, the fitted model with its held-out validation, the peers'
// token record, and a detail view per protocol with its integrity flags, its costed farm plan and
// the verdict on that plan. No network: every byte it shows is in data.js, and the page recomputes
// every implied value from the printed fit with impliedOf below, the same function lib/model.ts
// runs, so what board.json carries and what the page shows cannot drift.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var M = DATA.model;
  var F = DATA.fit;
  var state = {
    view: 'board', q: '', category: 'all', verdict: 'all', watchlistOnly: false,
    sort: 'rank', dir: 1, selected: null,
  };
  var WATCH = {};
  DATA.watchlist.forEach(function (s) { WATCH[s] = true; });

  // ---------- formatting ----------
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + (Math.abs(n) >= 100 ? Math.round(n) : n.toFixed(1)) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days < 365) return days + 'd';
    return (days / 365).toFixed(1) + 'y';
  }
  function fmtMult(x) { return 'x' + x.toFixed(3); }
  function fmtX(x) { return 'x' + x.toFixed(1); }
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'class') node.className = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else node.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(function (c) { node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return node;
  }

  // ---------- the fitted model, restated in the page (the same function lib/model.ts runs) ----------
  function growthPctOf(row) {
    var g = row.change_7d === null ? 0 : row.change_7d;
    return Math.min(M.growth_cap, Math.max(M.growth_floor, g));
  }
  function ageUsedOf(row) { return row.age_days === null ? F.median_age_days : row.age_days; }
  function fitCategoryOf(category) {
    var key = category === null ? 'Uncategorised' : category;
    for (var i = 0; i < F.categories.length; i++) if (F.categories[i].category === key) return F.categories[i];
    return { category: key, peers: 0, median_multiple: null, adjustment: 1 };
  }
  function termsOf(row) {
    var ltv = Math.log(row.tvl_usd);
    var g = growthPctOf(row) / 100;
    var a = Math.min(ageUsedOf(row), M.age_cap_days) / M.age_cap_days;
    var c = Math.log(1 + row.chains.length);
    var adj = fitCategoryOf(row.category).adjustment;
    return {
      centre: Math.exp(F.intercept),
      size: Math.exp(F.log_tvl * (ltv - F.center_log_tvl)),
      growth: Math.exp(F.growth * g),
      age: Math.exp(F.age * a),
      chains: Math.exp(F.chains * c),
      adjustment: adj,
      growthPct: growthPctOf(row),
      ageUsed: ageUsedOf(row),
    };
  }
  function impliedOf(row) {
    var t = termsOf(row);
    var raw = t.centre * t.size * t.growth * t.age * t.chains * t.adjustment;
    var mult = Math.min(M.multiple_max, Math.max(M.multiple_min, raw / row.tvl_usd));
    return Math.max(1, Math.round(row.tvl_usd * mult));
  }

  // ---------- the peers' record ----------
  function categoryRecordOf(category) {
    var key = category === null ? 'Uncategorised' : category;
    for (var i = 0; i < DATA.records.by_category.length; i++) {
      if (DATA.records.by_category[i].category === key) return DATA.records.by_category[i];
    }
    return { category: key, with_token: 0, total: 0 };
  }
  function bandRecordOf(tvl) {
    var bands = DATA.records.by_band;
    var found = bands[0];
    for (var i = 0; i < bands.length; i++) if (tvl >= bands[i].min_tvl) found = bands[i];
    return found;
  }
  function shareOf(rec) { return rec.total === 0 ? 'n/a' : Math.round((rec.with_token / rec.total) * 100) + '%'; }

  // ---------- integrity flags and verdicts ----------
  var FLAG_TEXT = {
    'sharp-move': 'Sharp 7d move: the week\'s TVL change runs past the range the fit was trained on, so the growth term is scored at its clamp.',
    'no-7d': 'No seven-day figure recorded: the growth term is scored at zero.',
    'no-date': 'No listing date recorded: the age term is scored at the fit pool\'s median age.',
    'no-category': 'No category recorded: the row takes no category adjustment.',
    'one-chain': 'One chain only: the whole record sits on a single chain.',
    'thin-peers': 'Thin peer set: its category\'s adjustment rests on fewer than three fit peers.',
  };
  var VERDICTS = {
    'farm-first': 'Farm first',
    'farm': 'Farm it',
    'small': 'Small farm only',
    'watch': 'Watch only',
  };
  function verdictOf(row) {
    var n = row.flags.length;
    if (n >= 3) return 'watch';
    if (row.implied_value_usd >= 20000000 && n <= 1) return 'farm-first';
    if (row.implied_value_usd >= 7500000 && n <= 2) return 'farm';
    if (row.implied_value_usd >= 2500000) return 'small';
    return 'watch';
  }

  // ---------- the farm plan, generated in the page exactly as lib/model.ts writes it ----------
  function gasFor(chain) {
    switch (chain) {
      case 'Ethereum': return 12;
      case 'Solana': return 0.25;
      case 'Base': case 'Arbitrum': case 'Optimism': case 'Linea': case 'Scroll': case 'zkSync Era': return 0.8;
      case 'BSC': return 0.4;
      case 'Polygon': return 0.3;
      case 'Avalanche': return 0.9;
      default: return 2;
    }
  }
  function gasAssetFor(chain) {
    switch (chain) {
      case 'Solana': return 'SOL';
      case 'BSC': return 'BNB';
      case 'Polygon': return 'POL';
      case 'Avalanche': return 'AVAX';
      default: return 'ETH';
    }
  }
  function capitalFor(tvl) {
    if (tvl >= 5e9) return 250;
    if (tvl >= 1e9) return 150;
    if (tvl >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function playbookFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 && c.indexOf('uncollateralized') < 0) return [
      'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and leave the deposit open.',
      'Borrow about a quarter of the deposit back, hold it a few days, then repay in full: activity on both sides of the market is what lending farms count.'];
    if (c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return [
      'Deposit $' + capital + ' of collateral into ' + name + ' on ' + chain + ' and mint its stablecoin against the position.',
      "Hold the minted stablecoin in the protocol's own pool or a second vault, and repay a slice of the debt once a month so the position shows a full life cycle."];
    if (c.indexOf('dex') >= 0) return [
      'Provide $' + capital + ' of liquidity to ' + name + "'s main USDC pool on " + chain + ' and keep the LP position open.',
      'Route two or three small swaps a week through ' + name + ' itself rather than an aggregator, so the volume lands on the protocol you are farming.'];
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return [
      'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the vault shares in the farming wallet.',
      "Open the curator's own allocation page once a week and, when a second vault in the same strategy opens, split the position across both: two vaults, two records."];
    if (c.indexOf('rwa') >= 0) return [
      'Complete ' + name + "'s onboarding checks, then mint $" + capital + ' of its yield asset on ' + chain + ' and hold it.',
      'Hold through one full distribution cycle before redeeming anything: RWA farms are scored on time in the asset, not on transaction count.'];
    if (c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('options') >= 0) return [
      'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position, long and short the same size.',
      'Close and reopen a small position once a week: steady volume across several snapshots counts for more than one large trade.'];
    if (c.indexOf('basis') >= 0) return [
      "Fund " + name + "'s basis vault with $" + capital + ' on ' + chain + ' and keep the shares.',
      "Check the vault's funding page weekly and stay in through at least two funding cycles; leaving mid-cycle is what the strategy charges for."];
    if (c.indexOf('bridge') >= 0) return [
      'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ', then use the bridged funds in an app on the far side.',
      'Bridge a smaller amount back on a different day each week: round trips on separate days read as real use, not as one transfer split up.'];
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return [
      "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt token in the farming wallet.',
      'Leave the position untouched through one full unstaking-queue cycle before changing it: staking farms reward time staked above all.'];
    if (c === 'chain') return [
      'Bridge $' + capital + ' onto ' + name + ' and hold the balance in the farming wallet.',
      "Make two or three small transactions a week in the chain's own apps, a swap and a lend, so the wallet reads as a resident, not a passer-by."];
    if (c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0 || c.indexOf('index') >= 0) return [
      'Deposit $' + capital + ' into ' + name + "'s main vault on " + chain + ' and keep the shares.',
      "Claim the vault's rewards once a month and put them back in the same vault: the record shows a farmer who stays, not one who strips yield."];
    if (c.indexOf('insurance') >= 0) return [
      'Put $' + capital + ' into ' + name + "'s underwriting pool on " + chain + ', or buy that much cover from it, and keep the position open.',
      'Renew or extend the position before it lapses: an unbroken cover or staking record is the history this category counts.'];
    if (c.indexOf('prediction') >= 0) return [
      'Fund ' + name + ' with $' + capital + ' and place one position in a market you have a view on.',
      'Trade a second, smaller market each week and settle every position at expiry: settled history counts, abandoned tickets do not.'];
    if (c.indexOf('payment') >= 0) return [
      'Fund a ' + name + ' account or wallet with $' + capital + ' on ' + chain + '.',
      'Route two or three real payments a week through it, varied amounts on varied days, the pattern a payment farm is scored on.'];
    if (c.indexOf('stable') >= 0 || c.indexOf('wrapper') >= 0) return [
      'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it.',
      'Keep the balance unbroken for the hold period and add a small top-up monthly: stable farms count balance-days, not transactions.'];
    if (c.indexOf('privacy') >= 0) return [
      'Deposit $' + capital + ' into ' + name + "'s shielded pool on " + chain + ' from the farming wallet.',
      'Make one shielded transfer a week between your own wallets and keep the notes recorded in your farm log.'];
    return [
      'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.',
      "Make one more qualifying action the app offers, a second deposit, a borrow or a swap, so the wallet's record is more than a single touch."];
  }
  function farmSteps(p) {
    var chain = p.chains.length > 0 ? p.chains[0] : 'its main chain';
    var gas = gasFor(chain);
    var capital = capitalFor(p.tvl_usd);
    var hold = holdDaysFor(p.age_days);
    var book = playbookFor(p, capital, chain);
    var gasText = gas < 1 ? 'about $' + gas.toFixed(2) : 'about $' + Math.round(gas);
    var steps = [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, keep its seed phrase offline, and fund it with ' + gasAssetFor(chain) + ' for gas on ' + chain + '.', cost: gasText + ' of gas per transaction on ' + chain, time: '10 minutes' },
      { text: book[0], cost: '$' + capital + ' of capital and ' + gasText + ' of gas', time: '15 minutes to set up' },
      { text: book[1], cost: gasText + ' of gas each time', time: '10 minutes' },
      { text: 'Repeat one qualifying action every week, on the same weekday, so the record spans several weekly snapshots.', cost: gasText + ' of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days before withdrawing anything.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
    ];
    if (p.chains.length > 1) steps.push({ text: p.name + ' also runs on ' + p.chains.slice(1, 3).join(' and ') + ': one small position there doubles the surfaces the farm is read on.', cost: '$25 of capital and that chain\'s gas', time: '15 minutes' });
    steps.push(
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' });
    return steps.slice(0, 8);
  }
  function planCostOf(p) {
    var chain = p.chains.length > 0 ? p.chains[0] : 'its main chain';
    var gas = gasFor(chain);
    var hold = holdDaysFor(p.age_days);
    var weeks = Math.ceil(hold / 7);
    var months = Math.ceil(hold / 30);
    var transactions = 2 + months + weeks;
    var gasUsd = gas * transactions;
    var capital = capitalFor(p.tvl_usd);
    if (p.chains.length > 1) { capital += 25; gasUsd += gasFor(p.chains[1]); transactions += 1; }
    var gasRounded = Math.round(gasUsd);
    return { capital_usd: capital, gas_usd: gasRounded, total_usd: capital + gasRounded, transactions: transactions };
  }

  // ---------- rendering ----------
  function statCard(k, vHtml) {
    var d = el('div', { class: 'stat' });
    d.appendChild(el('div', { class: 'k', text: k }));
    var v = el('div', { class: 'v' });
    v.innerHTML = vHtml;
    d.appendChild(v);
    return d;
  }
  function header() {
    var h = el('header', { class: 'top' });
    h.appendChild(el('p', { class: 'eyebrow', text: 'Launch Radar · model ' + DATA.model_version }));
    var title = el('h1');
    title.innerHTML = 'What would their token be worth? <span class="thin">Every pre-token protocol, ranked by a fitted model.</span>';
    h.appendChild(title);
    var lede = el('p', { class: 'lede' });
    lede.innerHTML = 'This board ranks <strong>' + DATA.board_size + ' protocols that record no token</strong> by the value a ' +
      'launch would carry if their record stayed as it is. The price is not asserted: it is <strong>fitted on the snapshot\'s own ' +
      F.peers + ' live-token peers</strong> — log market cap regressed on TVL, seven-day growth, time listed and chain count, ' +
      'with a shrunk adjustment per category — and <strong>tested held-out twice</strong> before it prices anything: the median ' +
      'held-out miss is <strong>' + fmtX(DATA.validation.fitted_median_miss) + '</strong>, against ' + fmtX(DATA.validation.baseline_median_miss) +
      ' for the median-multiple model it replaces. All <strong>' + DATA.watchlist_size + ' watchlist protocols</strong> are on the board ' +
      '(marked ★), and so is every other pre-token protocol that is not a wrapped, staked or exchange product of one that trades. ' +
      'Click any row for the arithmetic, the integrity flags, and the steps to farm it with their cost and the verdict on the plan.';
    h.appendChild(lede);
    h.appendChild(el('p', { class: 'source-line', text: 'Snapshot: ' + DATA.source + ' · as of ' + DATA.as_of + ' · watchlist floor ' + fmtUsd(DATA.floor_usd) + ' TVL' }));
    var stats = el('div', { class: 'stats' });
    stats.appendChild(statCard('Protocols ranked', String(DATA.board_size)));
    stats.appendChild(statCard('Watchlist covered', '<em>' + DATA.watchlist_size + ' / ' + DATA.watchlist_size + '</em>'));
    stats.appendChild(statCard('TVL on the board', fmtUsd(DATA.stats.total_tvl_usd)));
    stats.appendChild(statCard('Combined implied value', fmtUsd(DATA.stats.total_implied_usd)));
    stats.appendChild(statCard('Median implied value', fmtUsd(DATA.stats.median_implied_usd)));
    stats.appendChild(statCard('Held-out median miss', fmtX(DATA.validation.fitted_median_miss)));
    h.appendChild(stats);
    return h;
  }

  function visibleRows() {
    var rows = DATA.rows.filter(function (r) {
      if (state.watchlistOnly && !WATCH[r.slug]) return false;
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (state.verdict !== 'all' && verdictOf(r) !== state.verdict) return false;
      if (state.q) {
        var q = state.q.toLowerCase();
        if (r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0 && (r.category || '').toLowerCase().indexOf(q) < 0) return false;
      }
      return true;
    });
    var key = state.sort, dir = state.dir;
    rows.sort(function (a, b) {
      var va, vb;
      if (key === 'implied') { va = a.implied_value_usd; vb = b.implied_value_usd; }
      else if (key === 'tvl') { va = a.tvl_usd; vb = b.tvl_usd; }
      else if (key === 'change') { va = a.change_7d === null ? -1e9 : a.change_7d; vb = b.change_7d === null ? -1e9 : b.change_7d; }
      else if (key === 'multiple') { va = a.predicted_multiple; vb = b.predicted_multiple; }
      else if (key === 'cost') { va = a.plan_cost_usd; vb = b.plan_cost_usd; }
      else if (key === 'flags') { va = a.flags.length; vb = b.flags.length; }
      else if (key === 'name') { va = a.name.toLowerCase(); vb = b.name.toLowerCase(); return dir * (va < vb ? -1 : va > vb ? 1 : 0); }
      else { va = a.rank; vb = b.rank; }
      return dir * (va - vb);
    });
    return rows;
  }

  function sortHeader(label, key, cls) {
    var th = el('th', { class: cls || '', text: label + (state.sort === key ? (state.dir === 1 ? ' ↑' : ' ↓') : '') });
    th.addEventListener('click', function () {
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = key === 'rank' || key === 'name' ? 1 : -1; }
      render();
    });
    return th;
  }

  function boardTable(rows) {
    var table = el('table');
    var thead = el('thead');
    var tr = el('tr');
    tr.appendChild(sortHeader('#', 'rank', 'num'));
    tr.appendChild(sortHeader('Protocol', 'name'));
    tr.appendChild(el('th', { text: 'Category' }));
    tr.appendChild(sortHeader('TVL', 'tvl', 'num'));
    tr.appendChild(sortHeader('7d', 'change', 'num'));
    tr.appendChild(sortHeader('Fitted x', 'multiple', 'num'));
    tr.appendChild(sortHeader('Implied value', 'implied', 'num'));
    tr.appendChild(el('th', { text: 'Verdict' }));
    tr.appendChild(sortHeader('Flags', 'flags', 'num'));
    thead.appendChild(tr);
    table.appendChild(thead);
    var tbody = el('tbody');
    if (rows.length === 0) {
      var etr = el('tr');
      etr.appendChild(el('td', { class: 'empty', colspan: '9', text: 'No protocol matches that filter. Loosen it and sweep again.' }));
      tbody.appendChild(etr);
    }
    rows.forEach(function (r) {
      var tr2 = el('tr');
      tr2.appendChild(el('td', { class: 'rank', text: String(r.rank) }));
      var nameTd = el('td');
      nameTd.appendChild(el('span', { class: 'name', text: r.name }));
      if (WATCH[r.slug]) nameTd.appendChild(el('span', { class: 'star', text: ' ★' }));
      nameTd.appendChild(el('div', { class: 'sub', text: r.slug }));
      tr2.appendChild(nameTd);
      tr2.appendChild(el('td', { text: r.category || 'Uncategorised' }));
      tr2.appendChild(el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }));
      tr2.appendChild(el('td', { class: 'num ' + (r.change_7d === null ? 'flat' : r.change_7d > 0 ? 'up' : r.change_7d < 0 ? 'down' : 'flat'), text: fmtPct(r.change_7d) }));
      tr2.appendChild(el('td', { class: 'num', text: fmtMult(r.predicted_multiple) }));
      tr2.appendChild(el('td', { class: 'num implied', text: fmtUsd(r.implied_value_usd) }));
      var vtd = el('td');
      vtd.appendChild(el('span', { class: 'chip v-' + verdictOf(r), text: VERDICTS[verdictOf(r)] }));
      tr2.appendChild(vtd);
      tr2.appendChild(el('td', { class: 'num', text: r.flags.length === 0 ? '—' : '⚑ ' + r.flags.length }));
      tr2.addEventListener('click', function () { openDetail(r); });
      tbody.appendChild(tr2);
    });
    table.appendChild(tbody);
    return table;
  }

  function liveTable() {
    var table = el('table');
    var thead = el('thead');
    var tr = el('tr');
    ['Protocol', 'Category', 'TVL', 'Market cap (actual)', '7d', 'Trades at'].forEach(function (h, i) {
      tr.appendChild(el('th', { class: i >= 2 ? 'num' : '', text: h }));
    });
    thead.appendChild(tr);
    table.appendChild(thead);
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      var tr2 = el('tr');
      var nameTd = el('td');
      nameTd.appendChild(el('span', { class: 'name', text: r.name }));
      nameTd.appendChild(el('div', { class: 'sub', text: r.slug }));
      tr2.appendChild(nameTd);
      tr2.appendChild(el('td', { text: r.category || 'Uncategorised' }));
      tr2.appendChild(el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }));
      tr2.appendChild(el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }));
      tr2.appendChild(el('td', { class: 'num ' + (r.change_7d === null ? 'flat' : r.change_7d > 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) }));
      tr2.appendChild(el('td', { class: 'num', text: r.multiple === null ? 'n/a' : fmtMult(r.multiple) + ' TVL' }));
      tbody.appendChild(tr2);
    });
    table.appendChild(tbody);
    return table;
  }

  function controls() {
    var bar = el('div', { class: 'controls' });
    var search = el('input', { type: 'search', placeholder: 'Search name, slug or category…', value: state.q });
    search.addEventListener('input', function () { state.q = search.value; renderTableOnly(); });
    bar.appendChild(search);
    var cats = {};
    DATA.rows.forEach(function (r) { var c = r.category || 'Uncategorised'; cats[c] = (cats[c] || 0) + 1; });
    var sel = el('select');
    sel.appendChild(el('option', { value: 'all', text: 'All categories (' + DATA.rows.length + ')' }));
    Object.keys(cats).sort().forEach(function (c) {
      var o = el('option', { value: c, text: c + ' (' + cats[c] + ')' });
      if (state.category === c) o.setAttribute('selected', 'selected');
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () { state.category = sel.value; renderTableOnly(); });
    bar.appendChild(sel);
    var vsel = el('select');
    vsel.appendChild(el('option', { value: 'all', text: 'All verdicts' }));
    Object.keys(VERDICTS).forEach(function (v) {
      var o = el('option', { value: v, text: VERDICTS[v] });
      if (state.verdict === v) o.setAttribute('selected', 'selected');
      vsel.appendChild(o);
    });
    vsel.addEventListener('change', function () { state.verdict = vsel.value; renderTableOnly(); });
    bar.appendChild(vsel);
    var lab = el('label', { class: 'check' });
    var cb = el('input', { type: 'checkbox' });
    if (state.watchlistOnly) cb.setAttribute('checked', 'checked');
    cb.addEventListener('change', function () { state.watchlistOnly = cb.checked; renderTableOnly(); });
    lab.appendChild(cb);
    lab.appendChild(document.createTextNode('Watchlist only ★'));
    bar.appendChild(lab);
    var tabs = el('div', { class: 'tabs' });
    [['board', 'Pre-token board'], ['live', 'Live tokens']].forEach(function (t) {
      var b = el('button', { text: t[1], 'aria-pressed': state.view === t[0] ? 'true' : 'false' });
      b.addEventListener('click', function () { state.view = t[0]; render(); });
      tabs.appendChild(b);
    });
    bar.appendChild(tabs);
    return bar;
  }

  function calTable(headers, rowsHtml) {
    var table = el('table', { class: 'cal' });
    var thead = el('thead');
    var tr = el('tr');
    headers.forEach(function (h, i) { tr.appendChild(el('th', { class: i > 0 ? 'num' : '', text: h })); });
    thead.appendChild(tr);
    table.appendChild(thead);
    var tbody = el('tbody');
    rowsHtml.forEach(function (cells) {
      var tr2 = el('tr');
      cells.forEach(function (c, i) { tr2.appendChild(el('td', { class: i > 0 ? 'num' : '', text: c })); });
      tbody.appendChild(tr2);
    });
    table.appendChild(tbody);
    return table;
  }

  function modelPanel() {
    var s = el('section', { class: 'panel' });
    s.appendChild(el('h2', { text: 'The model: fitted on the snapshot\'s own live tokens' }));
    var p1 = el('p');
    p1.innerHTML = 'A launch is worth what the market already pays for the same kind of protocol — but instead of asserting one ' +
      'multiple per category, this model <strong>fits</strong> the record. The fit pool is the <strong>' + F.peers + ' protocols that record ' +
      'a market cap above zero and a listing date</strong> (a recorded zero is a dead token, not a price, and a peer with no date cannot ' +
      'carry the age term). On that pool, log market cap is regressed on four terms the snapshot itself carries — TVL, the seven-day ' +
      'TVL change, time since listing, and chain count — and each category then takes its own adjustment: its peers\' mean residual, ' +
      'shrunk toward zero by ' + M.shrink_k + ' phantom peers and clamped to a quarter..four times, so a category with two wild peers ' +
      'cannot set its own price. A category with no fit peers takes no adjustment. The growth term is clamped to ' + M.growth_floor + '%..+' +
      M.growth_cap + '%, the range the live peers themselves span; a protocol whose week ran further is scored at the clamp and flagged. ' +
      'A protocol with no recorded date is scored at the pool\'s median age, ' + F.median_age_days + ' days.';
    s.appendChild(p1);
    s.appendChild(el('div', { class: 'formula', text: 'log value = ' + F.intercept.toFixed(3) + ' + ' + F.log_tvl.toFixed(3) + ' x (log TVL - ' + F.center_log_tvl.toFixed(3) + ') + (' + F.growth.toFixed(3) + ') x growth + (' + F.age.toFixed(3) + ') x age + ' + F.chains.toFixed(3) + ' x log(1 + chains) + log(category adjustment)' }));
    var p2 = el('p');
    p2.innerHTML = 'Read the fitted signs the way the record gives them. The size term is below one: <strong>value grows slower than TVL</strong>, ' +
      'so big protocols price at lower multiples than small ones. The growth term is negative: market caps are sticky, so a protocol whose TVL ' +
      'just spiked trades at a <strong>diluted</strong> multiple — the fit prices a spike the way the peers\' own spikes are priced, not as a bonus. ' +
      'The age term is negative too: at equal TVL, the peers\' longer-listed protocols trade lower, a freshness premium the board inherits. ' +
      'None of these signs was chosen; each is the least-squares reading of the same snapshot the board ranks.';
    s.appendChild(p2);
    s.appendChild(calTable(
      ['Category', 'Fit peers', 'Peers\' raw median', 'Adjustment used'],
      F.categories.map(function (c) {
        return [c.category, String(c.peers), c.median_multiple === null ? 'n/a' : fmtMult(c.median_multiple), fmtMult(c.adjustment)];
      }).concat([['Any other category (no fit peers)', '0', 'n/a', 'x1.000 (none)']])
    ));
    s.appendChild(el('h2', { text: 'Tested held-out, twice' }));
    var pv = el('p');
    pv.innerHTML = 'A fit that is never tested on data it has not seen is a story. The pool was split in two, twice, on two different ' +
      'deterministic splits; on each split this pipeline was fitted on one half and priced the other, in both directions — and the ' +
      'previous model (radar-2: category median multiples with fixed growth and maturity terms) was put through the same exercise on ' +
      'the same halves. Pooled over both splits, the fitted model\'s <strong>median held-out miss is ' + fmtX(DATA.validation.fitted_median_miss) +
      '</strong> with <strong>' + DATA.validation.fitted_within_2x_pct + '% of held-out peers priced within two times</strong> their actual ' +
      'market cap, against ' + fmtX(DATA.validation.baseline_median_miss) + ' and ' + DATA.validation.baseline_within_2x_pct + '% for radar-2. ' +
      'On the peers it was fitted on, the miss is ' + fmtX(DATA.validation.insample_median_miss) + '. Read the board the way those numbers say: ' +
      'a ranking with wide error bars, not a list of prices.';
    s.appendChild(pv);
    s.appendChild(calTable(
      ['Split', 'Halves', 'Fitted median miss', 'Fitted within 2x', 'radar-2 median miss', 'radar-2 within 2x'],
      DATA.validation.splits.map(function (sp) {
        return [sp.name, sp.half_a + ' / ' + sp.half_b, fmtX(sp.fitted_median_miss), sp.fitted_within_2x_pct + '%', fmtX(sp.baseline_median_miss), sp.baseline_within_2x_pct + '%'];
      })
    ));
    s.appendChild(el('h2', { text: 'The peers\' record: how often protocols like these record a token' }));
    var pr = el('p');
    pr.innerHTML = 'Across the whole snapshot, <strong>' + DATA.records.overall.with_token + ' of ' + DATA.records.overall.total +
      ' protocols record a token</strong>. The rate climbs gently with size. This is context from the peers\' record, stated per protocol ' +
      'in its detail view — <strong>not a forecast</strong>: the board prices what a launch would be worth if one came, and a snapshot ' +
      'cannot say whether or when one will.';
    s.appendChild(pr);
    s.appendChild(calTable(
      ['TVL band', 'Record a token', 'Protocols', 'Share'],
      DATA.records.by_band.map(function (b) { return [b.band, String(b.with_token), String(b.total), shareOf(b)]; })
    ));
    s.appendChild(el('h2', { text: 'Integrity strip and verdicts' }));
    var pi = el('p');
    pi.innerHTML = 'Every row carries the flags its own record raises — a sharp week scored at the clamp, a missing figure, a single ' +
      'chain, a thin peer set — listed in full in its detail view. The verdict on each plan follows one rule: <strong>a claim of $20M or ' +
      'more with at most one flag is a Farm first; $7.5M or more with at most two flags is a Farm it; $2.5M or more is a Small farm only; ' +
      'anything below, or any record with three or more flags, is a Watch only</strong>. The plan\'s all-in cost (capital tied up plus gas ' +
      'burned, counted from the plan\'s own steps) is printed beside the verdict; across the board those costs run from $52 to $282, ' +
      'so cost alone cannot separate the plans — the claim and the record do.';
    s.appendChild(pi);
    return s;
  }

  // ---------- detail view ----------
  var dialog = null;
  function openDetail(row) {
    state.selected = row.slug;
    if (!dialog) {
      dialog = el('dialog');
      document.body.appendChild(dialog);
      dialog.addEventListener('click', function (e) { if (e.target === dialog) dialog.close(); });
    }
    dialog.innerHTML = '';
    var box = el('div', { class: 'dlg' });
    var close = el('button', { class: 'close', text: 'Close' });
    close.addEventListener('click', function () { dialog.close(); });
    box.appendChild(close);
    box.appendChild(el('p', { class: 'eyebrow', text: 'Rank #' + row.rank + (WATCH[row.slug] ? ' · on the snapshot watchlist ★' : ' · beyond the watchlist floor') }));
    box.appendChild(el('h2', { text: row.name }));
    box.appendChild(el('p', { class: 'sub', text: (row.category || 'Uncategorised') + ' · ' + (row.chains.length ? row.chains.join(', ') : 'no chains recorded') + ' · records no token in the snapshot of ' + DATA.as_of }));
    box.appendChild(el('h3', { text: 'Implied value' }));
    var t = termsOf(row);
    var fitCat = fitCategoryOf(row.category);
    var eq = el('div', { class: 'eq' });
    eq.innerHTML =
      'centre value <b>' + fmtUsd(t.centre) + '</b> (a peer at the fit\'s centre size)<br>' +
      'x size <b>' + t.size.toFixed(3) + '</b> (TVL ' + fmtUsd(row.tvl_usd) + ') x growth <b>' + t.growth.toFixed(3) + '</b> (7d ' + fmtPct(row.change_7d) + ', scored at ' + fmtPct(t.growthPct) + ')<br>' +
      'x age <b>' + t.age.toFixed(3) + '</b> (listed ' + fmtAge(t.ageUsed) + (row.age_days === null ? ', the pool median — no date recorded' : '') + ') x chains <b>' + t.chains.toFixed(3) + '</b> (' + row.chains.length + ' chains)<br>' +
      'x category adjustment <b>' + fmtMult(t.adjustment) + '</b> (' + (row.category || 'Uncategorised') + ': ' + fitCat.peers + ' fit peers, raw median ' + (fitCat.median_multiple === null ? 'n/a' : fmtMult(fitCat.median_multiple)) + ')<br>' +
      '= <b>' + fmtUsd(impliedOf(row)) + '</b> — a fitted multiple of ' + fmtMult(row.predicted_multiple) + ' of TVL';
    box.appendChild(eq);
    var check = impliedOf(row);
    box.appendChild(el('p', { class: 'note', text: check === row.implied_value_usd
      ? 'The page recomputes this row from the printed fit as ' + fmtUsd(check) + ', the same number board.json carries. An implied value is this board\'s claim about a launch that may never happen, not a price and not a prediction.'
      : 'Under the printed fit the page recomputes ' + fmtUsd(check) + '; board.json carries ' + fmtUsd(row.implied_value_usd) + '.' }));
    box.appendChild(el('h3', { text: 'The peers\' record' }));
    var catRec = categoryRecordOf(row.category);
    var bandRec = bandRecordOf(row.tvl_usd);
    box.appendChild(el('p', { class: 'note', text: 'In this snapshot, ' + catRec.with_token + ' of ' + catRec.total + ' ' + (row.category || 'Uncategorised') +
      ' protocols record a token (' + shareOf(catRec) + '), and ' + bandRec.with_token + ' of ' + bandRec.total + ' protocols in the ' + bandRec.band +
      ' TVL band do (' + shareOf(bandRec) + '). Context from the record, not a forecast: nothing here says whether this protocol ever issues.' }));
    box.appendChild(el('h3', { text: 'Integrity' }));
    if (row.flags.length === 0) {
      box.appendChild(el('p', { class: 'note', text: 'No flags: every figure the model needs is recorded, the week\'s move sits inside the fitted range, and the category adjustment rests on at least three fit peers.' }));
    } else {
      var ul = el('ul', { class: 'flags' });
      row.flags.forEach(function (f) { ul.appendChild(el('li', { text: FLAG_TEXT[f] || f })); });
      box.appendChild(ul);
    }
    box.appendChild(el('h3', { text: 'Verdict and plan cost' }));
    var cost = planCostOf(row);
    var vb = el('div', { class: 'verdict-box' });
    var vp = el('p');
    vp.innerHTML = '<span class="chip v-' + verdictOf(row) + '">' + VERDICTS[verdictOf(row)] + '</span> ' +
      'Plan cost <b>' + fmtUsd(cost.total_usd) + ' all-in</b>: ' + fmtUsd(cost.capital_usd) + ' of capital tied up plus ' + fmtUsd(cost.gas_usd) +
      ' of gas over ' + cost.transactions + ' transactions. The model\'s claim of ' + fmtUsd(row.implied_value_usd) + ' is ' +
      Math.round(row.implied_value_usd / Math.max(1, cost.total_usd)).toLocaleString('en-US') + ' times the plan\'s cost — a ratio every ' +
      'plan on this board shares, which is why the verdict keys on the claim and the flags, not the cost.';
    vb.appendChild(vp);
    box.appendChild(vb);
    box.appendChild(el('h3', { text: 'Farm plan' }));
    var ol = el('ol', { class: 'plan' });
    farmSteps(row).forEach(function (st) {
      var li = el('li', { text: st.text });
      var meta = el('span', { class: 'meta' });
      meta.innerHTML = 'Cost: <b></b> · Time: ';
      meta.querySelector('b').textContent = st.cost;
      meta.appendChild(document.createTextNode(st.time));
      li.appendChild(meta);
      ol.appendChild(li);
    });
    box.appendChild(ol);
    dialog.appendChild(box);
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', 'open');
    try { history.replaceState(null, '', '#' + row.slug); } catch (e) { /* file URLs may refuse */ }
  }

  // ---------- page assembly ----------
  var tableHost = null;
  function renderTableOnly() {
    if (!tableHost) return;
    tableHost.innerHTML = '';
    tableHost.appendChild(state.view === 'board' ? boardTable(visibleRows()) : liveTable());
  }
  function render() {
    app.innerHTML = '';
    app.appendChild(header());
    app.appendChild(controls());
    tableHost = el('div');
    app.appendChild(tableHost);
    renderTableOnly();
    if (state.view === 'board') app.appendChild(modelPanel());
    var f = el('footer');
    f.textContent = 'Method in one line: every protocol that records no token and is not a wrapped, staked or exchange product of one that trades is ranked by a value fitted on the snapshot\'s own live-token peers — log market cap on TVL, seven-day growth, time listed and chain count, with a shrunk category adjustment — and the fit is published with its held-out misses. A protocol may still have a token its DefiLlama record does not carry; the board says only what the record shows. Implied values are this entry\'s own claims, never make.fun\'s, and nothing here predicts whether or when a token is issued.';
    app.appendChild(f);
  }
  render();
  if (location.hash.length > 1) {
    var slug = location.hash.slice(1);
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) { openDetail(DATA.rows[i]); break; }
  }
})();
