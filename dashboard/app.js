// Launch Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, the live-token set the model calibrates on, the calibration table itself, and a
// detail view per protocol with its farm plan. No network: every byte it shows is in data.js, and the
// page recomputes every implied value from the row's own figures with impliedOf below, the same
// function lib/model.ts runs, so what the board.json carries and what the page shows cannot drift.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var M = DATA.model;
  var state = {
    view: 'board', q: '', category: 'all', watchlistOnly: false,
    sort: 'rank', dir: 1,
    knobs: { multScale: 1, growthWeight: M.growth_weight, maturityFloor: M.maturity_floor },
    selected: null,
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

  // ---------- the model, restated in the page (the same function lib/model.ts runs) ----------
  function growthMultOf(row, knobs) {
    var g = row.change_7d === null ? 0 : row.change_7d;
    g = Math.min(M.growth_cap, Math.max(M.growth_floor, g));
    return 1 + (g / 100) * knobs.growthWeight;
  }
  function maturityMultOf(row, knobs) {
    var age = row.age_days === null ? M.unknown_age_days : row.age_days;
    var t = Math.min(Math.max(age, 0), M.maturity_days) / M.maturity_days;
    return knobs.maturityFloor + t * M.maturity_range;
  }
  function impliedOf(row, knobs) {
    return Math.max(1, Math.round(row.tvl_usd * row.category_multiple * knobs.multScale * growthMultOf(row, knobs) * maturityMultOf(row, knobs)));
  }
  function calibrationOf(category) {
    var key = category === null ? 'Uncategorised' : category;
    for (var i = 0; i < DATA.calibration.categories.length; i++) {
      if (DATA.calibration.categories[i].category === key) return DATA.calibration.categories[i];
    }
    return { category: key, peers: 0, median_multiple: null, multiple: DATA.calibration.global_median };
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
    title.innerHTML = 'What would their token be worth? <span class="thin">Every pre-token protocol, ranked.</span>';
    h.appendChild(title);
    var lede = el('p', { class: 'lede' });
    lede.innerHTML = 'This board ranks <strong>' + DATA.board_size + ' protocols that record no token</strong> by the value a ' +
      'launch would carry if their record stayed as it is: TVL priced at the multiple their own category\'s live tokens ' +
      'actually trade at, adjusted for seven-day growth and for how long they have run without one. ' +
      'All <strong>' + DATA.watchlist_size + ' watchlist protocols</strong> are on it (marked ★), and so is every other ' +
      'pre-token protocol that is not a wrapped, staked or exchange product of one that trades. Click any row for the ' +
      'arithmetic and the steps to farm it.';
    h.appendChild(lede);
    h.appendChild(el('p', { class: 'source-line', text: 'Snapshot: ' + DATA.source + ' · as of ' + DATA.as_of + ' · watchlist floor ' + fmtUsd(DATA.floor_usd) + ' TVL' }));
    var stats = el('div', { class: 'stats' });
    stats.appendChild(statCard('Protocols ranked', String(DATA.board_size)));
    stats.appendChild(statCard('Watchlist covered', '<em>' + DATA.watchlist_size + ' / ' + DATA.watchlist_size + '</em>'));
    stats.appendChild(statCard('TVL on the board', fmtUsd(DATA.stats.total_tvl_usd)));
    stats.appendChild(statCard('Combined implied value', fmtUsd(DATA.stats.total_implied_usd)));
    stats.appendChild(statCard('Median implied value', fmtUsd(DATA.stats.median_implied_usd)));
    h.appendChild(stats);
    return h;
  }

  function visibleRows() {
    var rows = DATA.rows.filter(function (r) {
      if (state.watchlistOnly && !WATCH[r.slug]) return false;
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (state.q) {
        var q = state.q.toLowerCase();
        if (r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0 && (r.category || '').toLowerCase().indexOf(q) < 0) return false;
      }
      return true;
    });
    var k = state.knobs;
    var key = state.sort, dir = state.dir;
    rows.sort(function (a, b) {
      var va, vb;
      if (key === 'implied') { va = impliedOf(a, k); vb = impliedOf(b, k); }
      else if (key === 'tvl') { va = a.tvl_usd; vb = b.tvl_usd; }
      else if (key === 'change') { va = a.change_7d === null ? -1e9 : a.change_7d; vb = b.change_7d === null ? -1e9 : b.change_7d; }
      else if (key === 'age') { va = a.age_days === null ? -1 : a.age_days; vb = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'multiple') { va = a.category_multiple; vb = b.category_multiple; }
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
    tr.appendChild(el('th', { text: 'Chains' }));
    tr.appendChild(sortHeader('TVL', 'tvl', 'num'));
    tr.appendChild(sortHeader('7d', 'change', 'num'));
    tr.appendChild(sortHeader('No token for', 'age', 'num'));
    tr.appendChild(sortHeader('Peer x', 'multiple', 'num'));
    tr.appendChild(sortHeader('Implied value', 'implied', 'num'));
    thead.appendChild(tr);
    table.appendChild(thead);
    var tbody = el('tbody');
    if (rows.length === 0) {
      var etr = el('tr');
      var etd = el('td', { class: 'empty', colspan: '9', text: 'No protocol matches that filter. Loosen it and sweep again.' });
      etr.appendChild(etd);
      tbody.appendChild(etr);
    }
    rows.forEach(function (r) {
      var tr2 = el('tr');
      tr2.appendChild(el('td', { class: 'rank', text: String(r.rank) }));
      var nameTd = el('td');
      var nm = el('span', { class: 'name', text: r.name });
      nameTd.appendChild(nm);
      if (WATCH[r.slug]) nameTd.appendChild(el('span', { class: 'star', text: ' ★' }));
      nameTd.appendChild(el('div', { class: 'sub', text: r.slug }));
      tr2.appendChild(nameTd);
      tr2.appendChild(el('td', { text: r.category || 'Uncategorised' }));
      tr2.appendChild(el('td', { class: 'chains', text: r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') }));
      tr2.appendChild(el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }));
      var ch = el('td', { class: 'num ' + (r.change_7d === null ? 'flat' : r.change_7d > 0 ? 'up' : r.change_7d < 0 ? 'down' : 'flat'), text: fmtPct(r.change_7d) });
      tr2.appendChild(ch);
      tr2.appendChild(el('td', { class: 'num', text: fmtAge(r.age_days) }));
      tr2.appendChild(el('td', { class: 'num', text: fmtMult(r.category_multiple) }));
      tr2.appendChild(el('td', { class: 'num implied', text: fmtUsd(impliedOf(r, state.knobs)) }));
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

  function modelPanel() {
    var s = el('section', { class: 'panel' });
    s.appendChild(el('h2', { text: 'The model: priced by their own kind' }));
    var p1 = el('p');
    p1.innerHTML = 'A launch is worth what the market already pays for the same kind of protocol. The snapshot carries ' +
      '<strong>' + DATA.calibration.peer_count + ' protocols whose token trades with a recorded market cap</strong>; their ' +
      'median market cap is <strong>' + fmtMult(DATA.calibration.global_median) + ' of TVL</strong>. Each category gets its own ' +
      'multiple: the median of its live peers, winsorised to a third..three times the global median and shrunk toward it by ' +
      M.shrink_k + ' phantom peers, so a category with one wild peer cannot set its own price. Growth and time-without-a-token ' +
      'then move the number, exactly as the formula states. No name is special-cased: change any figure in the snapshot and ' +
      'every row moves by the same rules.';
    s.appendChild(p1);
    s.appendChild(el('div', { class: 'formula', text: 'implied = TVL x category multiple x (1 + clamp(7d growth, -60%, +120%) x ' + M.growth_weight + ') x (' + M.maturity_floor + ' + min(age, 1095d)/1095 x ' + M.maturity_range + ')' }));
    var table = el('table', { class: 'cal' });
    var thead = el('thead');
    var tr = el('tr');
    ['Category', 'Live peers', 'Peer median', 'Multiple used'].forEach(function (h, i) {
      tr.appendChild(el('th', { class: i > 0 ? 'num' : '', text: h }));
    });
    thead.appendChild(tr);
    table.appendChild(thead);
    var tbody = el('tbody');
    DATA.calibration.categories.forEach(function (c) {
      var tr2 = el('tr');
      tr2.appendChild(el('td', { text: c.category }));
      tr2.appendChild(el('td', { class: 'num', text: String(c.peers) }));
      tr2.appendChild(el('td', { class: 'num', text: c.median_multiple === null ? 'n/a' : fmtMult(c.median_multiple) }));
      tr2.appendChild(el('td', { class: 'num', text: fmtMult(c.multiple) }));
      tbody.appendChild(tr2);
    });
    var trG = el('tr');
    trG.appendChild(el('td', { text: 'Any other category (no live peers)' }));
    trG.appendChild(el('td', { class: 'num', text: '0' }));
    trG.appendChild(el('td', { class: 'num', text: 'n/a' }));
    trG.appendChild(el('td', { class: 'num', text: fmtMult(DATA.calibration.global_median) + ' (global)' }));
    tbody.appendChild(trG);
    table.appendChild(tbody);
    s.appendChild(table);
    s.appendChild(el('h2', { text: 'Try the model' }));
    s.appendChild(el('p', { text: 'The board above runs on these constants. Change one and the whole board re-prices and re-ranks by the same rules; the detail view of any row shows its arithmetic under the constants you set.' }));
    var sb = el('div', { class: 'sandbox' });
    function knob(label, value, step, fn) {
      var lab = el('label', { text: label });
      var input = el('input', { type: 'number', value: String(value), step: step });
      input.addEventListener('input', function () { var v = parseFloat(input.value); if (isFinite(v)) { fn(v); renderTableOnly(); } });
      lab.appendChild(input);
      return lab;
    }
    sb.appendChild(knob('Peer multiples x', state.knobs.multScale, '0.05', function (v) { state.knobs.multScale = v; }));
    sb.appendChild(knob('Growth weight', state.knobs.growthWeight, '0.1', function (v) { state.knobs.growthWeight = v; }));
    sb.appendChild(knob('Maturity floor', state.knobs.maturityFloor, '0.05', function (v) { state.knobs.maturityFloor = v; }));
    s.appendChild(sb);
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
    var cal = calibrationOf(row.category);
    var k = state.knobs;
    var eq = el('div', { class: 'eq' });
    eq.innerHTML =
      'TVL ' + fmtUsd(row.tvl_usd) + ' x peer multiple <b>' + fmtMult(row.category_multiple * k.multScale) + '</b> (' + (row.category || 'Uncategorised') + ': ' + cal.peers + ' live peers, median ' + (cal.median_multiple === null ? 'n/a' : fmtMult(cal.median_multiple)) + ')<br>' +
      'x growth <b>' + growthMultOf(row, k).toFixed(3) + '</b> (7d ' + fmtPct(row.change_7d) + ') x maturity <b>' + maturityMultOf(row, k).toFixed(3) + '</b> (no token for ' + fmtAge(row.age_days) + ')<br>' +
      '= <b>' + fmtUsd(impliedOf(row, k)) + '</b>';
    box.appendChild(eq);
    var check = impliedOf(row, { multScale: 1, growthWeight: M.growth_weight, maturityFloor: M.maturity_floor });
    box.appendChild(el('p', { class: 'note', text: check === row.implied_value_usd
      ? 'The page recomputes this row from its own figures as ' + fmtUsd(check) + ', the same number board.json carries. An implied value is this board\'s claim about a launch that may never happen, not a price and not a prediction.'
      : 'Under the model\'s stated constants the page recomputes ' + fmtUsd(check) + '; board.json carries ' + fmtUsd(row.implied_value_usd) + '.' }));
    box.appendChild(el('h3', { text: 'Farm plan' }));
    var ol = el('ol', { class: 'plan' });
    farmSteps(row).forEach(function (s) {
      var li = el('li', { text: s.text });
      var meta = el('span', { class: 'meta' });
      meta.innerHTML = 'Cost: <b></b> · Time: ';
      meta.querySelector('b').textContent = s.cost;
      meta.appendChild(document.createTextNode(s.time));
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
    f.textContent = 'Method in one line: every protocol that records no token and is not a wrapped, staked or exchange product of one that trades is ranked by TVL priced at its own category\'s live-peer multiple, adjusted for seven-day growth and time without a token. A protocol may still have a token its DefiLlama record does not carry; the board says only what the record shows. Implied values are this entry\'s own claims, never make.fun\'s, and nothing here predicts whether or when a token is issued.';
    app.appendChild(f);
  }
  render();
  if (location.hash.length > 1) {
    var slug = location.hash.slice(1);
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) { openDetail(DATA.rows[i]); break; }
  }
})();
