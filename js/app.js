/* Factures — customers, invoices, settings. Data lives in this browser (localStorage) with JSON backups. */
(function () {
  'use strict';
  const L = window.Lib;
  const KEY = 'factures-v1';
  const $view = document.getElementById('view');
  const $dialog = document.getElementById('dialog');

  /* ---------- data ---------- */

  function defaults() {
    return {
      version: 1,
      settings: {
        company: {
          name: '', owner: '', street: '', city: '', vat: '', bce: '', iban: '', bic: '',
          email: '', phone: '', website: '', thanks: 'Merci de votre confiance !'
        },
        logo: null,
        numbering: { year: new Date().getFullYear(), next: 1, confirmed: false },
        lastBackup: null
      },
      customers: [],
      invoices: []
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (data && data.settings && Array.isArray(data.invoices)) return data;
      }
    } catch (e) { /* fall through to defaults */ }
    return defaults();
  }

  let db = load();
  let storageOk = true;

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
      storageOk = true;
    } catch (e) {
      storageOk = false;
      toast('Impossible d’enregistrer dans ce navigateur. Exportez une sauvegarde depuis Réglages.');
    }
  }
  save();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  /* ---------- small helpers ---------- */

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const customerById = id => db.customers.find(c => c.id === id);
  const logo = () => db.settings.logo || null;

  let toastTimer;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }

  function weekdays(period) {
    if (!period) return 20;
    const [y, m] = period.split('-').map(Number);
    const days = new Date(y, m, 0).getDate();
    let n = 0;
    for (let d = 1; d <= days; d++) {
      const wd = new Date(y, m - 1, d).getDay();
      if (wd !== 0 && wd !== 6) n++;
    }
    return n;
  }

  function nextSeq(year, ignoreId) {
    const used = db.invoices.filter(i => i.year === year && i.id !== ignoreId).map(i => i.seq);
    const maxUsed = used.length ? Math.max.apply(null, used) : 0;
    const n = db.settings.numbering;
    const fromSettings = n.year === year ? n.next : (n.year > year ? 1 : 1);
    return Math.max(maxUsed + 1, fromSettings);
  }

  function statusOf(inv) {
    if (inv.status === 'paid') return 'paid';
    return inv.dueDate < L.todayISO() ? 'late' : 'open';
  }
  const STATUS_LABEL = { paid: 'Payée', open: 'À payer', late: 'En retard' };

  function workedDaysText(qty) {
    const q = Number(qty) || 0;
    return 'Worked days : ' + (Number.isInteger(q) ? q : L.fmtQty(q));
  }

  /* ---------- routing ---------- */

  const state = { view: 'invoices', filter: 'all', year: 'all', draft: null };

  function go(view) {
    if (state.view === 'editor' && view !== 'editor' && state.draft && state.draft.dirty) {
      if (!confirm('Quitter sans enregistrer cette facture ?')) return;
    }
    state.view = view;
    if (view !== 'editor') state.draft = null;
    render();
    $view.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  function renderBrand() {
    const co = db.settings.company;
    const mark = document.getElementById('brand-mark');
    const initials = (co.name || 'F').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
    mark.innerHTML = logo() ? `<img src="${esc(logo())}" alt="" width="40" height="40">` : `<span class="monogram">${esc(initials)}</span>`;
    document.getElementById('brand-sub').textContent = co.name || 'Votre société';
    document.title = co.name ? 'Factures · ' + co.name : 'Factures';
  }

  function companyReady() {
    const co = db.settings.company;
    return !!(co.name && co.vat && co.iban);
  }

  function render() {
    renderBrand();
    document.querySelectorAll('[data-nav]').forEach(b => {
      const active = b.dataset.nav === state.view || (state.view === 'editor' && b.dataset.nav === 'invoices');
      b.classList.toggle('active', active);
      if (active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    document.querySelector('.new-btn').hidden = state.view === 'editor';
    if (state.view === 'invoices') renderInvoices();
    else if (state.view === 'customers') renderCustomers();
    else if (state.view === 'settings') renderSettings();
    else if (state.view === 'editor') renderEditor();
  }

  /* ---------- invoices list ---------- */

  function numberingBanner() {
    if (!companyReady()) {
      return `<div class="banner">
      <p>Pour commencer, complétez les informations de votre société (nom, TVA, IBAN), ou restaurez une sauvegarde qui les contient déjà.</p>
      <button class="btn small" data-nav="settings" type="button">Ouvrir les réglages</button>
    </div>`;
    }
    if (db.settings.numbering.confirmed) return '';
    const n = db.settings.numbering;
    return `<div class="banner">
      <p>Avant votre première facture, vérifiez le numéro de départ. La prochaine facture portera le numéro <strong>${esc(L.invoiceNumber(n.year, n.next))}</strong>.</p>
      <button class="btn small" data-nav="settings" type="button">Vérifier dans Réglages</button>
    </div>`;
  }

  function renderInvoices() {
    const years = Array.from(new Set(db.invoices.map(i => i.year))).sort((a, b) => b - a);
    let list = db.invoices.slice().sort((a, b) => (b.year - a.year) || (b.seq - a.seq));
    if (state.year !== 'all') list = list.filter(i => String(i.year) === String(state.year));
    if (state.filter !== 'all') list = list.filter(i => state.filter === 'paid' ? statusOf(i) === 'paid' : statusOf(i) !== 'paid');

    const today = L.todayISO();
    const q = Math.floor((Number(today.slice(5, 7)) - 1) / 3);
    const qYear = today.slice(0, 4);
    const inQuarter = db.invoices.filter(i => i.date.slice(0, 4) === qYear && Math.floor((Number(i.date.slice(5, 7)) - 1) / 3) === q);
    const qTot = inQuarter.reduce((s, i) => { const t = L.totals(i); s.htva += t.htva; s.vat += t.vat; return s; }, { htva: 0, vat: 0 });
    const unpaid = db.invoices.filter(i => statusOf(i) !== 'paid');
    const unpaidTotal = unpaid.reduce((s, i) => s + L.totals(i).total, 0);
    const late = unpaid.filter(i => statusOf(i) === 'late');

    $view.innerHTML = `
      <header class="page-head">
        <h1>Factures</h1>
      </header>
      ${numberingBanner()}
      <section class="figures" aria-label="Résumé">
        <div class="figure due">
          <span class="fig-label">À encaisser</span>
          <span class="fig-value">${L.fmtMoney(unpaidTotal)}</span>
          <span class="fig-note">${unpaid.length} facture${unpaid.length > 1 ? 's' : ''} ouverte${unpaid.length > 1 ? 's' : ''}${late.length ? `, dont <b>${late.length} en retard</b>` : ''}</span>
        </div>
        <div class="figure">
          <span class="fig-label">Facturé HTVA, T${q + 1} ${qYear}</span>
          <span class="fig-value">${L.fmtMoney(qTot.htva)}</span>
          <span class="fig-note">${inQuarter.length} facture${inQuarter.length > 1 ? 's' : ''} ce trimestre</span>
        </div>
        <div class="figure">
          <span class="fig-label">TVA facturée, T${q + 1} ${qYear}</span>
          <span class="fig-value">${L.fmtMoney(qTot.vat)}</span>
          <span class="fig-note">Pour votre déclaration TVA</span>
        </div>
      </section>

      <div class="toolbar">
        <div class="seg" role="group" aria-label="Filtrer par statut">
          ${[['all', 'Toutes'], ['open', 'À payer'], ['paid', 'Payées']].map(([k, l]) =>
            `<button type="button" data-filter="${k}" class="${state.filter === k ? 'on' : ''}" aria-pressed="${state.filter === k}">${l}</button>`).join('')}
        </div>
        ${years.length > 1 ? `<label class="inline">Année
          <select data-year>${['all'].concat(years).map(y => `<option value="${y}" ${String(state.year) === String(y) ? 'selected' : ''}>${y === 'all' ? 'Toutes' : y}</option>`).join('')}</select>
        </label>` : ''}
      </div>

      ${list.length ? `
      <div class="table-wrap">
        <table class="list">
          <thead><tr>
            <th scope="col">N°</th><th scope="col">Client</th><th scope="col">Date</th><th scope="col">Échéance</th>
            <th scope="col" class="num">Total TVAC</th><th scope="col">Statut</th><th scope="col"><span class="sr">Actions</span></th>
          </tr></thead>
          <tbody>
          ${list.map(inv => {
            const st = statusOf(inv);
            return `<tr>
              <td class="mono-num"><button class="linkish" type="button" data-edit="${inv.id}">${esc(inv.number)}</button></td>
              <td>${esc(inv.customer.name)}<span class="sub">${esc(inv.lines[0] ? L.periodLabel(inv.period) || inv.lines[0].desc : '')}</span></td>
              <td>${L.fmtDate(inv.date)}</td>
              <td>${L.fmtDate(inv.dueDate)}</td>
              <td class="num">${L.fmtMoney(L.totals(inv).total)}</td>
              <td><button type="button" class="pill ${st}" data-toggle-paid="${inv.id}" title="${st === 'paid' ? 'Marquer comme non payée' : 'Marquer comme payée'}">${STATUS_LABEL[st]}</button></td>
              <td class="row-actions">
                <button class="btn small" type="button" data-download="${inv.id}">PDF</button>
                <details class="menu">
                  <summary class="btn small ghost" aria-label="Plus d’actions">…</summary>
                  <div class="menu-pop">
                    <button type="button" data-edit="${inv.id}">Modifier</button>
                    <button type="button" data-duplicate="${inv.id}">Dupliquer pour le mois suivant</button>
                    <button type="button" data-toggle-paid="${inv.id}">${st === 'paid' ? 'Marquer non payée' : 'Marquer payée'}</button>
                    <button type="button" class="danger" data-delete="${inv.id}">Supprimer</button>
                  </div>
                </details>
              </td>
            </tr>`;
          }).join('')}
          </tbody>
        </table>
      </div>` : `
      <div class="empty">
        <p>${db.invoices.length ? 'Aucune facture ne correspond à ce filtre.' : 'Aucune facture pour l’instant. Choisissez un client, indiquez vos jours prestés, et le PDF est prêt.'}</p>
        ${db.invoices.length ? '' : '<button class="btn primary" type="button" data-action="new-invoice">Créer la première facture</button>'}
      </div>`}
    `;
  }

  /* ---------- editor ---------- */

  function lineForCustomer(c, period) {
    const tpl = (c && c.description) || 'Senior Servicenow Consultancy';
    const desc = tpl.replace(/\{mois\}/gi, L.periodLabel(period));
    if (c && c.billing === 'flat') return { tpl, desc, sub: '', subAuto: false, qty: 1, price: Number(c.rate) || 0 };
    const qty = weekdays(period);
    return { tpl, desc, sub: workedDaysText(qty), subAuto: true, qty, price: c ? Number(c.rate) || 0 : 0 };
  }

  function newDraft(customerId) {
    const date = L.todayISO();
    const year = Number(date.slice(0, 4));
    const seq = nextSeq(year);
    const c = customerById(customerId) || null;
    const d = {
      id: null, year, seq, number: L.invoiceNumber(year, seq), numberManual: false,
      customerId: c ? c.id : '', date, period: L.previousPeriod(date),
      dueDate: '', dueManual: false, lines: [], vatRate: 21, vatMention: '', vatManual: false,
      communication: '', commManual: false, status: 'unpaid', dirty: false
    };
    applyCustomer(d, c);
    return d;
  }

  function applyCustomer(d, c) {
    d.customerId = c ? c.id : '';
    d.lines = [lineForCustomer(c, d.period)];
    if (!c) d.lines[0].price = 0;
    d.vatManual = false;
    d.dueManual = false;
    d.commManual = false;
    recompute(d);
  }

  function recompute(d) {
    const c = customerById(d.customerId);
    // number
    const year = Number(String(d.date).slice(0, 4)) || new Date().getFullYear();
    if (!d.numberManual) {
      if (!d.id || d.year !== year) {
        d.year = year;
        d.seq = nextSeq(year, d.id);
      }
      d.number = L.invoiceNumber(d.year, d.seq);
    }
    // VAT
    if (!d.vatManual) {
      const r = L.vatRegime(c ? c.country : 'BE');
      d.vatRate = r.rate;
      d.vatMention = r.mention;
    }
    // due date
    if (!d.dueManual) d.dueDate = L.dueDate(c ? c.terms : { type: 'days', days: 30 }, d.date, d.period);
    // communication
    if (!d.commManual) {
      const be = !c || c.country === 'BE';
      d.communication = be ? L.ogm(d.year, d.seq) : 'Facture ' + d.number;
    }
    // line descriptions that follow the month
    d.lines.forEach(l => {
      if (l.tpl) l.desc = l.tpl.replace(/\{mois\}/gi, L.periodLabel(d.period));
      if (l.subAuto) l.sub = workedDaysText(l.qty);
    });
  }

  function draftAsInvoice(d) {
    const c = customerById(d.customerId) || { name: '', street: '', city: '', country: 'BE', vat: '', bce: '' };
    return {
      number: d.number, date: d.date, dueDate: d.dueDate, period: d.period,
      customer: { name: c.name, street: c.street, city: c.city, country: c.country, vat: c.vat, bce: c.bce },
      lines: d.lines.map(l => ({ desc: l.desc, sub: l.sub, qty: Number(l.qty) || 0, price: Number(l.price) || 0 })),
      vatRate: Number(d.vatRate) || 0, vatMention: d.vatMention, communication: d.communication
    };
  }

  function renderEditor() {
    const d = state.draft;
    const c = customerById(d.customerId);
    const regime = L.vatRegime(c ? c.country : 'BE');
    const t = L.totals(draftAsInvoice(d));
    const existing = !!d.id;

    $view.innerHTML = `
      <div class="editor">
        <section class="form-col" aria-label="Facture">
          <header class="page-head">
            <button class="back" type="button" data-nav="invoices">Factures</button>
            <h1>${existing ? 'Facture ' + esc(d.number) : 'Nouvelle facture'}</h1>
          </header>
          ${existing ? '' : numberingBanner()}

          <fieldset class="block">
            <legend>Client</legend>
            ${db.customers.length ? `
            <div class="row">
              <label class="grow">Facturer à
                <select data-f="customerId" required>
                  <option value="">Choisir un client…</option>
                  ${db.customers.slice().sort((a, b) => a.name.localeCompare(b.name)).map(x =>
                    `<option value="${x.id}" ${x.id === d.customerId ? 'selected' : ''}>${esc(x.name)} · ${esc(L.countryName(x.country))}</option>`).join('')}
                </select>
              </label>
              <button class="btn ghost" type="button" data-action="new-customer-from-editor">Nouveau client</button>
            </div>
            ${c ? `<p class="hint">${esc([c.street, c.city, L.countryName(c.country)].filter(Boolean).join(', '))}${c.vat ? ' · TVA ' + esc(c.vat) : ''}<br>Paiement : ${esc(L.termsLabel(c.terms))}</p>` : ''}
            ` : `<p class="hint">Vous n’avez pas encore de client.</p>
                 <button class="btn primary" type="button" data-action="new-customer-from-editor">Créer un client</button>`}
          </fieldset>

          <fieldset class="block">
            <legend>Période et dates</legend>
            <div class="grid3">
              <label>Mois presté
                <input type="month" data-f="period" value="${esc(d.period)}">
              </label>
              <label>Date de facture
                <input type="date" data-f="date" value="${esc(d.date)}" required>
              </label>
              <label>Échéance
                <input type="date" data-f="dueDate" value="${esc(d.dueDate)}" required>
              </label>
            </div>
            ${d.dueManual ? `<p class="hint">Échéance modifiée à la main. <button class="linkish" type="button" data-reset="due">Revenir aux conditions du client</button></p>` : ''}
          </fieldset>

          <fieldset class="block">
            <legend>Prestations</legend>
            <div class="lines">
              ${d.lines.map((l, i) => `
              <div class="line" data-line="${i}">
                <label class="l-desc">Description
                  <input type="text" data-l="desc" value="${esc(l.desc)}" placeholder="Senior Servicenow Consultancy">
                </label>
                <label class="l-sub">Détail <span class="opt">optionnel</span>
                  <input type="text" data-l="sub" value="${esc(l.sub)}" placeholder="Worked days : 20">
                </label>
                <label class="l-qty">${l.subAuto ? 'Jours prestés' : 'Quantité'}
                  <input type="number" inputmode="decimal" step="0.5" min="0" data-l="qty" value="${esc(l.qty)}">
                </label>
                <label class="l-price">${l.subAuto ? 'Tarif journalier' : 'Prix unitaire'}
                  <span class="suffix"><input type="number" inputmode="decimal" step="0.01" min="0" data-l="price" value="${esc(l.price)}"><i>€</i></span>
                </label>
                <div class="l-amount" aria-label="Montant">${L.fmtMoney(L.lineCents(l))}</div>
                ${d.lines.length > 1 ? `<button class="icon-btn" type="button" data-remove-line="${i}" aria-label="Retirer cette ligne">×</button>` : ''}
              </div>`).join('')}
            </div>
            <button class="btn ghost small" type="button" data-action="add-line">Ajouter une ligne</button>
          </fieldset>

          <fieldset class="block">
            <legend>TVA et paiement</legend>
            <div class="grid2">
              <label>Taux de TVA
                <select data-f="vatRate">
                  <option value="21" ${Number(d.vatRate) === 21 ? 'selected' : ''}>21 %</option>
                  <option value="0" ${Number(d.vatRate) === 0 ? 'selected' : ''}>0 %</option>
                </select>
              </label>
              <label>Communication
                <input type="text" data-f="communication" value="${esc(d.communication)}">
              </label>
            </div>
            <p class="hint">${c ? esc(regime.label) : 'Le taux suit le pays du client.'}${d.vatManual ? ` · modifié à la main. <button class="linkish" type="button" data-reset="vat">Revenir au taux du pays</button>` : ''}</p>
            ${Number(d.vatRate) === 0 ? `
            <label>Mention légale imprimée sur la facture
              <textarea data-f="vatMention" rows="2">${esc(d.vatMention)}</textarea>
            </label>` : ''}
            ${d.commManual ? `<p class="hint">Communication modifiée à la main. <button class="linkish" type="button" data-reset="comm">Régénérer</button></p>` : ''}
          </fieldset>

          <fieldset class="block">
            <legend>Numéro</legend>
            <div class="grid2">
              <label>Numéro de facture
                <input type="text" data-f="number" value="${esc(d.number)}" pattern="\\d{4}/\\d{1,6}" required>
              </label>
              <div class="total-box" aria-live="polite">
                <span>Total à payer</span>
                <strong>${L.fmtMoney(t.total)}</strong>
                <small>${L.fmtMoney(t.htva)} HTVA + ${L.fmtMoney(t.vat)} TVA</small>
              </div>
            </div>
          </fieldset>

          <div class="actions sticky">
            <button class="btn primary" type="button" data-action="save-download" ${c ? '' : 'disabled'}>Enregistrer et télécharger le PDF</button>
            <button class="btn" type="button" data-action="save" ${c ? '' : 'disabled'}>Enregistrer</button>
          </div>
        </section>

        <section class="desk" aria-label="Aperçu de la facture">
          <div class="desk-head">
            <span>Aperçu</span>
            <span class="desk-file">${esc(window.InvoicePDF.fileName(d))}</span>
          </div>
          <div class="paper-frame"><iframe id="preview" title="Aperçu PDF de la facture"></iframe></div>
        </section>
      </div>
    `;
    schedulePreview(0);
  }

  let previewTimer, previewUrl;
  function schedulePreview(delay) {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      const frame = document.getElementById('preview');
      if (!frame || !state.draft) return;
      try {
        const doc = window.InvoicePDF.build(draftAsInvoice(state.draft), db.settings.company, logo());
        const url = doc.output('bloburl');
        frame.src = url + '#toolbar=0&navpanes=0&view=FitH';
        if (previewUrl) setTimeout(((u) => () => URL.revokeObjectURL(u))(previewUrl), 4000);
        previewUrl = url;
      } catch (e) {
        console.error(e);
      }
    }, delay == null ? 350 : delay);
  }

  /* Update totals/amounts in place without re-rendering inputs (keeps focus while typing). */
  function refreshEditorNumbers() {
    const d = state.draft;
    const t = L.totals(draftAsInvoice(d));
    document.querySelectorAll('[data-line]').forEach(el => {
      const l = d.lines[Number(el.dataset.line)];
      if (!l) return;
      el.querySelector('.l-amount').textContent = L.fmtMoney(L.lineCents(l));
      const sub = el.querySelector('[data-l="sub"]');
      if (l.subAuto && sub && document.activeElement !== sub) sub.value = l.sub;
    });
    const box = document.querySelector('.total-box');
    if (box) {
      box.querySelector('strong').textContent = L.fmtMoney(t.total);
      box.querySelector('small').textContent = L.fmtMoney(t.htva) + ' HTVA + ' + L.fmtMoney(t.vat) + ' TVA';
    }
    const file = document.querySelector('.desk-file');
    if (file) file.textContent = window.InvoicePDF.fileName(d);
    schedulePreview();
  }

  function validateDraft(d) {
    if (!companyReady()) return 'Complétez d’abord votre société dans Réglages (nom, TVA, IBAN).';
    if (!customerById(d.customerId)) return 'Choisissez un client.';
    const m = /^(\d{4})\/(\d{1,6})$/.exec(String(d.number).trim());
    if (!m) return 'Le numéro doit avoir la forme 2026/047.';
    const year = Number(m[1]), seq = Number(m[2]);
    if (db.invoices.some(i => i.id !== d.id && i.year === year && i.seq === seq)) return 'Le numéro ' + d.number + ' existe déjà.';
    if (!d.date || !d.dueDate) return 'Indiquez la date et l’échéance.';
    if (!d.lines.length || d.lines.every(l => !l.desc)) return 'Ajoutez au moins une prestation.';
    return null;
  }

  function saveDraft() {
    const d = state.draft;
    const err = validateDraft(d);
    if (err) { toast(err); return null; }
    const m = /^(\d{4})\/(\d{1,6})$/.exec(String(d.number).trim());
    const year = Number(m[1]), seq = Number(m[2]);
    const inv = draftAsInvoice(d);
    const now = new Date().toISOString();
    const record = Object.assign({}, inv, {
      id: d.id || L.uid(), year, seq, number: L.invoiceNumber(year, seq), customerId: d.customerId,
      company: Object.assign({}, db.settings.company),
      status: d.status || 'unpaid', paidAt: d.paidAt || null,
      createdAt: d.createdAt || now, updatedAt: now,
      flags: { vatManual: d.vatManual, dueManual: d.dueManual, commManual: d.commManual }
    });
    const idx = db.invoices.findIndex(i => i.id === record.id);
    if (idx >= 0) db.invoices[idx] = record; else db.invoices.push(record);

    const n = db.settings.numbering;
    if (year > n.year) { n.year = year; n.next = seq + 1; }
    else if (year === n.year && seq >= n.next) n.next = seq + 1;
    n.confirmed = true;
    save();
    d.id = record.id; d.dirty = false; d.createdAt = record.createdAt;
    return record;
  }

  function draftFromInvoice(inv) {
    const f = inv.flags || {};
    return {
      id: inv.id, year: inv.year, seq: inv.seq, number: inv.number, numberManual: true,
      customerId: inv.customerId, date: inv.date, period: inv.period || '', dueDate: inv.dueDate,
      dueManual: true, lines: inv.lines.map(l => ({ desc: l.desc, sub: l.sub, qty: l.qty, price: l.price, subAuto: false, tpl: null })),
      vatRate: inv.vatRate, vatMention: inv.vatMention || '', vatManual: true, communication: inv.communication,
      commManual: true, status: inv.status, paidAt: inv.paidAt, createdAt: inv.createdAt, dirty: false, _flags: f
    };
  }

  function downloadInvoice(inv) {
    const company = Object.assign({}, db.settings.company, inv.company || {});
    const doc = window.InvoicePDF.build(inv, company, logo());
    doc.save(window.InvoicePDF.fileName(inv));
  }

  /* ---------- customers ---------- */

  function renderCustomers() {
    const list = db.customers.slice().sort((a, b) => a.name.localeCompare(b.name));
    $view.innerHTML = `
      <header class="page-head">
        <h1>Clients</h1>
        <button class="btn" type="button" data-action="new-customer">Ajouter un client</button>
      </header>
      ${list.length ? `
      <div class="cards">
        ${list.map(c => {
          const r = L.vatRegime(c.country);
          const count = db.invoices.filter(i => i.customerId === c.id).length;
          return `<article class="cust">
            <div class="cust-main">
              <h2>${esc(c.name)}</h2>
              <p>${esc([c.street, c.city].filter(Boolean).join(', '))}<br>${esc(L.countryName(c.country))}${c.vat ? ' · TVA ' + esc(c.vat) : ''}</p>
            </div>
            <dl class="cust-facts">
              <div><dt>${c.billing === 'flat' ? 'Forfait' : 'Tarif journalier'}</dt><dd>${L.fmtMoney(L.toCents(c.rate))}</dd></div>
              <div><dt>TVA</dt><dd>${r.rate} %</dd></div>
              <div><dt>Paiement</dt><dd>${esc(L.termsLabel(c.terms))}</dd></div>
              <div><dt>Factures</dt><dd>${count}</dd></div>
            </dl>
            <div class="cust-actions">
              <button class="btn primary small" type="button" data-invoice-customer="${c.id}">Facturer</button>
              <button class="btn small" type="button" data-edit-customer="${c.id}">Modifier</button>
            </div>
          </article>`;
        }).join('')}
      </div>` : `<div class="empty"><p>Ajoutez votre premier client pour commencer à facturer.</p>
        <button class="btn primary" type="button" data-action="new-customer">Ajouter un client</button></div>`}
    `;
  }

  function openCustomerDialog(id, onSaved) {
    const c = id ? customerById(id) : {
      id: null, name: '', street: '', city: '', country: 'BE', vat: '', bce: '', email: '',
      billing: 'day', rate: '', description: 'Senior Servicenow Consultancy', terms: { type: 'eom_next', days: 30 }
    };
    const terms = c.terms || { type: 'days', days: 30 };
    $dialog.innerHTML = `
      <form method="dialog" class="dlg" id="cust-form" novalidate>
        <header><h2>${id ? 'Modifier le client' : 'Nouveau client'}</h2>
          <button type="button" class="icon-btn" data-close aria-label="Fermer">×</button></header>
        <div class="dlg-body">
          <label>Nom de la société
            <input name="name" value="${esc(c.name)}" required autocomplete="organization">
          </label>
          <div class="grid2">
            <label>Rue et numéro <input name="street" value="${esc(c.street)}"></label>
            <label>Code postal et ville <input name="city" value="${esc(c.city)}" placeholder="1020 Bruxelles"></label>
          </div>
          <div class="grid2">
            <label>Pays
              <select name="country">${L.COUNTRIES.map(([k, v]) => `<option value="${k}" ${c.country === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
            </label>
            <label>N° de TVA <input name="vat" value="${esc(c.vat)}" placeholder="BE1015419556"></label>
          </div>
          <p class="hint" id="vat-hint"></p>
          <div class="grid2">
            <label>N° d’entreprise (BCE) <span class="opt">optionnel</span><input name="bce" value="${esc(c.bce)}"></label>
            <label>E-mail facturation <span class="opt">optionnel</span><input name="email" type="email" value="${esc(c.email)}"></label>
          </div>

          <h3>Facturation par défaut</h3>
          <div class="grid2">
            <label>Mode
              <select name="billing">
                <option value="day" ${c.billing !== 'flat' ? 'selected' : ''}>Au jour presté</option>
                <option value="flat" ${c.billing === 'flat' ? 'selected' : ''}>Montant forfaitaire</option>
              </select>
            </label>
            <label><span data-rate-label>${c.billing === 'flat' ? 'Montant' : 'Tarif journalier'}</span>
              <span class="suffix"><input name="rate" type="number" step="0.01" min="0" value="${esc(c.rate)}" required><i>€</i></span>
            </label>
          </div>
          <label>Description sur la facture
            <input name="description" value="${esc(c.description)}">
          </label>
          <p class="hint">Écrivez {mois} pour insérer le mois presté, par exemple « Frais Bureau {mois} ».</p>

          <h3>Conditions de paiement</h3>
          <div class="grid2">
            <label>Échéance
              <select name="termsType">
                <option value="eom_next" ${terms.type === 'eom_next' ? 'selected' : ''}>Fin du mois suivant la prestation</option>
                <option value="days" ${terms.type !== 'eom_next' ? 'selected' : ''}>Nombre de jours après la facture</option>
              </select>
            </label>
            <label data-days ${terms.type === 'eom_next' ? 'hidden' : ''}>Jours
              <input name="termsDays" type="number" min="0" step="1" value="${esc(terms.days == null ? 30 : terms.days)}">
            </label>
          </div>
          <p class="hint" id="terms-hint"></p>
        </div>
        <footer>
          ${id && !db.invoices.some(i => i.customerId === id) ? `<button type="button" class="btn ghost danger" data-delete-customer="${id}">Supprimer</button>` : '<span></span>'}
          <div>
            <button type="button" class="btn ghost" data-close>Annuler</button>
            <button type="submit" class="btn primary">${id ? 'Enregistrer' : 'Ajouter le client'}</button>
          </div>
        </footer>
      </form>`;
    const form = $dialog.querySelector('form');
    const F = n => form.elements.namedItem(n);

    const updateHints = () => {
      const country = F('country').value;
      const r = L.vatRegime(country);
      form.querySelector('#vat-hint').textContent = r.rate
        ? 'Client belge : TVA 21 % sur chaque facture.'
        : (L.isEU(country)
          ? 'Client UE : TVA 0 % en autoliquidation. Son n° de TVA doit figurer sur la facture.'
          : 'Client hors UE : TVA 0 %, mention « non soumise à la TVA belge » ajoutée.');
      const flat = F('billing').value === 'flat';
      form.querySelector('[data-rate-label]').textContent = flat ? 'Montant' : 'Tarif journalier';
      const eom = F('termsType').value === 'eom_next';
      form.querySelector('[data-days]').hidden = eom;
      const ex = eom ? 'Exemple : septembre presté, à payer avant le 31 octobre.'
        : 'Exemple : facture du 12/10, à payer avant le ' + L.fmtDate(L.addDays('2026-10-12', F('termsDays').value || 0)) + '.';
      form.querySelector('#terms-hint').textContent = ex;
    };
    form.addEventListener('input', updateHints);
    form.addEventListener('change', updateHints);
    updateHints();

    form.addEventListener('submit', e => {
      e.preventDefault();
            if (!F('name').value.trim()) { F('name').focus(); toast('Indiquez le nom du client.'); return; }
      if (F('rate').value === '' || Number(F('rate').value) < 0) { F('rate').focus(); toast('Indiquez le tarif.'); return; }
      const country = F('country').value;
      if (country !== 'BE' && L.isEU(country) && !F('vat').value.trim()) {
        if (!confirm('Un client UE sans numéro de TVA ne peut pas être facturé en autoliquidation. Continuer quand même ?')) return;
      }
      const data = {
        id: c.id || L.uid(), name: F('name').value.trim(), street: F('street').value.trim(), city: F('city').value.trim(),
        country, vat: F('vat').value.replace(/\s+/g, '').toUpperCase(), bce: F('bce').value.trim(), email: F('email').value.trim(),
        billing: F('billing').value, rate: Number(F('rate').value), description: F('description').value.trim(),
        terms: F('termsType').value === 'eom_next' ? { type: 'eom_next', months: 1 } : { type: 'days', days: Number(F('termsDays').value || 0) }
      };
      const idx = db.customers.findIndex(x => x.id === data.id);
      if (idx >= 0) db.customers[idx] = data; else db.customers.push(data);
      save();
      $dialog.close();
      toast(id ? 'Client enregistré.' : 'Client ajouté.');
      if (onSaved) onSaved(data); else render();
    });
    $dialog.showModal();
    setTimeout(() => F('name').focus(), 30);
  }

  /* ---------- settings ---------- */

  function renderSettings() {
    const s = db.settings, co = s.company, n = s.numbering;
    const field = (name, label, opt) => `<label>${label}${opt ? ' <span class="opt">optionnel</span>' : ''}<input name="${name}" value="${esc(co[name])}"></label>`;
    $view.innerHTML = `
      <header class="page-head"><h1>Réglages</h1></header>

      <form class="block settings" id="numbering-form">
        <h2>Numérotation</h2>
        <p class="hint">Les numéros se suivent sans trou : ${esc(L.invoiceNumber(n.year, n.next))}, puis ${esc(L.invoiceNumber(n.year, n.next + 1))}… Au changement d’année, la numérotation repart à 001.</p>
        <div class="grid3">
          <label>Année <input name="year" type="number" min="2000" max="2100" value="${n.year}"></label>
          <label>Prochain numéro <input name="next" type="number" min="1" value="${n.next}"></label>
          <div class="preview-num"><span>Prochaine facture</span><strong id="num-preview">${esc(L.invoiceNumber(n.year, n.next))}</strong></div>
        </div>
        <button class="btn primary" type="submit">${n.confirmed ? 'Enregistrer' : 'Confirmer ce numéro'}</button>
      </form>

      <form class="block settings" id="company-form">
        <h2>Votre société</h2>
        <p class="hint">Imprimé en haut de chaque facture.</p>
        <div class="logo-row">
          ${logo() ? `<img src="${esc(logo())}" alt="Logo actuel" width="72" height="72">` : '<span class="logo-empty">Aucun logo</span>'}
          <label class="btn small">Changer le logo<input type="file" accept="image/png,image/jpeg" id="logo-input" hidden></label>
          ${s.logo ? '<button class="btn small ghost" type="button" data-action="reset-logo">Retirer le logo</button>' : ''}
        </div>
        <div class="grid2">${field('name', 'Nom de la société')}${field('owner', 'Nom du gérant')}</div>
        <div class="grid2">${field('street', 'Rue et numéro')}${field('city', 'Code postal et ville')}</div>
        <div class="grid2">${field('vat', 'N° de TVA')}${field('bce', 'N° BCE')}</div>
        <div class="grid2">${field('iban', 'IBAN')}${field('bic', 'BIC')}</div>
        <div class="grid3">${field('email', 'E-mail', 1)}${field('phone', 'Téléphone', 1)}${field('website', 'Site web', 1)}</div>
        <p class="hint">E-mail, téléphone et site s’affichent en pied de page s’ils sont remplis.</p>
        ${field('thanks', 'Phrase de fin')}
        <button class="btn primary" type="submit">Enregistrer</button>
      </form>

      <section class="block settings">
        <h2>Sauvegarde</h2>
        <p class="hint">Vos clients et factures sont stockés dans ce navigateur, sur cet ordinateur. Exportez une sauvegarde régulièrement et gardez-la dans iCloud Drive ou OneDrive : elle permet aussi de tout retrouver sur un autre ordinateur.</p>
        <p class="backup-state">${s.lastBackup ? 'Dernière sauvegarde : ' + L.fmtDate(s.lastBackup.slice(0, 10)) : 'Aucune sauvegarde exportée pour l’instant.'}${storageOk ? '' : ' <b>Attention : l’enregistrement local échoue.</b>'}</p>
        <div class="row">
          <button class="btn primary" type="button" data-action="export">Exporter une sauvegarde</button>
          <label class="btn">Restaurer une sauvegarde<input type="file" accept="application/json,.json" id="import-input" hidden></label>
        </div>
      </section>
    `;

    const nf = document.getElementById('numbering-form');
    nf.addEventListener('input', () => {
      document.getElementById('num-preview').textContent = L.invoiceNumber(Number(nf.elements.namedItem('year').value) || n.year, Number(nf.elements.namedItem('next').value) || 1);
    });
    nf.addEventListener('submit', e => {
      e.preventDefault();
      const year = Number(nf.elements.namedItem('year').value), next = Number(nf.elements.namedItem('next').value);
      if (!year || !next || next < 1) { toast('Indiquez une année et un numéro valides.'); return; }
      const clash = db.invoices.find(i => i.year === year && i.seq >= next);
      if (clash && !confirm('La facture ' + clash.number + ' existe déjà. Le prochain numéro serait donc ' + L.invoiceNumber(year, nextSeqWith(year, next)) + '. Continuer ?')) return;
      db.settings.numbering = { year, next, confirmed: true };
      save();
      toast('Prochaine facture : ' + L.invoiceNumber(year, nextSeq(year)));
      renderSettings();
    });

    const cf = document.getElementById('company-form');
    cf.addEventListener('submit', e => {
      e.preventDefault();
      Object.keys(co).forEach(k => { const el = cf.elements.namedItem(k); if (el) co[k] = el.value.trim(); });
      save();
      toast('Informations de la société enregistrées.');
      renderBrand();
    });

    document.getElementById('logo-input').addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const size = 300, canvas = document.createElement('canvas');
          canvas.width = canvas.height = size;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
          const r = Math.min(size / img.width, size / img.height);
          const w = img.width * r, h = img.height * r;
          ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
          db.settings.logo = canvas.toDataURL('image/jpeg', 0.9);
          save();
          toast('Logo mis à jour.');
          renderBrand();
          renderSettings();
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });

    document.getElementById('import-input').addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      file.text().then(txt => {
        let data;
        try { data = JSON.parse(txt); } catch (err) { toast('Ce fichier n’est pas une sauvegarde valide.'); return; }
        if (!data || !data.settings || !Array.isArray(data.invoices) || !Array.isArray(data.customers)) {
          toast('Ce fichier n’est pas une sauvegarde de Factures.'); return;
        }
        if (!confirm('Remplacer les données actuelles par cette sauvegarde (' + data.customers.length + ' clients, ' + data.invoices.length + ' factures) ?')) return;
        db = data;
        save();
        toast('Sauvegarde restaurée.');
        renderBrand();
        renderSettings();
      });
    });
  }

  function nextSeqWith(year, next) {
    const used = db.invoices.filter(i => i.year === year).map(i => i.seq);
    return Math.max(next, used.length ? Math.max.apply(null, used) + 1 : 1);
  }

  function exportBackup() {
    db.settings.lastBackup = new Date().toISOString();
    save();
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'factures-sauvegarde-' + L.todayISO() + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast('Sauvegarde exportée.');
    if (state.view === 'settings') renderSettings();
  }

  /* ---------- events ---------- */

  function startInvoice(customerId) {
    state.draft = newDraft(customerId);
    state.view = 'editor';
    render();
    window.scrollTo(0, 0);
  }

  document.addEventListener('click', e => {
    const t = e.target.closest('button, [data-nav]');
    if (!t) return;
    const ds = t.dataset;

    // close any open overflow menu after an action
    const menu = t.closest('details.menu');
    if (menu && !t.matches('summary')) menu.open = false;

    if (ds.nav) { go(ds.nav); return; }
    if (ds.close !== undefined) { $dialog.close(); return; }
    if (ds.filter) { state.filter = ds.filter; renderInvoices(); return; }

    if (ds.action === 'new-invoice') { if (state.view === 'editor' && state.draft && state.draft.dirty && !confirm('Abandonner la facture en cours ?')) return; startInvoice(); return; }
    if (ds.action === 'new-customer') { openCustomerDialog(null); return; }
    if (ds.action === 'new-customer-from-editor') {
      openCustomerDialog(null, c => { applyCustomer(state.draft, c); state.draft.dirty = true; renderEditor(); });
      return;
    }
    if (ds.action === 'export') { exportBackup(); return; }
    if (ds.action === 'reset-logo') { db.settings.logo = null; save(); renderBrand(); renderSettings(); return; }

    if (ds.invoiceCustomer) { startInvoice(ds.invoiceCustomer); return; }
    if (ds.editCustomer) { openCustomerDialog(ds.editCustomer); return; }
    if (ds.deleteCustomer) {
      if (confirm('Supprimer ce client ?')) {
        db.customers = db.customers.filter(c => c.id !== ds.deleteCustomer);
        save(); $dialog.close(); render();
      }
      return;
    }

    if (ds.edit) {
      const inv = db.invoices.find(i => i.id === ds.edit);
      if (inv) { state.draft = draftFromInvoice(inv); state.view = 'editor'; render(); window.scrollTo(0, 0); }
      return;
    }
    if (ds.download) {
      const inv = db.invoices.find(i => i.id === ds.download);
      if (inv) downloadInvoice(inv);
      return;
    }
    if (ds.togglePaid) {
      const inv = db.invoices.find(i => i.id === ds.togglePaid);
      if (inv) {
        inv.status = inv.status === 'paid' ? 'unpaid' : 'paid';
        inv.paidAt = inv.status === 'paid' ? L.todayISO() : null;
        save();
        toast(inv.status === 'paid' ? 'Facture ' + inv.number + ' marquée payée.' : 'Facture ' + inv.number + ' remise à payer.');
        renderInvoices();
      }
      return;
    }
    if (ds.duplicate) {
      const src = db.invoices.find(i => i.id === ds.duplicate);
      if (!src) return;
      const d = newDraft(src.customerId);
      if (src.period) {
        const p = L.parseISO(src.period + '-01');
        p.setMonth(p.getMonth() + 1);
        d.period = p.getFullYear() + '-' + L.pad(p.getMonth() + 1, 2);
      }
      const c = customerById(src.customerId);
      d.lines = src.lines.map((l, i) => {
        const fresh = c && i === 0 ? lineForCustomer(c, d.period) : null;
        return fresh ? Object.assign(fresh, { price: l.price }) : { desc: l.desc, sub: l.sub, qty: l.qty, price: l.price, subAuto: false, tpl: null };
      });
      recompute(d);
      d.dirty = true;
      state.draft = d; state.view = 'editor'; render(); window.scrollTo(0, 0);
      return;
    }
    if (ds.delete) {
      const inv = db.invoices.find(i => i.id === ds.delete);
      if (!inv) return;
      const isLast = !db.invoices.some(i => i.year === inv.year && i.seq > inv.seq);
      if (!isLast) {
        alert('La facture ' + inv.number + ' n’est pas la dernière de ' + inv.year + '. La supprimer laisserait un trou dans la numérotation. Pour l’annuler, émettez plutôt une note de crédit.');
        return;
      }
      if (!confirm('Supprimer définitivement la facture ' + inv.number + ' ?')) return;
      db.invoices = db.invoices.filter(i => i.id !== inv.id);
      const n = db.settings.numbering;
      if (n.year === inv.year && n.next === inv.seq + 1) n.next = inv.seq;
      save();
      toast('Facture ' + inv.number + ' supprimée. Son numéro sera réutilisé.');
      renderInvoices();
      return;
    }

    // editor-only buttons
    const d = state.draft;
    if (!d) return;
    if (ds.action === 'add-line') {
      d.lines.push({ desc: '', sub: '', subAuto: false, tpl: null, qty: 1, price: 0 });
      d.dirty = true; renderEditor();
      const inputs = document.querySelectorAll('[data-l="desc"]');
      inputs[inputs.length - 1].focus();
      return;
    }
    if (ds.removeLine !== undefined) { d.lines.splice(Number(ds.removeLine), 1); d.dirty = true; renderEditor(); return; }
    if (ds.reset === 'due') { d.dueManual = false; recompute(d); renderEditor(); return; }
    if (ds.reset === 'vat') { d.vatManual = false; recompute(d); renderEditor(); return; }
    if (ds.reset === 'comm') { d.commManual = false; recompute(d); renderEditor(); return; }
    if (ds.action === 'save' || ds.action === 'save-download') {
      const rec = saveDraft();
      if (!rec) return;
      if (ds.action === 'save-download') downloadInvoice(rec);
      toast('Facture ' + rec.number + ' enregistrée.');
      state.draft = null; state.view = 'invoices'; state.filter = 'all';
      render();
    }
  });

  document.addEventListener('change', e => {
    const el = e.target;
    if (el.matches('[data-year]')) { state.year = el.value; renderInvoices(); return; }
    const d = state.draft;
    if (!d || state.view !== 'editor') return;
    const f = el.dataset.f;
    if (f === 'customerId') { applyCustomer(d, customerById(el.value)); d.dirty = true; renderEditor(); return; }
    if (f === 'period' || f === 'date') { d[f] = el.value; recompute(d); d.dirty = true; renderEditor(); return; }
    if (f === 'vatRate') {
      d.vatRate = Number(el.value); d.vatManual = true;
      const c = customerById(d.customerId);
      if (d.vatRate === 0 && !d.vatMention) d.vatMention = L.vatRegime(c ? c.country : 'GB').mention || L.MENTION_NON_EU;
      if (d.vatRate !== 0) d.vatMention = '';
      d.dirty = true; renderEditor(); return;
    }
    if (f === 'dueDate') { d.dueDate = el.value; d.dueManual = true; d.dirty = true; renderEditor(); return; }
    if (f === 'number') {
      const m = /^(\d{4})\/(\d{1,6})$/.exec(el.value.trim());
      if (m) {
        d.year = Number(m[1]); d.seq = Number(m[2]); d.number = L.invoiceNumber(d.year, d.seq); d.numberManual = true;
        recompute(d); renderEditor();
      } else toast('Le numéro doit avoir la forme 2026/047.');
      return;
    }
  });

  document.addEventListener('input', e => {
    const el = e.target;
    const d = state.draft;
    if (!d || state.view !== 'editor') return;
    const f = el.dataset.f;
    if (f === 'communication') { d.communication = el.value; d.commManual = true; d.dirty = true; schedulePreview(); return; }
    if (f === 'vatMention') { d.vatMention = el.value; d.vatManual = true; d.dirty = true; schedulePreview(); return; }
    if (f === 'number') { d.number = el.value; d.dirty = true; refreshEditorNumbers(); return; }
    const lineEl = el.closest('[data-line]');
    if (lineEl && el.dataset.l) {
      const l = d.lines[Number(lineEl.dataset.line)];
      const k = el.dataset.l;
      if (k === 'desc') { l.desc = el.value; l.tpl = null; }
      else if (k === 'sub') { l.sub = el.value; l.subAuto = false; }
      else if (k === 'qty') { l.qty = el.value === '' ? 0 : Number(el.value); if (l.subAuto) l.sub = workedDaysText(l.qty); }
      else if (k === 'price') { l.price = el.value === '' ? 0 : Number(el.value); }
      d.dirty = true;
      refreshEditorNumbers();
    }
  });

  $dialog.addEventListener('click', e => { if (e.target === $dialog) $dialog.close(); });

  // close overflow menus when clicking elsewhere
  document.addEventListener('click', e => {
    document.querySelectorAll('details.menu[open]').forEach(m => { if (!m.contains(e.target)) m.open = false; });
  }, true);

  window.addEventListener('beforeunload', e => {
    if (state.view === 'editor' && state.draft && state.draft.dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  render();
})();
