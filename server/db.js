/* ──────────────────────────────────────────────────────────────
   TAP Demo — SQLite database layer (file: data/tap.db)
   Uses Node's built-in sqlite (Node >= 22). No native builds.
   This is the customer data store we'd later sync with a CDP.
   ────────────────────────────────────────────────────────────── */
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");
const { AIRPORTS, ROUTES } = require("./routes-data");

const DATA_DIR = path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, "tap.db");
const db = new DatabaseSync(DB_PATH);

db.exec(`
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, member_no TEXT UNIQUE, first_name TEXT, full_name TEXT,
  email TEXT, phone TEXT, tier TEXT, miles INTEGER, nationality TEXT,
  doc_id TEXT, home_airport TEXT, card_brand TEXT, card_last4 TEXT, card_exp TEXT
);
CREATE TABLE IF NOT EXISTS preferences (
  user_id INTEGER PRIMARY KEY, seat TEXT, seat_note TEXT, bag TEXT, meal TEXT, auto_checkin INTEGER
);
CREATE TABLE IF NOT EXISTS vouchers (
  id INTEGER PRIMARY KEY, user_id INTEGER, code TEXT, amount REAL, reason TEXT, expiry TEXT, status TEXT DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS travel_history (
  id INTEGER PRIMARY KEY, user_id INTEGER, flight_no TEXT, route TEXT, trip_date TEXT, dep_time TEXT, purpose TEXT
);
CREATE TABLE IF NOT EXISTS synced_searches (
  id INTEGER PRIMARY KEY, user_id INTEGER, origin TEXT, dest TEXT, travel_date TEXT, pax INTEGER,
  device TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS flights (
  id INTEGER PRIMARY KEY, flight_no TEXT, origin TEXT, dest TEXT, dep TEXT, arr TEXT,
  duration TEXT, aircraft TEXT, price REAL, seats_left INTEGER, flight_date TEXT,
  recommended INTEGER DEFAULT 0, lowest INTEGER DEFAULT 0, status TEXT DEFAULT 'scheduled',
  new_dep TEXT, new_arr TEXT
);
CREATE TABLE IF NOT EXISTS ancillaries (
  id INTEGER PRIMARY KEY, code TEXT UNIQUE, name TEXT, descr TEXT, price REAL, was REAL, auto INTEGER, icon TEXT
);
CREATE TABLE IF NOT EXISTS airports (
  code TEXT PRIMARY KEY, city TEXT, country TEXT, region TEXT
);
CREATE TABLE IF NOT EXISTS routes (
  id INTEGER PRIMARY KEY, origin TEXT, dest TEXT, duration_min INTEGER, base_fare REAL, region TEXT
);
CREATE TABLE IF NOT EXISTS searches (
  id INTEGER PRIMARY KEY, user_id INTEGER, origin TEXT, dest TEXT, travel_date TEXT, pax INTEGER,
  results INTEGER, device TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS destinations (
  id INTEGER PRIMARY KEY, city TEXT, code TEXT, tag TEXT, price REAL, miles_price INTEGER, emoji TEXT
);
CREATE TABLE IF NOT EXISTS baskets (
  id INTEGER PRIMARY KEY, user_id INTEGER, flight_no TEXT, items_json TEXT,
  status TEXT DEFAULT 'open', updated_at TEXT
);
CREATE TABLE IF NOT EXISTS fare_locks (
  id INTEGER PRIMARY KEY, user_id INTEGER, flight_no TEXT, locked_price REAL, expires_at TEXT, status TEXT DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS holds (
  id INTEGER PRIMARY KEY, user_id INTEGER, flight_no TEXT, items_json TEXT, total REAL,
  expires_at TEXT, status TEXT DEFAULT 'active', created_at TEXT
);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY, pnr TEXT, user_id INTEGER, flight_no TEXT, flight_date TEXT,
  seat TEXT, status TEXT DEFAULT 'confirmed', checked_in INTEGER DEFAULT 0,
  items_json TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY, booking_id INTEGER, total REAL, voucher_amt REAL,
  miles_used INTEGER, miles_amt REAL, card_amt REAL, created_at TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, type TEXT, payload_json TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY, user_id INTEGER, to_addr TEXT, subject TEXT, email_type TEXT,
  html TEXT, status TEXT, provider_id TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS wa_messages (
  id INTEGER PRIMARY KEY, direction TEXT, wa_id TEXT, msg_type TEXT, body TEXT,
  payload_json TEXT, status TEXT, created_at TEXT
);
`);

