/* Builds the invoice PDF with jsPDF (A4, mm). */
(function (global) {
  'use strict';
  const L = global.Lib;

  const INK = [33, 33, 33];
  const GREY = [128, 128, 128];
  const RULE = [200, 200, 200];
  const BAR = [238, 238, 238];

  /* Draws the QR code as vector squares: sharp at any zoom, no canvas needed. */
  function drawQr(doc, text, x, y, size) {
    const qr = global.qrcode(0, 'M');
    qr.addData(unescape(encodeURIComponent(text)), 'Byte');
    qr.make();
    const count = qr.getModuleCount();
    const cell = size / count;
    doc.setFillColor(0, 0, 0);
    for (let r = 0; r < count; r++) {
      let run = -1;
      for (let c = 0; c <= count; c++) {
        const dark = c < count && qr.isDark(r, c);
        if (dark && run < 0) run = c;
        if (!dark && run >= 0) {
          // tiny overlap avoids hairline gaps between modules in some viewers
          doc.rect(x + run * cell, y + r * cell, (c - run) * cell + 0.02, cell + 0.02, 'F');
          run = -1;
        }
      }
    }
  }

  /**
   * inv: { number, date, dueDate, customer:{name,street,city,country,vat,bce}, lines:[{desc,sub,qty,price}],
   *        vatRate, vatMention, communication }
   * company: { name, owner, street, city, vat, bce, iban, bic, email, phone, footer }
   */
  function build(inv, company, logoDataUrl) {
    const { jsPDF } = global.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    doc.setProperties({ title: 'Facture ' + (inv.number || ''), author: company.name, creator: company.name });

    const left = 14, right = 194.5;
    const text = (s, x, y, opts) => doc.text(String(s == null ? '' : s), x, y, opts);
    const font = (style, size, color) => {
      doc.setFont('helvetica', style || 'normal');
      doc.setFontSize(size || 10);
      doc.setTextColor.apply(doc, color || INK);
    };

    // Logo
    if (logoDataUrl) {
      try {
        const fmt = /^data:image\/png/.test(logoDataUrl) ? 'PNG' : 'JPEG';
        doc.addImage(logoDataUrl, fmt, left, 14, 28, 28);
      } catch (e) { /* unreadable logo: skip */ }
    }

    // Customer block (top right)
    const c = inv.customer || {};
    let y = 44.5;
    font('bold', 10);
    text(c.name, 115.5, y);
    font('normal', 10);
    const custLines = [c.street, c.city];
    if (c.country && c.country !== 'BE') custLines.push(L.countryName(c.country));
    custLines.filter(Boolean).forEach(l => { y += 4.2; text(l, 115.5, y); });

    // Issuer block (left)
    y = 52.5;
    font('bold', 10);
    text(company.name, left + 0.8, y);
    font('normal', 10);
    [company.owner, company.street, company.city].filter(Boolean).forEach(l => { y += 4.2; text(l, left + 0.8, y); });
    y += 8.4;
    if (company.vat) { text('TVA ' + company.vat, left + 0.8, y); y += 4.2; }
    if (company.bce) { text('BCE ' + company.bce, left + 0.8, y); }

    // Title
    font('bold', 17);
    text('FACTURE', left, 92.8);
    const tw = doc.getTextWidth('FACTURE ');
    doc.setTextColor.apply(doc, GREY);
    text(inv.number || '', left + tw, 92.8);

    // Meta block
    const meta = [['Date', L.fmtDate(inv.date)], ['Echéance', L.fmtDate(inv.dueDate)]];
    if (c.vat) meta.push(['TVA client', c.vat]);
    if (c.bce) meta.push([c.country === 'BE' || !c.country ? 'BCE client' : 'N° entreprise', c.bce]);
    font('normal', 10);
    let my = 98;
    meta.forEach(([k, v]) => { text(k, 24.5, my); text(v, 45, my); my += 4.2; });
    doc.setDrawColor.apply(doc, GREY);
    doc.setLineWidth(0.2);
    doc.line(18, 94.8, 18, my - 2.2);

    // Lines table
    const colQty = 142.5, colPrice = 167, colAmount = 192.5;
    const sep1 = 126, sep2 = 146, sep3 = 170;
    let ty = Math.max(my + 7, 120);
    font('italic', 9.5);
    text('Description', 17.5, ty);
    text('Quantité', colQty, ty, { align: 'right' });
    text('Prix unitaire', colPrice, ty, { align: 'right' });
    text('Montant', colAmount, ty, { align: 'right' });
    doc.setDrawColor.apply(doc, RULE);
    doc.setLineWidth(0.25);
    const top = ty + 2.6;
    doc.line(left, top, right + 1.5, top);
    ty = top + 6;

    font('normal', 10);
    const rowStarts = [];
    (inv.lines || []).forEach(line => {
      const start = ty - 6;
      rowStarts.push(start);
      const descLines = doc.splitTextToSize(String(line.desc || ''), sep1 - 17.5 - 3);
      const subLines = line.sub ? doc.splitTextToSize(String(line.sub), sep1 - 17.5 - 3) : [];
      const all = descLines.concat(subLines);
      all.forEach((l, i) => text(l, 17.5, ty + i * 4.4));
      text(L.fmtQty(line.qty), colQty, ty, { align: 'right' });
      text(L.fmtMoney(L.toCents(line.price)), colPrice, ty, { align: 'right' });
      text(L.fmtMoney(L.lineCents(line)), colAmount, ty, { align: 'right' });
      ty += Math.max(1, all.length) * 4.4 + 3.6;
      doc.line(left, ty - 6, right + 1.5, ty - 6);
    });
    const bottom = ty - 6;
    // vertical separators between numeric columns
    doc.line(sep1, top, sep1, bottom);
    doc.line(sep2, top, sep2, bottom);
    doc.line(sep3, top, sep3, bottom);

    // Totals
    const t = L.totals(inv);
    let ky = bottom + 10.5;
    font('normal', 10);
    text('Total HTVA', 146.5, ky, { align: 'right' });
    text(L.fmtMoney(t.htva), colAmount, ky, { align: 'right' });
    ky += 4.2;
    const rateLabel = 'TVA ' + String(inv.vatRate).replace('.', ',') + '%';
    text(rateLabel, 146.5, ky, { align: 'right' });
    text(L.fmtMoney(t.vat), colAmount, ky, { align: 'right' });

    // VAT exemption mention (0 % invoices)
    if (inv.vatMention) {
      font('italic', 8.5);
      const m = doc.splitTextToSize(inv.vatMention, 86);
      m.forEach((l, i) => text(l, 17.5, bottom + 10 + i * 3.8));
    }

    ky += 9.5;
    font('bold', 13);
    text('Total', 146.5, ky, { align: 'right' });
    font('bold', 15);
    text(L.fmtMoney(t.total), colAmount, ky, { align: 'right' });

    // Payment bar
    const by = ky + 6.5;
    doc.setFillColor.apply(doc, BAR);
    doc.rect(left, by, right + 1.5 - left, 7, 'F');
    doc.setDrawColor.apply(doc, RULE);
    doc.line(left, by, right + 1.5, by);
    doc.line(left, by + 7, right + 1.5, by + 7);
    const commLabel = 'Communication';
    font('normal', 9.5);
    const cells = [['IBAN', 15, 28, L.fmtIban(company.iban)], ['BIC', 67, 79, company.bic || ''],
      [commLabel, 104, 135, inv.communication || '']];
    // white value cells like the original
    const valueCells = [[26.5, 64.5], [77.5, 102], [133.5, right + 1.5]];
    doc.setFillColor(255, 255, 255);
    valueCells.forEach(([a, b]) => doc.rect(a, by + 0.15, b - a, 6.7, 'F'));
    cells.forEach(([label, lx, vx, val]) => { text(label, lx, by + 4.8); text(val, vx, by + 4.8); });

    // Payment instruction + QR
    const py = by + 13;
    font('normal', 9.5);
    const instruction = 'Veuillez payer le montant de ' + L.fmtMoney(t.total) +
      ' sur le compte mentionné ci-dessus avant le ' + L.fmtDate(inv.dueDate) +
      (inv.communication ? ' en mentionnant la référence ' + inv.communication + '.' : '.');
    doc.splitTextToSize(instruction, 148).forEach((l, i) => text(l, 15.5, py + i * 4.2));

    let qy = by + 9;
    if (company.iban && t.total > 0) {
      const payload = L.epcPayload({ bic: company.bic, name: company.name, iban: company.iban, cents: t.total, reference: inv.communication });
      try {
        drawQr(doc, payload, right + 1.5 - 26, qy, 26);
        font('normal', 9);
        text('Scanner pour payer', right + 1.5, qy + 29.5, { align: 'right' });
      } catch (e) { /* QR library missing */ }
    }

    const ly = qy + 33;
    doc.setDrawColor.apply(doc, RULE);
    doc.line(left, ly, right + 1.5, ly);
    font('normal', 10);
    text(company.thanks || 'Merci de votre confiance !', left + 0.5, ly + 6);

    // Footer
    const foot = [company.email, company.phone, company.website].filter(Boolean).join('   ·   ');
    if (foot) {
      font('normal', 8, GREY);
      text(foot, 105, 287, { align: 'center' });
    }

    return doc;
  }

  function fileName(inv) { return String(inv.number || 'facture').replace(/[\/\\]/g, '_') + '.pdf'; }

  global.InvoicePDF = { build, fileName };
})(typeof window !== 'undefined' ? window : globalThis);
