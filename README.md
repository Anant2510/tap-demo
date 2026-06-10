# TAP Air Portugal — "Daniel, the Digital Commuter" Full-Stack Demo

A genuine, working demo of the reimagined pre-travel journey: **React frontend + Express backend + SQLite customer database + real email delivery + Claude AI** — all personalization is fetched live from the database, and every action (basket, fare lock, hold, payment, disruption, rebooking, offers) writes back to it.

A built-in **Demo Console** shows the live database tables and the email outbox on screen, so the customer can see exactly where the data comes from and what gets sent.

---

## 1. Requirements

- **Node.js ≥ 22** (the demo uses Node's built-in SQLite — no native builds, no external DB to install). Check with `node --version`.
- That's it. SMTP credentials and an Anthropic API key are **optional** (see below).

## 2. Run it

```bash
cd tap-demo
npm install          # installs express, nodemailer, cors, dotenv (+ esbuild for rebuilds)
cp .env.example .env # then edit .env (optional — runs fine empty)
npm start            # → http://localhost:7801  (PORT comes from .env)
```

The port is whatever `PORT` is set to in `.env` (the example ships with **7801** to match the open port on your Azure VM). Change it freely — nothing else depends on it.

On first start it creates and seeds `data/tap.db` with Daniel's full customer record: profile, Gold tier, 48,230 miles, €35 voucher, saved Visa, seat/meal preferences, **15 past flights** (the "9 of his last 12 Mondays on TP1927" pattern is computed live from this table), a synced search from his MacBook, flights, ancillaries and destination recommendations.

To start fresh for each customer session: click **Reset demo** in the Demo Console (or delete `data/` and restart).

## 3. Configuration (.env)

| Variable | What it does |
|---|---|
| `ANTHROPIC_API_KEY` | Turns on **live Claude**: AI itinerary planner, disruption recovery messages, personalized offer emails, concierge chat. Without it, realistic cached responses are used — the demo never stalls. |
| `SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS` | Turns on **real email delivery** via any SMTP provider. |
| `DEMO_EMAIL_TO` | Overrides the recipient — **point this at your own inbox** so you can open Daniel's emails live on screen during the demo. |
| `EMAIL_FROM` | The From header on outgoing mail. |
| `PORT` | Default 3000. |

**Gmail SMTP example** (easiest for a demo): `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER=you@gmail.com`, `SMTP_PASS=<App Password>` (Google Account → Security → 2-Step Verification → App passwords). Office 365: `smtp.office365.com:587`.

Whether or not SMTP is configured, **every email is also stored in the database** and viewable (with full HTML preview) in the Demo Console's Email center — so the email story works even offline.

## 4. Deploy on your Azure VM

```bash
# on the VM (Ubuntu example)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
# copy the project up (scp/rsync the zip), then:
unzip tap-daniel-demo.zip && cd tap-demo
npm install && cp .env.example .env && nano .env
npm start
```

Expose it publicly (your VM has port **7801** open):

1. Set `PORT=7801` in `.env` (already the default in `.env.example`).
2. Confirm **Azure Portal → your VM → Networking → Inbound port rules** allows TCP **7801** (and that any OS firewall does too: `sudo ufw allow 7801`).
3. Your URL is then `http://<vm-public-ip>:7801`. For a friendlier name, Azure gives a free DNS label: VM → Overview → Public IP → Configuration → **DNS name label** → `http://<label>.<region>.cloudapp.azure.com:7801`.
4. (Optional, nicer) put nginx in front on 80/443 with a Let's Encrypt cert, proxying to `localhost:7801`.

Keep it running after you log out:

```bash
sudo npm i -g pm2
PORT=7801 pm2 start server/server.js --name tap-demo
pm2 save && pm2 startup
```

If you edit the frontend (`web/app.jsx`), rebuild with `npm run build`.

## 5. Suggested customer demo flow (~8 minutes)

1. **Login** — one tap on Daniel's saved profile; point out it's loaded from the customer DB.
2. **Home** — recurring journey card ("9 of his last 12 Mondays — computed live from travel_history"), the synced search from his MacBook, the AI itinerary planner ("Plan my Lisbon client week").
3. **Flights** — TP1927 recommended from his pattern, lowest fare flagged, free Gold **fare lock** (watch the toast: row written to DB).
4. **Basket** — one persistent basket: flight + seat 4C + meal + transfer; toggle an item and mention it's saved server-side instantly.
5. **Checkout** — every passenger field auto-filled *from the users table*; trigger the **48h Time-to-Think hold** → a real branded email goes out.
6. **Payment** — split voucher + miles slider + saved Visa in one transaction → instant confirmation + **booking email**; miles balance visibly drops.
7. **Manage** — auto check-in ON, live boarding pass; hit **Simulate flight delay** → ops event hits the DB, Claude writes an honest recovery message, the **proactive disruption email** is sent, Daniel rebooks in one tap → **rebooking email**.
8. **Demo Console** — the reveal: live tables (bookings, payments, emails, events all just appeared), the email center with HTML previews, and the line: *"this customer store is CDP-ready — in production these objects sync 1:1 with the CDP profile."* Back on Home, hit **"Email me this week's offer"** for an AI-personalized commercial email built from his actual history.

## 6. Architecture

```
public/        static frontend (index.html + bundled app.js)
web/app.jsx    React source (rebuild: npm run build)
server/
  server.js    Express API + static hosting
  db.js        SQLite schema + Daniel seed  → data/tap.db
  email.js     Nodemailer + branded HTML templates + DB outbox
  claude.js    server-side Claude calls (profile context built
               live from the DB) + cached fallbacks
data/tap.db    the visible customer database (open it in any
               SQLite tool, e.g. DB Browser for SQLite)
```

API highlights: `/api/profile`, `/api/flights`, `/api/basket`, `/api/fare-lock`, `/api/hold`, `/api/pay`, `/api/disrupt`, `/api/rebook`, `/api/ai/plan`, `/api/ai/chat`, `/api/offers/send`, `/api/admin/db`, `/api/admin/emails`, `/api/admin/reset`, `/api/health`.