// users.wa_id stores the last WhatsApp sender so the portal can push proactively
try { db.exec("ALTER TABLE users ADD COLUMN wa_id TEXT"); } catch {}

const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);

// Seeded recent searches — reused by initial seed AND by reset, so the demo
// always starts with realistic behavioural signals.
function seedSearches() {
  const isr = db.prepare(`INSERT INTO searches (user_id,origin,dest,travel_date,pax,results,device,created_at) VALUES (1,?,?,?,?,?,?,?)`);
  const dayAgo = (n) => new Date(Date.now() - n * 86400e3).toISOString().replace("T", " ").slice(0, 19);
  isr.run("OPO","CDG","2026-06-19",1,3,"MacBook Pro",dayAgo(2));   // researching a Paris return
  isr.run("OPO","CDG","2026-06-26",1,3,"iPhone",dayAgo(2));
  isr.run("OPO","CDG","2026-07-03",1,3,"MacBook Pro",dayAgo(1));   // 3× → "searched 3× this month"
  isr.run("OPO","BCN","2026-07-10",2,4,"iPhone",dayAgo(4));        // Barcelona, 2 pax — a getaway idea
  isr.run("LIS","FNC","2026-08-01",3,2,"MacBook Pro",dayAgo(6));   // Funchal for 3 — family again
}

// Seeded bookings — 10 total: 8 past (completed) + 2 active/upcoming. Reused by
// initial seed AND reset, so Daniel always has a real booking history that drives
// personalization across the site, web chat, WhatsApp and the AI planner.
// Each booking needs a matching flights row (personalization joins bookings→flights),
// so we seed those too.
function seedBookings() {
  // [pnr, flight_no, origin, dest, dep, arr, price, date, seat, status, checked_in, items]
  const B = [
    // ── 8 PAST bookings (completed trips) — varied ancillary history drives upsell personalization ──
    ["TPQ4K2","TP1927","OPO","LIS","07:05","08:00",86,"2026-03-02","4C","completed",1,["seat","bag","meal"]],
    ["TPM8R1","TP1943","LIS","OPO","18:35","19:30",84,"2026-03-05","4C","completed",1,["seat","bag","meal","wifi"]],
    ["TPW2N7","TP1080","OPO","MAD","07:40","09:55",97,"2026-03-11","4C","completed",1,["seat","bag","meal","lounge"]],
    ["TPL9V3","TP1927","OPO","LIS","07:05","08:00",86,"2026-03-23","4C","completed",1,["seat","bag","meal","wifi"]],
    ["TPF5J8","TP1080","OPO","MAD","07:40","09:55",92,"2026-04-15","4C","completed",1,["seat","bag","meal","wifi","lounge"]],
    ["TPB7H4","TP1690","OPO","FNC","09:15","10:45",54,"2026-04-25","11A","completed",1,["seat","bag","meal"]],
    ["TPX1C9","TP1927","OPO","LIS","07:05","08:00",79,"2026-05-04","4C","completed",1,["seat","bag","meal","wifi","transfer"]],
    ["TPK6D2","TP1080","OPO","MAD","07:40","09:55",95,"2026-05-20","4C","completed",1,["seat","bag","meal","wifi","lounge"]],
    // ── 2 ACTIVE / UPCOMING bookings ──
    ["TPN3T5","TP1927","OPO","LIS","07:05","08:00",86,"2026-06-15","4C","confirmed",0,["seat","bag","meal"]],
    ["TPG8Y1","TP1080","OPO","MAD","07:40","09:55",98,"2026-06-22","4C","confirmed",0,["seat","bag","meal"]],
  ];
  // Seed ONE flights row per unique flight_no (personalization joins bookings→flights;
  // duplicate flight_no rows would inflate counts). Booking carries its own date/seat.
  const seenFlights = new Set(db.prepare("SELECT flight_no FROM flights").all().map(r => r.flight_no));
  const insF = db.prepare(`INSERT INTO flights (flight_no,origin,dest,dep,arr,duration,aircraft,price,seats_left,flight_date,recommended,status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?, 'scheduled')`);
  const insB = db.prepare(`INSERT INTO bookings (pnr,user_id,flight_no,flight_date,seat,status,checked_in,items_json,created_at)
    VALUES (?,1,?,?,?,?,?,?,?)`);
  const insP = db.prepare(`INSERT INTO payments (booking_id,total,voucher_amt,miles_used,miles_amt,card_amt,created_at)
    VALUES (?,?,?,?,?,?,?)`);
  B.forEach(([pnr,fno,o,d,dep,arr,price,date,seat,status,ci,items]) => {
    if (!seenFlights.has(fno)) {
      const dur = d === "FNC" ? "1h30" : (d === "MAD" ? "2h15" : "0h55");
      insF.run(fno, o, d, dep, arr, dur, "A320neo", price, 9, date, fno === "TP1927" ? 1 : 0);
      seenFlights.add(fno);
    }
    const createdAt = date + " 08:30:00";
    const r = insB.run(pnr, fno, date, seat, status, ci, JSON.stringify(items), createdAt);
    insP.run(Number(r.lastInsertRowid), price, 0, 0, 0, +price.toFixed(2), createdAt);
  });
}

