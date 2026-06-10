/* ──────────────────────────────────────────────────────────────
   TAP Demo — email service
   • Every email is rendered with the TAP-branded template and
     stored in the `emails` table (visible in the Demo Console).
   • If SMTP_* env vars are set, it is ALSO genuinely delivered
     via Nodemailer — point DEMO_EMAIL_TO at your own inbox for
     the customer demo.
   ────────────────────────────────────────────────────────────── */
const nodemailer = require("nodemailer");
const { db, now } = require("./db");

const SMTP_READY = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
let transporter = null;
if (SMTP_READY) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

const GREEN = "#00A357", DEEP = "#063A28", GOLD = "#C9A227";

function wrap({ title, accent = GREEN, preheader = "", bodyHtml, cta }) {
  return `<!doctype html><html><body style="margin:0;background:#F2F6F3;font-family:Helvetica,Arial,sans-serif">
  <span style="display:none">${preheader}</span>
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;border:1px solid #DCE7E0">
      <tr><td style="background:${DEEP};padding:18px 28px">
        <span style="font-size:22px;font-weight:900;letter-spacing:-0.5px">
          <span style="color:#E2354B">T</span><span style="color:#fff">A</span><span style="color:${GREEN}">P</span>
        </span>
        <span style="color:#ffffff99;font-size:11px;letter-spacing:2px;margin-left:8px">AIR PORTUGAL · MILES&amp;GO</span>
        <span style="float:right;background:linear-gradient(120deg,#C9A227,#E8C75A);color:#3A2D04;font-size:10px;font-weight:bold;padding:4px 10px;border-radius:99px">GOLD</span>
      </td></tr>
      <tr><td style="height:4px;background:${accent}"></td></tr>
      <tr><td style="padding:30px 32px 8px">
        <h1 style="margin:0 0 14px;font-size:22px;color:#0E1F18">${title}</h1>
        <div style="font-size:14px;line-height:1.65;color:#3c4a44">${bodyHtml}</div>
        ${cta ? `<div style="margin:26px 0 8px"><a href="${cta.url || "#"}" style="background:${GREEN};color:#fff;text-decoration:none;font-weight:bold;font-size:14px;padding:13px 26px;border-radius:10px;display:inline-block">${cta.label}</a></div>` : ""}
      </td></tr>
      <tr><td style="padding:18px 32px 26px;font-size:11px;color:#9aa6a0;border-top:1px solid #EEF3F0">
        Sent to Daniel Ferreira · Member PT-884512 · You receive these because proactive notifications are ON.<br/>
        TAP Air Portugal demo environment — Reimagined pre-travel journey.
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

const flightRow = (f) => `
  <table width="100%" style="background:#F2F6F3;border-radius:10px;margin:14px 0"><tr>
    <td style="padding:14px 18px">
      <b style="font-size:18px;color:#0E1F18">OPO ${f.dep}</b>
      <span style="color:${GREEN};margin:0 8px">✈</span>
      <b style="font-size:18px;color:#0E1F18">LIS ${f.arr}</b>
      <div style="font-size:12px;color:#6b7a73;margin-top:3px">${f.flight_no} · Mon 15 Jun 2026 · Seat 4C · ${f.aircraft || ""}</div>
    </td>
  </tr></table>`;

const TEMPLATES = {
  booking_confirmation: ({ f, pnr, pay }) => ({
    subject: `Booked ✓ ${f.flight_no} Porto → Lisbon, Mon 15 Jun — ${pnr}`,
    html: wrap({
      title: `You're booked, Daniel.`,
      preheader: "Instant confirmation — boarding pass arrives automatically 24h before.",
      bodyHtml: `Confirmation <b>${pnr}</b> — paid in one transaction:
        voucher <b>−€${pay.voucher_amt.toFixed(2)}</b>, ${pay.miles_used.toLocaleString()} miles <b>−€${pay.miles_amt.toFixed(2)}</b>, Visa ••4417 <b>€${pay.card_amt.toFixed(2)}</b>.
        ${flightRow(f)}
        Auto check-in is ON — your boarding pass will simply appear in the app 24 hours before departure. Espresso + pastel de nata pre-ordered to 4C.`,
      cta: { label: "Manage this booking" },
    }),
  }),
  disruption: ({ f, recovery }) => ({
    subject: `⚠ ${f.flight_no} update — new departure ${f.new_dep} · your options inside`,
    html: wrap({
      title: recovery.headline,
      accent: "#E2354B",
      preheader: "We've already prepared your rebooking options — one tap, no queue.",
      bodyHtml: `${recovery.message}
        ${flightRow({ ...f, dep: f.new_dep, arr: f.new_arr })}
        <b>Your options (free, one tap in the app):</b>
        <ul style="padding-left:18px;margin:10px 0">${recovery.options.map(o => `<li style="margin:6px 0"><b>${o.label}</b><br/><span style="color:#6b7a73">${o.detail}</span></li>`).join("")}</ul>
        <div style="background:#FFF9EC;border:1px solid ${GOLD}55;border-radius:10px;padding:12px 14px;font-size:13px">🛡 ${recovery.compensation}</div>`,
      cta: { label: "Choose in the app" },
    }),
  }),
  rebooked: ({ option, pnr }) => ({
    subject: `Done ✓ ${option.label} — ${pnr} updated`,
    html: wrap({
      title: "Rebooked. Nothing else to do.",
      bodyHtml: `Your choice is confirmed: <b>${option.label}</b>.<br/><br/>
        New boarding pass issued in the app · seat 4C kept · Lisbon transfer moved automatically · calendar invite updated.`,
      cta: { label: "Open boarding pass" },
    }),
  }),
  hold_confirmation: ({ f, total, expires }) => ({
    subject: `Held for you — ${f.flight_no} at €${total.toFixed(2)} until ${expires}`,
    html: wrap({
      title: "Take your time. We'll hold it.",
      accent: GOLD,
      bodyHtml: `Your trip — flight, seat 4C and extras at <b>€${total.toFixed(2)}</b> — is held free for 48 hours (Gold benefit).
        ${flightRow(f)}
        Price won't move. We'll nudge you 6 hours before the hold expires on <b>${expires}</b>.`,
      cta: { label: "Complete booking" },
    }),
  }),
  personal_offer: ({ offer }) => ({
    subject: offer.subject,
    html: wrap({
      title: offer.title,
      preheader: offer.preheader || "",
      bodyHtml: offer.body_html,
      cta: { label: offer.cta || "See your offer" },
    }),
  }),
};

async function sendEmail(type, data) {
  const user = db.prepare("SELECT * FROM users WHERE id=1").get();
  const to = process.env.DEMO_EMAIL_TO || user.email;
  const { subject, html } = TEMPLATES[type](data);

  let status = "logged (no SMTP configured)", providerId = null;
  if (SMTP_READY) {
    try {
      const info = await transporter.sendMail({
        from: process.env.EMAIL_FROM || `"TAP Air Portugal" <${process.env.SMTP_USER}>`,
        to, subject, html,
      });
      status = "delivered via SMTP"; providerId = info.messageId;
    } catch (e) { status = "send failed: " + e.message.slice(0, 80); }
  }
  const r = db.prepare(`INSERT INTO emails (user_id,to_addr,subject,email_type,html,status,provider_id,created_at)
    VALUES (1,?,?,?,?,?,?,?)`).run(to, subject, type, html, status, providerId, now());
  db.prepare("INSERT INTO events (type,payload_json,created_at) VALUES (?,?,?)")
    .run("email_" + type, JSON.stringify({ to, subject, status }), now());
  return { id: Number(r.lastInsertRowid), to, subject, status };
}

module.exports = { sendEmail, SMTP_READY };
