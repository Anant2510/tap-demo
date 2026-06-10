/* ──────────────────────────────────────────────────────────────
   TAP Demo — SQLite database layer (file: data/tap.db)
   Uses Node's built-in sqlite (Node >= 22). No native builds.
   This is the customer data store we'd later sync with a CDP.
   ────────────────────────────────────────────────────────────── */
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");

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
`);

const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);

function seed() {
  const c = db.prepare("SELECT COUNT(*) n FROM users").get().n;
  if (c > 0) return;

  db.prepare(`INSERT INTO users (member_no,first_name,full_name,email,phone,tier,miles,nationality,doc_id,home_airport,card_brand,card_last4,card_exp)
    VALUES ('PT-884512','Daniel','Daniel Ferreira', ?, '+351 91 442 7781','Gold',48230,'Portuguese','PT •••• 3391','OPO','Visa','4417','08/28')`)
    .run(process.env.DEMO_EMAIL_TO || "daniel.ferreira@consultmail.pt");

  db.prepare(`INSERT INTO preferences VALUES (1,'4C — front aisle','Chosen on 11 of your last 12 flights','Cabin bag only','Espresso + pastel de nata',1)`).run();
  db.prepare(`INSERT INTO vouchers (user_id,code,amount,reason,expiry) VALUES (1,'EMD-2291',35,'Service recovery','30 Sep 2026')`).run();

  // 15 past trips — 12 outbound OPO→LIS, of which 9 match the Monday 07:05 pattern
  const hist = [
    ["TP1927","OPO→LIS","2026-02-23","07:05"],["TP1927","OPO→LIS","2026-03-02","07:05"],
    ["TP1921","OPO→LIS","2026-03-09","06:35"],
    ["TP1927","OPO→LIS","2026-03-16","07:05"],["TP1943","LIS→OPO","2026-03-19","18:35"],
    ["TP1927","OPO→LIS","2026-03-23","07:05"],["TP1943","LIS→OPO","2026-03-26","18:35"],
    ["TP1927","OPO→LIS","2026-04-06","07:05"],["TP1943","LIS→OPO","2026-04-09","18:35"],
    ["TP1931","OPO→LIS","2026-04-13","09:10"],["TP1927","OPO→LIS","2026-04-20","07:05"],
    ["TP1927","OPO→LIS","2026-05-04","07:05"],["TP1927","OPO→LIS","2026-05-11","07:05"],
    ["TP1937","OPO→LIS","2026-05-18","12:40"],["TP1927","OPO→LIS","2026-06-01","07:05"],
  ];
  const ih = db.prepare("INSERT INTO travel_history (user_id,flight_no,route,trip_date,dep_time,purpose) VALUES (1,?,?,?,?,'Business')");
  hist.forEach(h => ih.run(...h));

  db.prepare(`INSERT INTO synced_searches (user_id,origin,dest,travel_date,pax,device,created_at)
    VALUES (1,'OPO','LIS','2026-06-15',1,'MacBook Pro', ?)`).run(now());

  const fl = db.prepare(`INSERT INTO flights (flight_no,origin,dest,dep,arr,duration,aircraft,price,seats_left,flight_date,recommended,lowest)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  fl.run("TP1921","OPO","LIS","06:35","07:30","55m","A320neo",74,31,"2026-06-15",0,0);
  fl.run("TP1927","OPO","LIS","07:05","08:00","55m","A321neo",86,18,"2026-06-15",1,0);
  fl.run("TP1931","OPO","LIS","09:10","10:05","55m","A320neo",62,44,"2026-06-15",0,1);
  fl.run("TP1937","OPO","LIS","12:40","13:35","55m","A319",69,52,"2026-06-15",0,0);
  fl.run("TP1943","OPO","LIS","18:35","19:30","55m","A321neo",91,12,"2026-06-15",0,0);

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
  de.run("Funchal","FNC","Weekend escape · miles eligible",0,15000,"🌴");

  db.prepare("INSERT INTO events (type,payload_json,created_at) VALUES ('db_seeded','{}',?)").run(now());
  console.log("✓ Database seeded → " + DB_PATH);
}
seed();

module.exports = { db, now, DB_PATH };
