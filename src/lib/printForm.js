/**
 * printForm.js
 * The Urdu leave form (درخواست برائے چھٹی) template engine.
 *
 * renderForm() returns one filled RTL form as an HTML string.
 * buildPrintableDocument() wraps rendered forms into a complete,
 * self-contained printable document: A4 landscape, two forms per page.
 *
 * Logo: renderForm takes an optional logoDataUrl param. The Generate
 * component fetches 'crown-logo.png' once (as a data URL) and passes it in,
 * so both the preview and the downloaded single file embed the logo.
 * When no data URL is given, a styled Urdu text fallback is shown instead.
 */

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Signature spot positions understood by sigPlacements. */
export const SIG_POSITIONS = ['employee', 'departmentHead', 'hrManager'];

const LEAVE_TYPES = [
  { id: 'casual', label: 'اتفاقی' },
  { id: 'sick', label: 'بیماری' },
  { id: 'annual', label: 'سالانہ' },
];

function sigSpot(label, position, sigPlacements) {
  const sig = (sigPlacements || []).find((p) => p.position === position);
  const img = sig && sig.imageUrl
    ? `<img class="clf-sigimg" src="${esc(sig.imageUrl)}" alt="" />`
    : '';
  return `<div class="clf-sig"><div class="clf-sigimgbox">${img}</div><div class="clf-sigline"></div><div class="clf-siglabel">${label}</div></div>`;
}

function logoBlock(logoDataUrl) {
  if (logoDataUrl) {
    return `<img class="clf-logoimg" src="${esc(logoDataUrl)}" alt="Crown Textile" />`;
  }
  return `<div class="clf-logofallback">کراؤن<br>ٹیکسٹائل</div>`;
}

/**
 * Render one filled leave form.
 *
 * data: {
 *   workerNo, name, father, designation, department,
 *   leaveDateStr: e.g. '18/8/26' (used for both سے and تک),
 *   upperDateStr: the تاریخ at the top of the form,
 *   quantity: default '1',
 *   reason,
 *   leaveType: 'sick' | 'casual' | 'annual' (default 'sick')
 * }
 * sigPlacements: [{ imageUrl, position }] where position is one of
 *   SIG_POSITIONS. A matching placement renders the signature image above
 *   that spot's line; otherwise the spot stays blank.
 * logoDataUrl: optional data URL of the Crown logo.
 */
export function renderForm(data, sigPlacements = [], logoDataUrl = null) {
  const d = data || {};
  const type = LEAVE_TYPES.some((t) => t.id === d.leaveType) ? d.leaveType : 'sick';
  const qty = d.quantity != null && d.quantity !== '' ? d.quantity : '1';

  const typeBoxes = LEAVE_TYPES.map((t) => {
    const tick = t.id === type ? '<span class="clf-tick">✓</span>' : '';
    return `<span class="clf-type"><span class="clf-box">${tick}</span><span>${t.label}</span></span>`;
  }).join('');

  return `<!--clf-form--><div class="clf-form" dir="rtl">
  <div class="clf-top">
    <div class="clf-logo">${logoBlock(logoDataUrl)}</div>
    <div class="clf-head">
      <div class="clf-company">کراؤن ٹیکسٹائل (<span class="clf-nowrap">لانڈھی یونٹ</span>)</div>
      <div class="clf-title">درخواست برائے چھٹی</div>
    </div>
  </div>
  <div class="clf-row">
    <div class="clf-field"><span class="clf-label">تاریخ:</span><span class="clf-val">${esc(d.upperDateStr)}</span></div>
    <div class="clf-field"><span class="clf-label">ورکر نمبر:</span><span class="clf-val">${esc(d.workerNo)}</span></div>
  </div>
  <div class="clf-row">
    <div class="clf-field"><span class="clf-label">نام:</span><span class="clf-val">${esc(d.name)}</span></div>
    <div class="clf-field"><span class="clf-label">ولدیت:</span><span class="clf-val">${esc(d.father)}</span></div>
  </div>
  <div class="clf-row">
    <div class="clf-field"><span class="clf-label">عہدہ:</span><span class="clf-val">${esc(d.designation)}</span></div>
    <div class="clf-field"><span class="clf-label">ڈیپارٹمنٹ:</span><span class="clf-val">${esc(d.department)}</span></div>
  </div>
  <div class="clf-row">
    <div class="clf-field"><span class="clf-label">چھٹی کی تعداد:</span><span class="clf-val clf-qty">${esc(qty)}</span></div>
    <div class="clf-field"><span class="clf-label">سے</span><span class="clf-val">${esc(d.leaveDateStr)}</span></div>
    <div class="clf-field"><span class="clf-label">تک</span><span class="clf-val">${esc(d.leaveDateStr)}</span></div>
  </div>
  <div class="clf-row">
    <div class="clf-field"><span class="clf-label">وجہ:</span><span class="clf-val">${esc(d.reason)}</span></div>
  </div>
  <div class="clf-types">${typeBoxes}</div>
  <div class="clf-signs">
    ${sigSpot('دستخط ملازم', 'employee', sigPlacements)}
    ${sigSpot('ڈیپارٹمنٹ ہیڈ', 'departmentHead', sigPlacements)}
    ${sigSpot('ایچ آر مینیجر', 'hrManager', sigPlacements)}
  </div>
  <div class="clf-office">
    <div class="clf-office-title">صرف دفتری استعمال کے لیے</div>
    <div class="clf-office-cols">
      <div class="clf-obox">
        <div class="clf-obhead">تصدیق شدہ</div>
        <div class="clf-orow"><span>اتفاقی / بیماری</span><span class="clf-obox-check"></span></div>
        <div class="clf-orow"><span>سالانہ</span><span class="clf-obox-check"></span></div>
        <div class="clf-orow"><span>خصوصی</span><span class="clf-obox-check"></span></div>
      </div>
      <div class="clf-obox">
        <div class="clf-obhead">موجودہ بقایا چھٹی</div>
        <div class="clf-orow"><span>اتفاقی</span><span class="clf-obox-check"></span></div>
        <div class="clf-orow"><span>بیماری</span><span class="clf-obox-check"></span></div>
        <div class="clf-orow"><span>سالانہ</span><span class="clf-obox-check"></span></div>
      </div>
    </div>
  </div>
</div>`;
}

