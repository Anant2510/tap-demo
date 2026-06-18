/* Affinity-driven travel packages (event ticket + hotel + return flight).
   Each persona's co-branded card spend profile derives an `affinity`
   (football / golf / music), and we surface a matching bundle in a city
   they fly to. Prices are demo values; the bundle total = flight + hotel + event. */

// Helper to assemble a package object with computed total.
function pkg({ id, affinity, badge, city, code, event, venue, date, eventPrice, hotel, hotelNights, hotelPrice, flightDesc, flightPrice, image, blurb, addon }) {
  const total = eventPrice + hotelPrice + flightPrice;
  return { id, affinity, badge, city, code, event, venue, date, eventPrice, hotel, hotelNights, hotelPrice, flightDesc, flightPrice, total, image, blurb, addon };
}

// Packages by affinity. `home` is filled per-request so the return flight is correct.
const PACKAGES = {
  football: (home) => pkg({
    id: "wc-final-week",
    affinity: "football",
    badge: "FIFA World Cup 2026",
    city: "New York",
    code: "JFK",
    event: "World Cup Quarter-Final",
    venue: "MetLife Stadium · East Rutherford",
    date: "2026-07-11",
    eventPrice: 290,
    hotel: "Manhattan NoMad · 4★",
    hotelNights: 3,
    hotelPrice: 540,
    flightDesc: `Return ${home} ⇄ JFK · Economy`,
    flightPrice: 612,
    image: "https://images.unsplash.com/photo-1577223625816-7546f13df25d?auto=format&fit=crop&w=1000&q=80",
    blurb: "You stream every match and your card sees the stadium spend — here's the real thing. Match ticket, 3 nights in Manhattan, and your return flight, one tap.",
    addon: null,
  }),
  golf: (home) => pkg({
    id: "algarve-open",
    affinity: "golf",
    badge: "DP World Tour",
    city: "Faro",
    code: "FAO",
    event: "Portugal Masters — Final Round",
    venue: "Dom Pedro Victoria GC · Vilamoura",
    date: "2026-06-21",
    eventPrice: 95,
    hotel: "Vilamoura Resort · 4★ (golf view)",
    hotelNights: 2,
    hotelPrice: 320,
    flightDesc: `Return ${home} ⇄ FAO · Economy`,
    flightPrice: 138,
    image: "https://images.unsplash.com/photo-1535131749006-b7f58c99034b?auto=format&fit=crop&w=1000&q=80",
    blurb: "Your weekends and your card both point to the fairway. Tournament grounds pass, 2 nights on the course, and your return flight — clubs welcome.",
    addon: { code: "golfbag", label: "Golf-kit check-in bag (15kg)", normal: 45, price: 28, note: "We noticed you usually fly weekends — add your clubs for less when you book this trip." },
  }),
  music: (home) => pkg({
    id: "lisbon-live",
    affinity: "music",
    badge: "Live in Lisbon",
    city: "Lisbon",
    code: "LIS",
    event: "Coldplay · Music of the Spheres",
    venue: "Estádio da Luz · Lisbon",
    date: "2026-06-28",
    eventPrice: 145,
    hotel: "Avenida Boutique · 5★",
    hotelNights: 2,
    hotelPrice: 430,
    flightDesc: `Return ${home} ⇄ LIS · Business`,
    flightPrice: 540,
    image: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=1000&q=80",
    blurb: "Concerts top your card spend, and this one's in a city you already love. Floor ticket, 2 nights downtown, and your return flight in Business.",
    addon: null,
  }),
};

// Return the package for a given affinity + home airport (or null).
function packageFor(affinity, home) {
  const make = PACKAGES[affinity];
  return make ? make(home || "LIS") : null;
}

module.exports = { packageFor };
