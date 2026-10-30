/* Shared helpers: money, dates, VAT rules, structured communication, EPC QR payload. */
(function (global) {
  'use strict';

  const EU = ['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE',
    'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK'];

  const COUNTRIES = [
    ['BE', 'Belgique'], ['LU', 'Luxembourg'], ['GB', 'Royaume-Uni'], ['FR', 'France'],
    ['NL', 'Pays-Bas'], ['DE', 'Allemagne'], ['IE', 'Irlande'], ['ES', 'Espagne'], ['IT', 'Italie'],
    ['CH', 'Suisse'], ['MA', 'Maroc'], ['US', 'États-Unis'], ['OTHER_EU', 'Autre pays de l’UE'],
    ['OTHER', 'Autre pays hors UE']
  ];

  const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août',
    'septembre', 'octobre', 'novembre', 'décembre'];

  const MENTION_EU = 'Autoliquidation – TVA due par le preneur (article 196 de la directive 2006/112/CE).';
  const MENTION_NON_EU = 'Prestation de services non soumise à la TVA belge (article 21, § 2 du Code de la TVA).';

  function countryName(code) {
    const c = COUNTRIES.find(x => x[0] === code);
    return c ? c[1] : code || '';
  }

  function isEU(code) { return code === 'OTHER_EU' || EU.includes(code); }

  /* VAT regime decided by the customer's country. */
  function vatRegime(country) {
    if (!country || country === 'BE') return { rate: 21, mention: '', label: 'Belgique · TVA 21 %' };
    if (isEU(country)) return { rate: 0, mention: MENTION_EU, label: 'Client UE · autoliquidation, TVA 0 %' };
    return { rate: 0, mention: MENTION_NON_EU, label: 'Client hors UE · TVA 0 %' };
  }

  /* Money is kept in cents to avoid rounding drift. */
  function toCents(n) { return Math.round((Number(n) || 0) * 100); }

  function lineCents(line) {
    return Math.round((Number(line.qty) || 0) * (Number(line.price) || 0) * 100);
  }

  function totals(inv) {
    const htva = (inv.lines || []).reduce((s, l) => s + lineCents(l), 0);
    const vat = Math.round(htva * (Number(inv.vatRate) || 0) / 100);
    return { htva, vat, total: htva + vat };
  }

  function fmtNumber(n, decimals) {
    const neg = n < 0;
    const fixed = Math.abs(n).toFixed(decimals);
    const [int, dec] = fixed.split('.');
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (neg ? '-' : '') + grouped + (decimals ? ',' + dec : '');
  }

  function fmtMoney(cents) { return fmtNumber(cents / 100, 2) + ' €'; }
  function fmtQty(q) { return fmtNumber(Number(q) || 0, 2); }

  function pad(n, len) { return String(n).padStart(len, '0'); }

  function todayISO() {
    const d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2);
  }

  function parseISO(iso) {
    const [y, m, d] = String(iso).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }

  function toISO(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2);
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return d + '/' + m + '/' + y;
  }

  function addDays(iso, days) {
    const d = parseISO(iso);
    d.setDate(d.getDate() + Number(days || 0));
    return toISO(d);
  }

  /* "2026-09" -> "Septembre 2026" */
  function periodLabel(period) {
    if (!period) return '';
    const [y, m] = period.split('-').map(Number);
    const name = MONTHS[m - 1] || '';
    return name.charAt(0).toUpperCase() + name.slice(1) + ' ' + y;
  }

  /* Previous calendar month of a date, as "YYYY-MM": invoicing in October covers September. */
  function previousPeriod(iso) {
    const d = parseISO(iso);
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2);
  }

  /*
   * Payment terms per customer:
   *  - eom_next: paid by the end of the month after the period worked (September -> 31 October)
   *  - days:     N days after the invoice date
   */
  function dueDate(terms, invoiceDate, period) {
    terms = terms || { type: 'days', days: 30 };
    if (terms.type === 'eom_next') {
      const base = period ? parseISO(period + '-01') : parseISO(invoiceDate);
      const extra = Number(terms.months || 1);
      const d = new Date(base.getFullYear(), base.getMonth() + extra + 1, 0);
      return toISO(d);
    }
    return addDays(invoiceDate, terms.days == null ? 30 : terms.days);
  }

  function termsLabel(terms) {
    if (!terms) return '';
    if (terms.type === 'eom_next') return 'Fin du mois suivant la prestation';
    const n = Number(terms.days || 0);
    return n === 0 ? 'À réception' : n + ' jours après la date de facture';
  }

  /* Belgian structured communication (OGM/VCS): 10 digits + 2 check digits (mod 97, 0 -> 97). */
  function ogm(year, seq) {
    const base = pad(year, 4) + pad(seq, 6);
    let check = Number(BigInt(base) % 97n);
    if (check === 0) check = 97;
    const f = base + pad(check, 2);
    return '+++' + f.slice(0, 3) + '/' + f.slice(3, 7) + '/' + f.slice(7) + '+++';
  }

  function ogmIsValid(s) {
    const digits = String(s || '').replace(/\D/g, '');
    if (digits.length !== 12) return false;
    let check = Number(BigInt(digits.slice(0, 10)) % 97n);
    if (check === 0) check = 97;
    return check === Number(digits.slice(10));
  }

  function cleanIban(iban) { return String(iban || '').replace(/\s+/g, '').toUpperCase(); }

  function fmtIban(iban) { return cleanIban(iban).replace(/(.{4})/g, '$1 ').trim(); }

  /* EPC069-12 "SEPA credit transfer" QR payload, read by Belgian and most EU banking apps. */
  function epcPayload({ bic, name, iban, cents, reference }) {
    return [
      'BCD', '002', '1', 'SCT',
      String(bic || '').replace(/\s+/g, '').toUpperCase(),
      String(name || '').slice(0, 70),
      cleanIban(iban),
      'EUR' + (cents / 100).toFixed(2),
      '',
      '',
      String(reference || '').slice(0, 140)
    ].join('\n');
  }

  const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'];

  function periodLabelEn(period) {
    if (!period) return '';
    const [y, m] = period.split('-').map(Number);
    return (MONTHS_EN[m - 1] || '') + ' ' + y;
  }

  function plainNumber(n) {
    const v = Number(n) || 0;
    return Number.isInteger(v) ? String(v) : fmtNumber(v, 2).replace(/,?0+$/, '');
  }

  /*
   * Reusable descriptions. Placeholders filled per invoice:
   *   {mois}  -> "Septembre 2026"   {month} -> "September 2026"
   *   {jours} -> quantity (days)    {tarif} -> unit price
   */
  const PLACEHOLDERS = ['{mois}', '{month}', '{jours}', '{tarif}'];

  function renderTemplate(tpl, ctx) {
    if (tpl == null) return '';
    return String(tpl)
      .replace(/\{mois\}/gi, periodLabel(ctx.period))
      .replace(/\{month\}/gi, periodLabelEn(ctx.period))
      .replace(/\{jours\}/gi, plainNumber(ctx.qty))
      .replace(/\{tarif\}/gi, plainNumber(ctx.price));
  }

  function hasPlaceholder(s) { return /\{(mois|month|jours|tarif)\}/i.test(String(s || '')); }

  /* Turns text typed on an invoice back into a reusable template (month, days and rate become placeholders). */
  function toTemplate(text, ctx) {
    let s = String(text || '');
    const swaps = [];
    const fr = periodLabel(ctx.period), en = periodLabelEn(ctx.period);
    if (fr) swaps.push([fr, '{mois}']);
    if (en) swaps.push([en, '{month}']);
    swaps.forEach(([from, to]) => {
      const re = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      s = s.replace(re, to);
    });
    const num = (n, ph) => {
      const v = plainNumber(n);
      if (!Number(n) || v === '1') return;
      s = s.replace(new RegExp('(^|[^\\d.,])' + v.replace('.', '\\.') + '(?![\\d,]*\\d)', 'g'), (m, pre) => pre + ph);
    };
    if (Number(ctx.qty) !== Number(ctx.price)) { num(ctx.price, '{tarif}'); num(ctx.qty, '{jours}'); }
    return s;
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function invoiceNumber(year, seq) { return year + '/' + pad(seq, 3); }

  global.Lib = {
    COUNTRIES, MONTHS, MENTION_EU, MENTION_NON_EU,
    countryName, isEU, vatRegime, toCents, lineCents, totals, fmtMoney, fmtQty, fmtNumber,
    todayISO, parseISO, toISO, fmtDate, addDays, periodLabel, previousPeriod, dueDate, termsLabel,
    ogm, ogmIsValid, cleanIban, fmtIban, epcPayload, uid, pad, invoiceNumber,
    periodLabelEn, plainNumber, PLACEHOLDERS, renderTemplate, hasPlaceholder, toTemplate
  };
})(typeof window !== 'undefined' ? window : globalThis);