/**
 * The complete form stylesheet. Exported so the app's on-screen preview can
 * inject the exact same styles.
 */
export function formStyles() {
  return `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body { font-family: 'Noto Nastaliq Urdu', 'Jameel Noori Nastaleeq', 'Urdu Typesetting', serif; }
  @page { size: A4 landscape; margin: 8mm; }
  .clf-page {
    display: flex; gap: 6mm; direction: rtl;
    page-break-after: always; break-after: page;
    height: 192mm;
  }
  .clf-page:last-child { page-break-after: auto; break-after: auto; }
  .clf-form {
    width: 48%; flex: 0 0 48%; height: 100%;
    display: flex; flex-direction: column;
    border: 2px solid #000; padding: 6px 12px 8px;
    direction: rtl; text-align: right; line-height: 2.1; font-size: 12px;
    background: #fff; color: #000;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .clf-preview .clf-form { width: 100%; flex: none; height: auto; }
  .clf-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
  .clf-head { flex: 1; text-align: center; }
  .clf-company { font-weight: 700; font-size: 14px; }
  .clf-nowrap { white-space: nowrap; }
  .clf-title { font-weight: 700; font-size: 16px; margin: 2px 0 4px; }
  .clf-logo { flex: 0 0 auto; }
  .clf-logoimg { width: 52px; height: 52px; object-fit: contain; }
  .clf-logofallback {
    border: 1.5px solid #000; font-size: 9px; font-weight: 700;
    text-align: center; padding: 3px 8px; line-height: 1.5; direction: ltr;
  }
  .clf-row { display: flex; gap: 12px; margin: 1px 0; }
  .clf-field { flex: 1; display: flex; align-items: flex-end; gap: 6px; min-width: 0; }
  .clf-label { white-space: nowrap; font-size: 11.5px; }
  .clf-val {
    flex: 1; border-bottom: 1px dotted #000; min-height: 1.55em;
    font-size: 12.5px; padding: 0 6px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .clf-qty { flex: 0 1 56px; text-align: center; }
  .clf-types { display: flex; justify-content: center; gap: 28px; margin: 6px 0 2px; }
  .clf-type { display: flex; align-items: center; gap: 7px; font-size: 12px; }
  .clf-box {
    width: 14px; height: 14px; border: 1.5px solid #000;
    display: inline-flex; align-items: center; justify-content: center;
  }
  .clf-tick { font-size: 20px; font-weight: 900; line-height: 1; font-family: Arial, sans-serif; }
  .clf-signs { display: flex; gap: 8px; margin-top: 4px; flex: 1 0 auto; }
  .clf-sig { flex: 1; text-align: center; display: flex; flex-direction: column; }
  .clf-sigimgbox { flex: 1; min-height: 70px; display: flex; align-items: flex-end; justify-content: center; }
  .clf-sigimg { max-height: 66px; max-width: 90%; object-fit: contain; }
  .clf-sigline { border-top: 1px solid #000; margin: 0 10px; }
  .clf-siglabel { font-size: 10.5px; padding-top: 2px; }
  .clf-office { border: 1.5px solid #000; margin-top: 6px; padding: 3px 8px 6px; }
  .clf-office-title { text-align: center; font-weight: 700; font-size: 11px; }
  .clf-office-cols { display: flex; gap: 8px; margin-top: 3px; }
  .clf-obox { flex: 1; border: 1px solid #000; padding: 1px 8px 5px; font-size: 10.5px; }
  .clf-obhead { font-weight: 700; text-align: center; font-size: 11px; }
  .clf-orow { display: flex; justify-content: space-between; align-items: center; gap: 6px; margin-top: 4px; }
  .clf-obox-check { width: 30px; height: 16px; border: 1px solid #000; display: inline-block; }
  @media screen and (max-width: 760px) {
    .clf-page { flex-direction: column; height: auto; }
    .clf-form { width: 100%; flex: none; height: auto; margin-bottom: 6mm; }
  }
  @media print {
    body { background: #fff; }
    .clf-page { box-shadow: none; padding: 0; margin: 0; }
  }
`;
}

/**
 * Build a complete self-contained printable HTML document from rendered
 * forms. formsHTML is the concatenated output of renderForm() calls
 * (each begins with the <!--clf-form--> marker). Forms are paired into
 * A4 landscape pages, two per page.
 */
export function buildPrintableDocument(formsHTML) {
  const forms = String(formsHTML || '')
    .split('<!--clf-form-->')
    .map((f) => f.trim())
    .filter(Boolean);

  let pages = '';
  for (let i = 0; i < forms.length; i += 2) {
    const pair = forms[i] + (forms[i + 1] ? `\n${forms[i + 1]}` : '');
    pages += `<div class="clf-page">${pair}</div>\n`;
  }

  return `<!DOCTYPE html>
<html lang="ur" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Leave Forms - Crown Textile</title>
<style>${formStyles()}</style>
</head>
<body>
${pages}
</body>
</html>`;
}
