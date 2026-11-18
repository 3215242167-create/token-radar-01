// Token Radar's page: renders the board the program scored, from ../data.js and nothing else.
// Filters, sorting and the detail view all run on that one object, so what a screenshot shows is what
// the code computed. The view can be deep-linked: ?q=&family=&chain=&tier=&sort=&detail=<slug>.
(function () {
  'use strict';
  var D = window.RADAR_DATA;
  if (!D) return;

  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);

  function commas(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + commas(n);
  }
  function moneyFull(n) { return '$' + commas(n); }
  function pct(g) { return g === null ? '—' : (g > 0 ? '+' : '') + g.toFixed(1) + '%'; }
  function ageText(days) {
    if (days === null) return '—';
    if (days >= 730) return (days / 365.25).toFixed(1) + ' y';
    if (days >= 60) return Math.round(days / 30.44) + ' mo';
    return days + ' d';
  }
  function mult(x) { return '×' + (x >= 10 ? x.toFixed(1) : x >= 1 ? x.toFixed(2) : x.toFixed(3)); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // ---- hero + model card -------------------------------------------------
  $('model-version').textContent = D.model_version;
  $('model-version-2').textContent = D.model_version;
  $('as-of').textContent = D.as_of;
  $('source').textContent = D.source;
  $('fit-n').textContent = D.fit.train_rows;

  var stats = [
    [D.protocols_size, 'protocols in the snapshot'],
    [D.fit.train_rows, 'traded protocols fitted'],
    [D.watchlist_size, 'watchlist rows (≥ $50M TVL)'],
    [D.early_size, 'early finds below the floor'],
    [D.board_size, 'rows on the board'],
  ];
  stats.forEach(function (s) {
    var d = el('div', 'stat');
    d.appendChild(el('b', null, commas(s[0])));
    d.appendChild(el('span', null, s[1]));
    $('stats').appendChild(d);
  });

  var b = D.fit.beta;
  var per = function (coef, scale) { return Math.exp(coef * scale); };
  var findings = [
    'Size: value scales with TVL^' + b.log_tvl.toFixed(2) + ' — doubling a protocol\u2019s TVL multiplies its implied multiple by ' + mult(per(b.log_tvl - 1, Math.LN2)) + ', so the biggest balance sheet does not automatically top the board.',
    'Growth: each extra 10 points of 7-day TVL growth multiplies value by ' + mult(per(b.growth, 10)) + ' in the fitted set. Sustained size is priced; a one-week spike is discounted.',
    'Track record: each doubling of listed age multiplies value by ' + mult(per(b.log_age, Math.LN2)) + '. The traded set\u2019s multiples fall as listing age rises, and the board inherits that.',
    'Reach: each doubling of chain count multiplies value by ' + mult(per(b.log_chains, Math.LN2)) + ' — distribution is worth something, not much.',
  ];
  findings.forEach(function (f) { $('findings').appendChild(el('li', null, f)); });

  var famTable = $('fam-table');
  var fhead = el('tr');
  fhead.appendChild(el('th', null, 'Family'));
  fhead.appendChild(el('th', 'n', 'Fitted'));
  fhead.appendChild(el('th', 'n', 'Factor'));
  famTable.appendChild(fhead);
  D.fit.families.forEach(function (f) {
    var tr = el('tr');
    tr.appendChild(el('td', null, f.family));
    tr.appendChild(el('td', 'n', String(f.rows)));
    tr.appendChild(el('td', 'n', mult(f.factor)));
    famTable.appendChild(tr);
  });

  $('backtest').innerHTML = '';
  var bt = $('backtest');
  bt.appendChild(document.createTextNode('Refitting the whole pipeline with each of the ' + D.fit.train_rows + ' traded protocols held out in turn, the median miss is '));
  var bb = el('b', null, '×' + D.fit.loo_median_factor.toFixed(2));
  bt.appendChild(bb);
  bt.appendChild(document.createTextNode(' — half of the held-out market caps land within that factor of the model\u2019s price, and ' + D.fit.loo_within_3x_pct + '% land within ×3. The naive baseline, one median multiple for every protocol, misses by ×' + D.fit.baseline_median_factor.toFixed(2) + ' at the median. Log-scale R² of the full fit: ' + D.fit.r2_log.toFixed(2) + '. Launch valuations are noisy; this board is a ranking with its error stated, not a price list.'));

  // ---- controls ------------------------------------------------------------
  var state = {
    q: params.get('q') || '',
    family: params.get('family') || 'all',
    chain: params.get('chain') || 'all',
    tier: params.get('tier') || 'all',
    sort: params.get('sort') || 'value',
    detail: params.get('detail') || null,
  };

  var famSel = $('family');
  famSel.appendChild(new Option('All families', 'all'));
  var famCount = {};
  D.rows.forEach(function (r) { famCount[r.family] = (famCount[r.family] || 0) + 1; });
  Object.keys(famCount).sort().forEach(function (f) { famSel.appendChild(new Option(f + ' (' + famCount[f] + ')', f)); });
  famSel.value = state.family;

  var chainSel = $('chain');
  chainSel.appendChild(new Option('All chains', 'all'));
  var chainCount = {};
  D.rows.forEach(function (r) { r.chains.forEach(function (c) { chainCount[c] = (chainCount[c] || 0) + 1; }); });
  Object.keys(chainCount).sort(function (a, c) { return chainCount[c] - chainCount[a]; }).forEach(function (c) {
    chainSel.appendChild(new Option(c + ' (' + chainCount[c] + ')', c));
  });
  chainSel.value = state.chain;

  $('q').value = state.q;
  $('sort').value = state.sort;
  var segButtons = Array.prototype.slice.call(document.querySelectorAll('.seg button'));
  segButtons.forEach(function (btn) {
    btn.classList.toggle('on', btn.getAttribute('data-tier') === state.tier);
    btn.addEventListener('click', function () {
      state.tier = btn.getAttribute('data-tier');
      segButtons.forEach(function (x) { x.classList.toggle('on', x === btn); });
      render();
    });
  });
  $('q').addEventListener('input', function () { state.q = $('q').value; render(); });
  famSel.addEventListener('change', function () { state.family = famSel.value; render(); });
  chainSel.addEventListener('change', function () { state.chain = chainSel.value; render(); });
  $('sort').addEventListener('change', function () { state.sort = $('sort').value; render(); });

  function filtered() {
    var q = state.q.trim().toLowerCase();
    var out = D.rows.filter(function (r) {
      if (state.tier === 'watchlist' && !r.watchlist) return false;
      if (state.tier === 'early' && r.watchlist) return false;
      if (state.family !== 'all' && r.family !== state.family) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (q) {
        var hay = (r.name + ' ' + (r.category || '') + ' ' + r.family + ' ' + r.chains.join(' ')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    var by = {
      value: function (a, c) { return c.implied_value_usd - a.implied_value_usd; },
      tvl: function (a, c) { return c.tvl_usd - a.tvl_usd; },
      growth: function (a, c) { return (c.change_7d || 0) - (a.change_7d || 0); },
      age: function (a, c) { return (c.age_days || 0) - (a.age_days || 0); },
      multiple: function (a, c) { return c.implied_value_usd / c.tvl_usd - a.implied_value_usd / a.tvl_usd; },
    };
    out.sort(by[state.sort] || by.value);
    return out;
  }

  // ---- detail ---------------------------------------------------------------
  function showDetail(row) {
    state.detail = row.slug;
    var d = $('detail');
    d.innerHTML = '';
    var h = el('h3', null, row.name);
    var chip = el('span', 'chip ' + (row.watchlist ? 'wl' : 'early'), row.watchlist ? 'WATCHLIST' : 'EARLY FIND');
    h.appendChild(chip);
    d.appendChild(h);
    d.appendChild(el('p', 'tier-line',
      (row.category || 'Uncategorised') + ' · ' + row.family + ' · rank #' + row.rank + ' of ' + D.board_size +
      (row.watchlist
        ? ' · on the house watchlist: TVL at or above the $50M floor, no token recorded'
        : ' · early find: below the $50M floor, no token recorded, through the product rule')));

    var big = el('div', 'big');
    big.appendChild(el('span', null, 'Implied launch value'));
    big.appendChild(document.createTextNode(moneyFull(row.implied_value_usd)));
    d.appendChild(big);

    var base = row.tvl_usd * row.base_multiple;
    var table = el('table', 'decomp');
    var lines = [
      ['TVL (snapshot)', moneyFull(row.tvl_usd)],
      ['Base multiple — ' + row.family, mult(row.base_multiple)],
      ['Base value', moneyFull(base)],
      ['Growth factor (7d ' + pct(row.change_7d) + ')', mult(row.growth_multiplier)],
      ['Age factor (listed ' + (row.age_days === null ? 'date unknown' : commas(row.age_days) + ' days') + ')', mult(row.maturity_multiplier)],
    ];
    lines.forEach(function (ln) {
      var tr = el('tr');
      tr.appendChild(el('td', null, ln[0]));
      tr.appendChild(el('td', 'n', ln[1]));
      table.appendChild(tr);
    });
    var tot = el('tr', 'total');
    tot.appendChild(el('td', null, 'TVL × base × growth × age'));
    tot.appendChild(el('td', 'n', moneyFull(row.implied_value_usd)));
    table.appendChild(tot);
    d.appendChild(table);
    d.appendChild(el('p', 'meta',
      'Chains: ' + row.chains.join(', ') + ' · Listed: ' + (row.listed_at || 'not recorded') +
      ' · Implied multiple: ' + mult(row.implied_value_usd / row.tvl_usd) + ' of TVL'));

    d.appendChild(el('h4', null, 'Farm plan — if a token comes'));
    var ol = el('ol', 'farm');
    row.farm_steps.forEach(function (s) { ol.appendChild(el('li', null, s)); });
    d.appendChild(ol);

    Array.prototype.forEach.call(document.querySelectorAll('#rows tr'), function (tr) {
      tr.classList.toggle('sel', tr.getAttribute('data-slug') === row.slug);
    });
  }

  // ---- board ------------------------------------------------------------------
  function render() {
    var rows = filtered();
    $('count').textContent = 'Showing ' + rows.length + ' of ' + D.board_size + ' rows';
    var tb = $('rows');
    tb.innerHTML = '';
    rows.forEach(function (r) {
      var tr = el('tr');
      tr.setAttribute('data-slug', r.slug);
      tr.appendChild(el('td', 'r', String(r.rank)));
      var nameTd = el('td');
      var nm = el('span', 'pname', r.name);
      nameTd.appendChild(nm);
      nameTd.appendChild(el('span', 'chip ' + (r.watchlist ? 'wl' : 'early'), r.watchlist ? 'WL' : 'EARLY'));
      nameTd.appendChild(el('span', 'pcat', (r.category || 'Uncategorised') + ' · ' + r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '')));
      tr.appendChild(nameTd);
      tr.appendChild(el('td', 'n', money(r.tvl_usd)));
      var g = el('td', 'n' + (r.change_7d === null ? '' : r.change_7d >= 0 ? ' pos' : ' neg'), pct(r.change_7d));
      tr.appendChild(g);
      tr.appendChild(el('td', 'n', ageText(r.age_days)));
      tr.appendChild(el('td', 'n implied', money(r.implied_value_usd)));
      tr.appendChild(el('td', 'n', mult(r.implied_value_usd / r.tvl_usd)));
      tr.addEventListener('click', function () { showDetail(r); });
      tb.appendChild(tr);
    });
    var current = D.rows.filter(function (r) { return r.slug === state.detail; })[0];
    if (!current) current = rows[0] || D.rows[0];
    if (current) showDetail(current);
  }

  // ---- live ---------------------------------------------------------------------
  var lb = $('live-rows');
  D.live.forEach(function (r) {
    var tr = el('tr');
    var nameTd = el('td');
    nameTd.appendChild(el('span', 'pname', r.name));
    nameTd.appendChild(el('span', 'pcat', (r.category || 'Uncategorised') + ' · ' + r.chains.slice(0, 3).join(', ')));
    tr.appendChild(nameTd);
    tr.appendChild(el('td', 'n', r.mcap_usd === null ? '—' : money(r.mcap_usd)));
    tr.appendChild(el('td', 'n', money(r.tvl_usd)));
    tr.appendChild(el('td', 'n', r.multiple === null ? '—' : mult(r.multiple)));
    tr.appendChild(el('td', 'n' + (r.change_7d === null ? '' : r.change_7d >= 0 ? ' pos' : ' neg'), pct(r.change_7d)));
    lb.appendChild(tr);
  });

  render();
})();
