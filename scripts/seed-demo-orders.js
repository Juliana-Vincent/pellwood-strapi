/**
 * Fills a LOCAL Strapi with demo orders, so the Objednávky page has something to
 * show. Never point this at the server - it creates real rows.
 *
 *   node scripts/seed-demo-orders.js <admin-email> <admin-password> [url]
 */
const [, , email, password, base = 'http://localhost:1337'] = process.argv;

if (!email || !password) {
  console.error('Usage: node scripts/seed-demo-orders.js <admin-email> <admin-password> [url]');
  process.exit(1);
}
if (!/localhost|127\.0\.0\.1/.test(base)) {
  console.error('Refusing to seed anything but a local Strapi.');
  process.exit(1);
}

const people = [
  ['Jana', 'Nováková', 'jana@priklad.cz'],
  ['Petr', 'Svoboda', 'petr@priklad.cz'],
  ['Eva', 'Dvořáková', 'eva@priklad.cz'],
  ['Tomáš', 'Horák', 'tomas@priklad.cz'],
  ['Lucie', 'Němcová', 'lucie@priklad.cz'],
  ['Martin', 'Kučera', 'martin@priklad.cz'],
  ['Anna', 'Marková', 'anna@priklad.cz'],
];

const orders = [
  { paymentStatus: 'PAID', payOnline: true, state: 'new', sum: 1248, currency: 'Kč', deliveryMethod: 'PPL standardní doručení v ČR', deliveryPrice: '150 Kč', paymentMethod: 'Platba kartou on-line', paymentPrice: 'ZDARMA' },
  { paymentStatus: 'PENDING', payOnline: true, state: 'new', sum: 649, currency: 'Kč', deliveryMethod: 'PPL standardní doručení v ČR', deliveryPrice: '150 Kč', paymentMethod: 'Platba kartou on-line', paymentPrice: 'ZDARMA' },
  { paymentStatus: '', payOnline: false, state: 'new', sum: 536, currency: 'Kč', deliveryMethod: 'Zásilkovna', deliveryPrice: '79 Kč', paymentMethod: 'Na dobírku', paymentPrice: '30 Kč' },
  { paymentStatus: 'PAID', payOnline: true, state: 'packed', sum: 51.76, currency: '€', deliveryMethod: 'DPD Europe', deliveryPrice: 'ZDARMA', paymentMethod: 'Card payment', paymentPrice: 'FREE' },
  { paymentStatus: 'CANCELLED', payOnline: true, state: 'cancelled', sum: 399, currency: 'Kč', deliveryMethod: 'PPL standardní doručení v ČR', deliveryPrice: '150 Kč', paymentMethod: 'Platba kartou', paymentPrice: 'ZDARMA' },
  { paymentStatus: '', payOnline: false, state: 'shipped', sum: 1178, currency: 'Kč', deliveryMethod: 'Osobní odběr', deliveryPrice: 'ZDARMA', paymentMethod: 'Na dobírku', paymentPrice: '30 Kč' },
  { paymentStatus: 'PAID', payOnline: true, state: 'delivered', sum: 2480, currency: 'Kč', deliveryMethod: 'PPL standardní doručení v ČR', deliveryPrice: '150 Kč', paymentMethod: 'Platba kartou on-line', paymentPrice: 'ZDARMA' },
];

(async () => {
  const login = await fetch(`${base}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!login.ok) {
    console.error('Login failed:', login.status, (await login.text()).slice(0, 200));
    process.exit(1);
  }
  const token = (await login.json()).data.token;

  for (let i = 0; i < orders.length; i++) {
    const [name, surname, mail] = people[i];
    const lines = [
      { id: 'a', nameProduct: 'Paličky 5A', variantName: 'Hickory', countVariant: i + 1, variantPrice: 249 },
      { id: 'b', nameProduct: 'Mikina PELLWOOD', variantName: 'M', countVariant: 1, variantPrice: 799 },
    ];
    const extra = (value) => (Number.isFinite(Number(value)) ? 0 : Number(String(value).replace(/[^\d.]/g, '')) || 0);
    const subtotal = lines.reduce((sum, line) => sum + line.variantPrice * line.countVariant, 0);
    const body = {
      ...orders[i],
      sum: subtotal + extra(orders[i].deliveryPrice) + extra(orders[i].paymentPrice),
      idOrder: 1204000 + i * 13457,
      name,
      surname,
      email: mail,
      phone: '+420 777 123 45' + i,
      city: 'Praha',
      address: 'Vinohradská 1234/56',
      code: '12000',
      country: 'cz',
      orderDate: new Date(Date.now() - i * 9e6 * 4).toISOString(),
      note: i === 2 ? 'Prosím zabalit jako dárek.' : '',
      basket: lines,
    };
    const res = await fetch(`${base}/content-manager/collection-types/api::order.order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    console.log(`#${body.idOrder}`, res.status === 201 ? 'ok' : (await res.text()).slice(0, 140));
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
