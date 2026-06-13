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
CREATE TABLE IF NOT EXISTS app_state (
  k TEXT PRIMARY KEY, v TEXT
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
function seedSearches(persona) {
  const P = (persona && PERSONAS[persona]) || PERSONAS[DEFAULT_PERSONA];
  const isr = db.prepare(`INSERT INTO searches (user_id,origin,dest,travel_date,pax,results,device,created_at) VALUES (1,?,?,?,?,?,?,?)`);
  const dayAgo = (n) => new Date(Date.now() - n * 86400e3).toISOString().replace("T", " ").slice(0, 19);
  // each search row: [origin, dest, date, pax, results, device, daysAgo]
  P.searches.forEach(([o, d, date, pax, results, device, ago]) => isr.run(o, d, date, pax, results, device, dayAgo(ago)));
}

// Seeded bookings — 10 total: 8 past (completed) + 2 active/upcoming. Reused by
// initial seed AND reset, so Daniel always has a real booking history that drives
// personalization across the site, web chat, WhatsApp and the AI planner.
// Each booking needs a matching flights row (personalization joins bookings→flights),
// so we seed those too.
/* ── PERSONAS ──────────────────────────────────────────────────────
   Three full personas, each with the same depth of data as Daniel.
   Exactly ONE persona occupies the live customer record (user_id=1) at a
   time; switching persona re-seeds with that persona's profile, history,
   bookings, ancillary patterns, searches and destinations. This keeps all
   existing single-user queries working while showing the personalization
   engine adapt to genuinely different travellers. */
const PERSONAS = {
  daniel: {
    id: "daniel", label: "Daniel Ferreira", blurb: "Gold · Porto business commuter", archetype: "Digital Commuter",
    user: { member_no: "PT-884512", first_name: "Daniel", full_name: "Daniel Ferreira", email: "daniel.ferreira@consultmail.pt", phone: "+351 91 442 7781", tier: "Gold", miles: 48230, nationality: "Portuguese", doc_id: "PT •••• 3391", home_airport: "OPO", card_brand: "Visa", card_last4: "4417", card_exp: "08/28" },
    prefs: { seat: "4C — front aisle", seat_note: "Chosen on 11 of your last 12 flights", bag: "Cabin bag only", meal: "Espresso + pastel de nata", auto_checkin: 1 },
    voucher: { code: "EMD-2291", amount: 35, reason: "Service recovery", expiry: "30 Sep 2026" },
    synced: { origin: "OPO", dest: "LIS", date: "2026-06-15", device: "MacBook Pro" },
    ancillaries: [
      ["seat","Seat 4C — front aisle","Your usual seat. Free for Gold.",0,9,1,"seat"],
      ["bag","Cabin bag 10kg","Included in your fare.",0,null,1,"bag"],
      ["meal","Espresso + pastel de nata","Pre-ordered to seat. Your usual.",4.5,null,1,"meal"],
      ["wifi","Wi-Fi messaging pass","Stay reachable in the air.",3,null,0,"wifi"],
      ["transfer","Lisbon airport transfer","Driver to Av. da Liberdade, 09:30.",18,null,0,"car"],
      ["lounge","TAP Premium Lounge OPO","Complimentary — Gold benefit.",0,null,0,"lounge"],
    ],
    destinations: [
      ["Lisbon","LIS","Your weekly route",62,null,"🌉"],
      ["Madrid","MAD","Clients you visited in March",89,null,"🏛️"],
      ["Paris","CDG","Searched 3× this month",121,null,"🗼"],
      ["Funchal","FNC","Weekend escape · miles eligible",54,15000,"🌴"],
    ],
    history: [
      ["TP1927","OPO→LIS","2026-02-23","07:05","Business"],["TP1943","LIS→OPO","2026-02-26","18:35","Business"],
      ["TP1927","OPO→LIS","2026-03-02","07:05","Business"],["TP1943","LIS→OPO","2026-03-05","18:35","Business"],
      ["TP1921","OPO→LIS","2026-03-09","06:35","Business"],["TP1943","LIS→OPO","2026-03-12","18:35","Business"],
      ["TP1927","OPO→LIS","2026-03-16","07:05","Business"],["TP1943","LIS→OPO","2026-03-19","18:35","Business"],
      ["TP1927","OPO→LIS","2026-03-23","07:05","Business"],["TP1943","LIS→OPO","2026-03-26","18:35","Business"],
      ["TP1927","OPO→LIS","2026-04-06","07:05","Business"],["TP1943","LIS→OPO","2026-04-09","18:35","Business"],
      ["TP1931","OPO→LIS","2026-04-13","09:10","Business"],["TP1927","OPO→LIS","2026-04-20","07:05","Business"],
      ["TP1927","OPO→LIS","2026-05-04","07:05","Business"],["TP1927","OPO→LIS","2026-05-11","07:05","Business"],
      ["TP1937","OPO→LIS","2026-05-18","12:40","Business"],["TP1927","OPO→LIS","2026-06-01","07:05","Business"],
      ["TP1080","OPO→MAD","2026-03-11","07:40","Business"],["TP1081","MAD→OPO","2026-03-13","19:30","Business"],
      ["TP1080","OPO→MAD","2026-04-15","07:40","Business"],["TP1081","MAD→OPO","2026-04-17","19:30","Business"],
      ["TP1080","OPO→MAD","2026-05-20","07:40","Business"],["TP1081","MAD→OPO","2026-05-22","19:30","Business"],
      ["TP440","OPO→CDG","2026-02-10","08:20","Business"],["TP441","CDG→OPO","2026-02-12","20:10","Business"],
      ["TP1690","OPO→FNC","2026-04-25","09:15","Leisure"],["TP1691","FNC→OPO","2026-04-27","17:00","Leisure"],
    ],
    bookings: [
      ["TPQ4K2","TP1927","OPO","LIS","07:05","08:00",86,"2026-03-02","4C","completed",1,["seat","bag","meal"]],
      ["TPM8R1","TP1943","LIS","OPO","18:35","19:30",84,"2026-03-05","4C","completed",1,["seat","bag","meal","wifi"]],
      ["TPW2N7","TP1080","OPO","MAD","07:40","09:55",97,"2026-03-11","4C","completed",1,["seat","bag","meal","lounge"]],
      ["TPL9V3","TP1927","OPO","LIS","07:05","08:00",86,"2026-03-23","4C","completed",1,["seat","bag","meal","wifi"]],
      ["TPF5J8","TP1080","OPO","MAD","07:40","09:55",92,"2026-04-15","4C","completed",1,["seat","bag","meal","wifi","lounge"]],
      ["TPB7H4","TP1690","OPO","FNC","09:15","10:45",54,"2026-04-25","11A","completed",1,["seat","bag","meal"]],
      ["TPX1C9","TP1927","OPO","LIS","07:05","08:00",79,"2026-05-04","4C","completed",1,["seat","bag","meal","wifi","transfer"]],
      ["TPK6D2","TP1080","OPO","MAD","07:40","09:55",95,"2026-05-20","4C","completed",1,["seat","bag","meal","wifi","lounge"]],
      ["TPN3T5","TP1927","OPO","LIS","07:05","08:00",86,"2026-06-15","4C","confirmed",0,["seat","bag","meal"]],
      ["TPG8Y1","TP1080","OPO","MAD","07:40","09:55",98,"2026-06-22","4C","confirmed",0,["seat","bag","meal"]],
    ],
    searches: [
      ["OPO","CDG","2026-06-19",1,3,"MacBook Pro",2],
      ["OPO","CDG","2026-07-03",1,3,"MacBook Pro",1],
      ["LIS","FNC","2026-08-01",3,2,"MacBook Pro",6],
    ],
  },

  sofia: {
    id: "sofia", label: "Sofia Marques", blurb: "Silver · Lisbon leisure & family", archetype: "Family Explorer",
    user: { member_no: "PT-552037", first_name: "Sofia", full_name: "Sofia Marques", email: "sofia.marques@familymail.pt", phone: "+351 96 220 1184", tier: "Silver", miles: 21450, nationality: "Portuguese", doc_id: "PT •••• 7720", home_airport: "LIS", card_brand: "Mastercard", card_last4: "8852", card_exp: "05/27" },
    prefs: { seat: "14F — window", seat_note: "Window seat on 7 of your last 9 family trips", bag: "2 checked bags", meal: "Kids meal + vegetarian", auto_checkin: 1 },
    voucher: { code: "EMD-7741", amount: 50, reason: "Flight delay goodwill", expiry: "31 Dec 2026" },
    synced: { origin: "LIS", dest: "BCN", date: "2026-07-20", device: "iPhone" },
    ancillaries: [
      ["seat","Seat 14F — window","Window for the kids. Extra legroom row.",6,12,1,"seat"],
      ["bag","2 checked bags 23kg","You always travel with checked luggage.",0,null,1,"bag"],
      ["meal","Kids meal + vegetarian","Pre-ordered for the family.",0,null,1,"meal"],
      ["wifi","Wi-Fi full pass","Keep the kids entertained.",6,null,0,"wifi"],
      ["transfer","Barcelona family transfer","7-seater to the hotel.",32,null,0,"car"],
      ["lounge","TAP Family Lounge LIS","Kids zone + snacks.",24,null,0,"lounge"],
    ],
    destinations: [
      ["Barcelona","BCN","Your summer favourite",78,null,"🏖️"],
      ["Funchal","FNC","Family weekends · 4× this year",54,12000,"🌴"],
      ["Faro","FAO","Searched 4× — beach season",39,null,"☀️"],
      ["Rome","FCO","On your wishlist",132,null,"🏛️"],
    ],
    history: [
      ["TP1696","LIS→FNC","2026-02-14","10:20","Leisure"],["TP1697","FNC→LIS","2026-02-17","18:10","Leisure"],
      ["TP1696","LIS→FNC","2026-04-03","10:20","Leisure"],["TP1697","FNC→LIS","2026-04-06","18:10","Leisure"],
      ["TP1030","LIS→BCN","2026-04-28","11:15","Leisure"],["TP1031","BCN→LIS","2026-05-02","19:40","Leisure"],
      ["TP1696","LIS→FNC","2026-05-23","10:20","Leisure"],["TP1697","FNC→LIS","2026-05-26","18:10","Leisure"],
      ["TP1240","LIS→FAO","2026-03-15","09:30","Leisure"],["TP1241","FAO→LIS","2026-03-17","20:00","Leisure"],
      ["TP1696","LIS→FNC","2026-06-06","10:20","Leisure"],["TP1697","FNC→LIS","2026-06-08","18:10","Leisure"],
    ],
    bookings: [
      ["TPS1A2","TP1696","LIS","FNC","10:20","11:50",58,"2026-02-14","14F","completed",1,["seat","bag","meal"]],
      ["TPS2B3","TP1030","LIS","BCN","11:15","13:35",82,"2026-04-28","14F","completed",1,["seat","bag","meal","wifi"]],
      ["TPS3C4","TP1696","LIS","FNC","10:20","11:50",61,"2026-04-03","14F","completed",1,["seat","bag","meal"]],
      ["TPS4D5","TP1240","LIS","FAO","09:30","10:25",42,"2026-03-15","14F","completed",1,["seat","bag","meal","wifi"]],
      ["TPS5E6","TP1696","LIS","FNC","10:20","11:50",58,"2026-05-23","14F","completed",1,["seat","bag","meal","transfer"]],
      ["TPS6F7","TP1696","LIS","FNC","10:20","11:50",55,"2026-06-06","14F","completed",1,["seat","bag","meal","wifi"]],
      ["TPS7G8","TP1030","LIS","BCN","11:15","13:35",79,"2026-07-20","14F","confirmed",0,["seat","bag","meal","wifi"]],
      ["TPS8H9","TP1696","LIS","FNC","10:20","11:50",60,"2026-08-15","14F","confirmed",0,["seat","bag","meal"]],
    ],
    searches: [
      ["LIS","FAO","2026-07-10",4,4,"iPhone",1],
      ["LIS","BCN","2026-07-20",4,2,"iPhone",2],
      ["LIS","FCO","2026-09-05",2,1,"iPhone",4],
    ],
  },

  lars: {
    id: "lars", label: "Lars Andersen", blurb: "Platinum · Frankfurt long-haul exec", archetype: "Long-haul Executive",
    user: { member_no: "DE-100294", first_name: "Lars", full_name: "Lars Andersen", email: "lars.andersen@globalconsult.de", phone: "+49 151 2244 7788", tier: "Platinum", miles: 184920, nationality: "German", doc_id: "DE •••• 1180", home_airport: "FRA", card_brand: "Amex", card_last4: "1009", card_exp: "11/29" },
    prefs: { seat: "2A — business window", seat_note: "Business window on 12 of your last 14 long-hauls", bag: "2 bags + priority", meal: "Business — no pork", auto_checkin: 1 },
    voucher: { code: "EMD-9930", amount: 120, reason: "Platinum loyalty bonus", expiry: "30 Jun 2027" },
    synced: { origin: "FRA", dest: "JFK", date: "2026-07-08", device: "ThinkPad" },
    ancillaries: [
      ["seat","Seat 2A — business window","Your usual business window.",0,90,1,"seat"],
      ["bag","2 bags + priority","Included with Platinum.",0,null,1,"bag"],
      ["meal","Business — no pork","Pre-set dietary preference.",0,null,1,"meal"],
      ["wifi","Full-flight Wi-Fi","You buy this every long-haul.",18,null,1,"wifi"],
      ["transfer","Manhattan chauffeur","Black car to Midtown.",95,null,0,"car"],
      ["lounge","TAP/Star Alliance Lounge","Complimentary — Platinum.",0,null,1,"lounge"],
    ],
    destinations: [
      ["New York","JFK","Your most-flown route",612,null,"🗽"],
      ["São Paulo","GRU","Quarterly client visits",740,null,"🌆"],
      ["Lisbon","LIS","Frequent connection hub",148,null,"🌉"],
      ["Miami","MIA","Searched 2× this month",588,null,"🌴"],
    ],
    history: [
      ["TP201","FRA→JFK","2026-02-04","10:40","Business"],["TP202","JFK→FRA","2026-02-09","18:20","Business"],
      ["TP201","FRA→JFK","2026-03-03","10:40","Business"],["TP202","JFK→FRA","2026-03-07","18:20","Business"],
      ["TP8050","FRA→GRU","2026-03-20","21:50","Business"],["TP8051","GRU→FRA","2026-03-27","19:10","Business"],
      ["TP201","FRA→JFK","2026-04-08","10:40","Business"],["TP202","JFK→FRA","2026-04-13","18:20","Business"],
      ["TP201","FRA→JFK","2026-05-06","10:40","Business"],["TP202","JFK→FRA","2026-05-11","18:20","Business"],
      ["TP8050","FRA→GRU","2026-05-19","21:50","Business"],["TP8051","GRU→FRA","2026-05-26","19:10","Business"],
      ["TP201","FRA→JFK","2026-06-03","10:40","Business"],["TP202","JFK→FRA","2026-06-08","18:20","Business"],
    ],
    bookings: [
      ["TPL1A2","TP201","FRA","JFK","10:40","13:30",612,"2026-02-04","2A","completed",1,["seat","bag","meal","wifi","lounge"]],
      ["TPL2B3","TP8050","FRA","GRU","21:50","05:20",740,"2026-03-20","2A","completed",1,["seat","bag","meal","wifi","lounge"]],
      ["TPL3C4","TP201","FRA","JFK","10:40","13:30",598,"2026-03-03","2A","completed",1,["seat","bag","meal","wifi","lounge","transfer"]],
      ["TPL4D5","TP201","FRA","JFK","10:40","13:30",625,"2026-04-08","2A","completed",1,["seat","bag","meal","wifi","lounge"]],
      ["TPL5E6","TP201","FRA","JFK","10:40","13:30",610,"2026-05-06","2A","completed",1,["seat","bag","meal","wifi","lounge","transfer"]],
      ["TPL6F7","TP8050","FRA","GRU","21:50","05:20",728,"2026-05-19","2A","completed",1,["seat","bag","meal","wifi","lounge"]],
      ["TPL7G8","TP201","FRA","JFK","10:40","13:30",612,"2026-07-08","2A","confirmed",0,["seat","bag","meal","wifi","lounge"]],
      ["TPL8H9","TP8050","FRA","GRU","21:50","05:20",740,"2026-07-25","2A","confirmed",0,["seat","bag","meal","wifi","lounge"]],
    ],
    searches: [
      ["FRA","MIA","2026-08-12",1,2,"ThinkPad",1],
      ["FRA","JFK","2026-07-08",1,3,"ThinkPad",3],
      ["FRA","GRU","2026-07-25",1,1,"ThinkPad",5],
    ],
  },
};
const DEFAULT_PERSONA = "daniel";

function seedBookings(persona) {
  const P = (persona && PERSONAS[persona]) || PERSONAS[DEFAULT_PERSONA];
  const B = P.bookings;
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

function seed(personaId) {
  const c = db.prepare("SELECT COUNT(*) n FROM users").get().n;
  if (c > 0) return;
  seedPersonaData(personaId || process.env.PERSONA || DEFAULT_PERSONA);
}

// Inserts everything for ONE persona into the live customer record (user_id=1).
// Used by initial seed AND by the persona-switch / reset paths.
function seedPersonaData(personaId) {
  const P = PERSONAS[personaId] || PERSONAS[DEFAULT_PERSONA];
  const u = P.user;
  db.prepare(`INSERT INTO users (id,member_no,first_name,full_name,email,phone,tier,miles,nationality,doc_id,home_airport,card_brand,card_last4,card_exp)
    VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(u.member_no, u.first_name, u.full_name, process.env.DEMO_EMAIL_TO || u.email, u.phone, u.tier, u.miles, u.nationality, u.doc_id, u.home_airport, u.card_brand, u.card_last4, u.card_exp);

  const p = P.prefs;
  db.prepare(`INSERT INTO preferences VALUES (1,?,?,?,?,?)`).run(p.seat, p.seat_note, p.bag, p.meal, p.auto_checkin);
  const v = P.voucher;
  db.prepare(`INSERT INTO vouchers (user_id,code,amount,reason,expiry) VALUES (1,?,?,?,?)`).run(v.code, v.amount, v.reason, v.expiry);

  // Airports & route network (shared across personas)
  if (db.prepare("SELECT COUNT(*) c FROM airports").get().c === 0) {
    const ia = db.prepare("INSERT OR IGNORE INTO airports (code,city,country,region) VALUES (?,?,?,?)");
    for (const [code, a] of Object.entries(AIRPORTS)) ia.run(code, a.city, a.country, a.region);
    const ir = db.prepare("INSERT INTO routes (origin,dest,duration_min,base_fare,region) VALUES (?,?,?,?,?)");
    for (const [o, d, dur, fare] of ROUTES) {
      const region = AIRPORTS[o].region === "Europe" && AIRPORTS[d].region === "Europe" ? "Europe" : "Intercontinental";
      ir.run(o, d, dur, fare, region);
    }
  }

  // Travel history (drives "Picked for you" reasons)
  const ih = db.prepare("INSERT INTO travel_history (user_id,flight_no,route,trip_date,dep_time,purpose) VALUES (1,?,?,?,?,?)");
  P.history.forEach(h => ih.run(...h));

  // Bookings (+ matching flights + payments) and behavioural searches
  seedBookings(personaId);
  seedSearches(personaId);

  // The live "continue your last search" banner
  const s = P.synced;
  db.prepare(`INSERT INTO synced_searches (user_id,origin,dest,travel_date,pax,device,created_at)
    VALUES (1,?,?,?,1,?, ?)`).run(s.origin, s.dest, s.date, s.device, now());

  // Ancillary catalog (personalized per persona)
  const an = db.prepare("INSERT INTO ancillaries (code,name,descr,price,was,auto,icon) VALUES (?,?,?,?,?,?,?)");
  P.ancillaries.forEach(a => an.run(...a));

  // Personalized destination cards
  const de = db.prepare("INSERT INTO destinations (city,code,tag,price,miles_price,emoji) VALUES (?,?,?,?,?,?)");
  P.destinations.forEach(d => de.run(...d));

  db.prepare("INSERT INTO events (type,payload_json,created_at) VALUES ('db_seeded',?,?)").run(JSON.stringify({ persona: personaId }), now());
  db.prepare("INSERT INTO app_state (k,v) VALUES ('persona',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(personaId);
  console.log(`✓ Database seeded for persona '${personaId}' → ` + DB_PATH);
}
seed();

module.exports = { db, now, DB_PATH, seedSearches, seedBookings, seedPersonaData, PERSONAS, DEFAULT_PERSONA };