function seed() {
  const c = db.prepare("SELECT COUNT(*) n FROM users").get().n;
  if (c > 0) return;

  db.prepare(`INSERT INTO users (member_no,first_name,full_name,email,phone,tier,miles,nationality,doc_id,home_airport,card_brand,card_last4,card_exp)
    VALUES ('PT-884512','Daniel','Daniel Ferreira', ?, '+351 91 442 7781','Gold',48230,'Portuguese','PT •••• 3391','OPO','Visa','4417','08/28')`)
    .run(process.env.DEMO_EMAIL_TO || "daniel.ferreira@consultmail.pt");

  db.prepare(`INSERT INTO preferences VALUES (1,'4C — front aisle','Chosen on 11 of your last 12 flights','Cabin bag only','Espresso + pastel de nata',1)`).run();
  db.prepare(`INSERT INTO vouchers (user_id,code,amount,reason,expiry) VALUES (1,'EMD-2291',35,'Service recovery','30 Sep 2026')`).run();

  // Airports & route network (100 routes, 50 European)
  const ia = db.prepare("INSERT OR IGNORE INTO airports (code,city,country,region) VALUES (?,?,?,?)");
  for (const [code, a] of Object.entries(AIRPORTS)) ia.run(code, a.city, a.country, a.region);
  const ir = db.prepare("INSERT INTO routes (origin,dest,duration_min,base_fare,region) VALUES (?,?,?,?,?)");
  for (const [o, d, dur, fare] of ROUTES) {
    const region = AIRPORTS[o].region === "Europe" && AIRPORTS[d].region === "Europe" ? "Europe" : "Intercontinental";
    ir.run(o, d, dur, fare, region);
  }

  // ── Daniel's travel history — designed so every "Picked for you" card has a real reason ──
  // Dominant pattern: OPO→LIS Mondays 07:05 (TP1927). Plus genuine Madrid (client), Paris,
  // and a Funchal family weekend (Leisure) so personalization has depth across purposes.
  const hist = [
    // Weekly Lisbon commute (the headline pattern: 9 of 12 outbound are TP1927 07:05)
    ["TP1927","OPO→LIS","2026-02-23","07:05","Business"],["TP1943","LIS→OPO","2026-02-26","18:35","Business"],
    ["TP1927","OPO→LIS","2026-03-02","07:05","Business"],["TP1943","LIS→OPO","2026-03-05","18:35","Business"],
    ["TP1921","OPO→LIS","2026-03-09","06:35","Business"],["TP1943","LIS→OPO","2026-03-12","18:35","Business"],
    ["TP1927","OPO→LIS","2026-03-16","07:05","Business"],["TP1943","LIS→OPO","2026-03-19","18:35","Business"],
    ["TP1927","OPO→LIS","2026-03-23","07:05","Business"],["TP1943","LIS→OPO","2026-03-26","18:35","Business"],
    ["TP1927","OPO→LIS","2026-04-06","07:05","Business"],["TP1943","LIS→OPO","2026-04-09","18:35","Business"],
    ["TP1931","OPO→LIS","2026-04-13","09:10","Business"],["TP1927","OPO→LIS","2026-04-20","07:05","Business"],
    ["TP1927","OPO→LIS","2026-05-04","07:05","Business"],["TP1927","OPO→LIS","2026-05-11","07:05","Business"],
    ["TP1937","OPO→LIS","2026-05-18","12:40","Business"],["TP1927","OPO→LIS","2026-06-01","07:05","Business"],
    // Madrid — recurring client visits (backs the Madrid card: "flown 3×")
    ["TP1080","OPO→MAD","2026-03-11","07:40","Business"],["TP1081","MAD→OPO","2026-03-13","19:30","Business"],
    ["TP1080","OPO→MAD","2026-04-15","07:40","Business"],["TP1081","MAD→OPO","2026-04-17","19:30","Business"],
    ["TP1080","OPO→MAD","2026-05-20","07:40","Business"],["TP1081","MAD→OPO","2026-05-22","19:30","Business"],
    // Paris — a single business trip earlier in the year (backs the Paris card alongside searches)
    ["TP440","OPO→CDG","2026-02-10","08:20","Business"],["TP441","CDG→OPO","2026-02-12","20:10","Business"],
    // Funchal — a family weekend (Leisure — adds a non-business dimension to the profile)
    ["TP1690","OPO→FNC","2026-04-25","09:15","Leisure"],["TP1691","FNC→OPO","2026-04-27","17:00","Leisure"],
  ];
  const ih = db.prepare("INSERT INTO travel_history (user_id,flight_no,route,trip_date,dep_time,purpose) VALUES (1,?,?,?,?,?)");
  hist.forEach(h => ih.run(...h));

  // Seeded bookings — 8 past + 2 active/upcoming, with matching flights + payments
  seedBookings();

  // Seeded recent searches — behavioural signals that exist before the demo even starts
  seedSearches();

  db.prepare(`INSERT INTO synced_searches (user_id,origin,dest,travel_date,pax,device,created_at)
    VALUES (1,'OPO','LIS','2026-06-15',1,'MacBook Pro', ?)`).run(now());

  // Flights are generated on demand by the search engine (server/search.js) for any of the
  // 100 network routes; Daniel's OPO→LIS shuttle is pinned there with real flight numbers.

  const an = db.prepare("INSERT INTO ancillaries (code,name,descr,price,was,auto,icon) VALUES (?,?,?,?,?,?,?)");
  an.run("seat","Seat 4C — front aisle","Your usual seat. Free for Gold.",0,9,1,"seat");
  an.run("bag","Cabin bag 10kg","Included in your fare.",0,null,1,"bag");
  an.run("meal","Espresso + pastel de nata","Pre-ordered to seat. Your usual.",4.5,null,1,"meal");
  an.run("wifi","Wi-Fi messaging pass","Stay reachable in the air.",3,null,0,"wifi");
  an.run("transfer","Lisbon airport transfer","Driver to Av. da Liberdade, 09:30.",18,null,0,"car");
  an.run("lounge","TAP Premium Lounge OPO","Complimentary — Gold benefit.",0,null,0,"lounge");

  const de = db.prepare("INSERT INTO destinations (city,code,tag,price,miles_price,emoji) VALUES (?,?,?,?,?,?)");
  de.run("Lisbon","LIS","Your weekly route",62,null,"🌉");
  de.run("Madrid","MAD","Clients you visited in March",89,null,"🏛️");
  de.run("Paris","CDG","Searched 3× this month",121,null,"🗼");
  de.run("Funchal","FNC","Weekend escape · miles eligible",54,15000,"🌴");

  db.prepare("INSERT INTO events (type,payload_json,created_at) VALUES ('db_seeded','{}',?)").run(now());
  console.log("✓ Database seeded → " + DB_PATH);
}
seed();

module.exports = { db, now, DB_PATH, seedSearches, seedBookings };
