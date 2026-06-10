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
public/         static frontend (index.html + bundled app.js)
web/app.jsx     React source (rebuild: npm run build)
server/
  server.js     Express API + static hosting
  db.js         SQLite schema + Daniel seed + route network → data/tap.db
  routes-data.js  100-route network (50 European) + 92 airports
  search.js     flight-search engine — generates realistic flights
                for any route on demand; pins Daniel's OPO→LIS shuttle
  email.js      Nodemailer + branded HTML templates + DB outbox
  claude.js     server-side Claude calls (profile context built
                live from the DB) + cached fallbacks
data/tap.db     the visible customer database (open it in any
                SQLite tool, e.g. DB Browser for SQLite)
```

API highlights: `/api/profile`, `/api/search` (any route), `/api/airports` (autocomplete), `/api/routes` (network), `/api/flights`, `/api/basket`, `/api/fare-lock`, `/api/hold`, `/api/pay`, `/api/disrupt`, `/api/rebook`, `/api/ai/plan`, `/api/ai/chat`, `/api/offers/send`, `/api/admin/db`, `/api/admin/emails`, `/api/admin/reset`, `/api/health`.

## 7. Flight search & the personalization loop

The app searches a network of **100 routes across 92 airports — 50 within Europe, with heavy Portugal coverage** (Lisbon, Porto, Faro, Funchal, the Azores, plus Portugal↔Europe and long-haul to Brazil, North America, and Africa). Rather than seeding tens of thousands of flight rows, `search.js` generates realistic, *deterministic* flights for any route on demand (the same route+date always returns the same flights). Daniel's OPO→LIS commute is pinned to his real flight numbers so his travel history lines up exactly.

Every customer action is behavioural data that flows into the database and back into what the app recommends:

- **Searches** are logged to the `searches` table. The most-searched destinations surface in the profile and shape recommendations.
- **Bookings** append to `travel_history`. Per-destination booking counts drive the "Picked for you" cards ("Booked 3× — a favourite") and the recommended flight on each route is chosen to match the customer's usual departure time.

So in the demo you can search and book *any* of the 100 routes end-to-end (search → select → basket → checkout → payment → confirmation + email), watch each step write to the database live in the Demo Console, and see the personalization shift as a result. This is the CDP story made tangible: the store maps 1:1 to customer-profile, behaviour, and consent objects for later CDP sync.


## 8. WhatsApp integration (real, free, demo-only)

The demo connects to **real WhatsApp** using Meta's official Cloud API **test number** — free, no business verification, designed exactly for development/demo use. You message the bot from your own phone; button taps hit your VM's webhook and run the same backend the portal uses (bookings, rebooking, ancillaries, cancellations — all in the same database, all feeding personalization).

What works on WhatsApp: main menu (list message) → **book the usual flight** with one-tap pay or 48h hold → **add extras** (charged to the booking) → **check in** → **flight status** → **cancel with instant refund** (miles + voucher really restored). And the showpiece: triggering **Simulate flight delay** in the portal pushes a proactive WhatsApp message with two rebooking buttons — tap one and the booking changes, the email goes out, the DB updates, live on screen.

### Setup (~20 minutes, free)

1. **Meta app**: go to developers.facebook.com → My Apps → Create App → type **Business**. On the app dashboard, find the **WhatsApp** product and click *Set up*. This provisions a **free test phone number** and a temporary access token.
2. **Verify your phone**: in WhatsApp → API Setup, under "To", choose *Manage phone number list* and add your own WhatsApp number (you'll get a confirmation code in WhatsApp). Up to 5 recipients allowed.
3. **Copy credentials** into `.env`: the **temporary access token** → `WHATSAPP_TOKEN`, and the **Phone number ID** (shown under the test number, *not* the phone number itself) → `WHATSAPP_PHONE_NUMBER_ID`. Note: the temporary token lasts ~24h — regenerate it before each demo session, or create a System User token in Meta Business Settings for a long-lived one.
4. **Public HTTPS webhook**: Meta requires HTTPS. Easiest for a demo is a tunnel. On the VM:
   ```bash
   # ngrok (sign up free at ngrok.com for an authtoken)
   ngrok http 7801
   ```
   Copy the `https://xxxx.ngrok-free.app` URL it prints. (Cloudflare Tunnel `cloudflared tunnel --url http://localhost:7801` works too.)
5. **Configure the webhook** in Meta: WhatsApp → Configuration → Webhook → *Edit*. Callback URL: `https://YOUR-TUNNEL-URL/api/whatsapp/webhook`. Verify token: whatever you set as `WHATSAPP_VERIFY_TOKEN` (default `tap-demo-verify`). Click *Verify and save*, then under **Webhook fields**, subscribe to **messages**.
6. **Restart the app** (`pm2 restart tap-demo`) and check `GET /api/health` — it should report `whatsapp: configured`.

### Demo flow

Send **"Hi"** from your phone to the test number first — this opens WhatsApp's 24-hour customer-service window, inside which interactive messages are unlimited and free. The menu appears; everything is tap-driven from there. For the disruption push to reach you before you've messaged the bot, set `WHATSAPP_DEFAULT_TO` to your number in `.env`.

Without credentials the demo still works: every WhatsApp message is logged to the `wa_messages` table and visible in the Demo Console, so you can rehearse the conversation logic offline.

**Honest demo framing**: the test number is Meta's official developer sandbox — real WhatsApp delivery to your verified phones, free, but capped at 5 recipients and not for production traffic. Going commercial means business verification and a registered number; the code doesn't change.
