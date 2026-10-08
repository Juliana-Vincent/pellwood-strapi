/**
 * Sets how the Content Manager shows Order, Product, Article and Category:
 * Czech labels, a short description under each field, a sensible order, and the
 * technical fields hidden.
 *
 * Strapi keeps this in the database rather than in a file, so it is applied by a
 * script instead of a patch. It merges into whatever is already stored, so a
 * field nobody listed here keeps its current settings, and running it twice
 * changes nothing.
 *
 *   node scripts/admin-layout.js            show what would change
 *   node scripts/admin-layout.js --apply    write it
 *
 * Afterwards: pm2 restart pellwood-strapi, then reload the admin.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const envPath = path.join(__dirname, '..', '.env');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (match && !process.env[match[1]]) {
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
}

// [label, description] per field; [name, width] per field in a row, 12 per row.
const CONFIG = {
  'api::order.order': {
    settings: { mainField: 'idOrder', defaultSortBy: 'createdAt', defaultSortOrder: 'DESC', pageSize: 50 },
    list: ['idOrder', 'orderDate', 'surname', 'sum', 'state'],
    hidden: ['basket', 'anotherAdress', 'companyData', 'accessToken', 'conversionSent', 'notified', 'searchText'],
    readonly: ['idOrder', 'paymentStatus'],
    fields: {
      idOrder: ['Číslo objednávky', 'Přiděluje e-shop při odeslání objednávky.'],
      orderDate: ['Datum a čas objednávky', ''],
      state: ['Stav vyřízení', 'new = nová, packed = připraveno, shipped = odesláno, delivered = doručeno, cancelled = zrušeno. Pohodlněji se mění v seznamu Objednávky.'],
      paymentStatus: ['Stav platby', 'Nastavuje platební brána Comgate. Needitovat ručně.'],
      name: ['Jméno', ''],
      surname: ['Příjmení', ''],
      email: ['E-mail', 'Sem odešel potvrzovací e-mail.'],
      phone: ['Telefon', ''],
      address: ['Ulice a číslo popisné', ''],
      city: ['Město', ''],
      code: ['PSČ', ''],
      country: ['Země', 'Kód země: cz, sk, de, at.'],
      anotherAddressCheck: ['Jiná doručovací adresa', 'Pokud je zapnuto, zboží jde na jinou adresu než fakturační.'],
      companyDataCheck: ['Nákup na firmu', ''],
      deliveryMethod: ['Způsob dopravy', ''],
      deliveryPrice: ['Cena dopravy', 'Co zákazník opravdu zaplatil - u dopravy zdarma je tu ZDARMA.'],
      paymentMethod: ['Způsob platby', ''],
      paymentPrice: ['Poplatek za platbu', ''],
      payOnline: ['Platba online', 'Zapnuto u platby kartou, vypnuto u dobírky.'],
      sum: ['Celková částka', 'Včetně dopravy a poplatku za platbu.'],
      currency: ['Měna', 'Kč nebo €.'],
      note: ['Poznámka zákazníka', ''],
    },
    edit: [
      [['idOrder', 4], ['orderDate', 4], ['state', 4]],
      [['paymentStatus', 4], ['payOnline', 4], ['currency', 4]],
      [['name', 6], ['surname', 6]],
      [['email', 6], ['phone', 6]],
      [['address', 6], ['city', 3], ['code', 3]],
      [['country', 4], ['anotherAddressCheck', 4], ['companyDataCheck', 4]],
      [['deliveryMethod', 6], ['deliveryPrice', 6]],
      [['paymentMethod', 6], ['paymentPrice', 6]],
      [['sum', 4]],
      [['note', 12]],
    ],
  },

  'api::product.product': {
    settings: { mainField: 'title', defaultSortBy: 'sort', defaultSortOrder: 'ASC', pageSize: 50 },
    list: ['title', 'category', 'price', 'sort'],
    hidden: [],
    readonly: [],
    fields: {
      title: ['Název', 'Zobrazí se v katalogu, na stránce produktu i v košíku.'],
      slug: ['Adresa stránky', 'Část odkazu za /produkt/. U existujícího produktu neměnit - staré odkazy přestanou fungovat.'],
      image: ['Hlavní fotka', ''],
      category: ['Kategorie', ''],
      price: ['Cena', 'Použije se jen u produktu bez variant. Pokud má produkt varianty, platí ceny u nich.'],
      variants: ['Varianty', 'Každá varianta má svou cenu a dostupnost. Vyprodanou variantu nelze objednat.'],
      text: ['Popis produktu', 'Hlavní text na stránce produktu.'],
      length: ['Délka (mm)', 'Stačí vyplnit jednou - propíše se i do anglické verze. Lze psát s čárkou i tečkou.'],
      diameter: ['Průměr (mm)', 'Stačí vyplnit jednou - propíše se i do anglické verze. Lze psát s čárkou i tečkou.'],
      parametrs: ['Další parametry', 'Délka a průměr mají vlastní pole výše, sem patří ostatní údaje.'],
      linkedProducts: ['Související produkty', 'Zobrazí se pod produktem jako doporučení.'],
      sort: ['Pořadí v katalogu', 'Menší číslo je dřív.'],
      orientedImage: ['Otočená fotka', 'Používá se jen v exportu pro porovnávače zboží.'],
      SEOtitle: ['SEO: titulek stránky', 'Zobrazí se v Googlu místo názvu. Nevyplněno = použije se název produktu.'],
      SEOdescription: ['SEO: popisek do Googlu', 'Dva řádky pod odkazem ve vyhledávání, ideálně do 155 znaků.'],
    },
    edit: [
      [['title', 6], ['slug', 6]],
      [['image', 6], ['category', 3], ['sort', 3]],
      [['price', 4], ['orientedImage', 4]],
      [['variants', 12]],
      [['text', 12]],
      [['length', 4], ['diameter', 4]],
      [['parametrs', 12]],
      [['linkedProducts', 12]],
      [['SEOtitle', 6], ['SEOdescription', 6]],
    ],
  },

  'api::article.article': {
    settings: { mainField: 'title', defaultSortBy: 'sort', defaultSortOrder: 'ASC', pageSize: 50 },
    list: ['title', 'category', 'sort'],
    hidden: [],
    readonly: [],
    fields: {
      title: ['Název článku', ''],
      slug: ['Adresa stránky', 'Část odkazu za /clanek/. U existujícího článku neměnit.'],
      image: ['Úvodní fotka', ''],
      category: ['Kategorie', ''],
      chapters: ['Kapitoly', 'Článek se skládá z kapitol - každá má nadpis, text a volitelně fotku.'],
      sort: ['Pořadí ve výpisu', 'Menší číslo je dřív.'],
      SEOtitle: ['SEO: titulek stránky', 'Nevyplněno = použije se název článku.'],
      SEOdescription: ['SEO: popisek do Googlu', 'Ideálně do 155 znaků.'],
    },
    edit: [
      [['title', 6], ['slug', 6]],
      [['image', 6], ['category', 3], ['sort', 3]],
      [['chapters', 12]],
      [['SEOtitle', 6], ['SEOdescription', 6]],
    ],
  },

  'api::category.category': {
    settings: { mainField: 'title', defaultSortBy: 'sort', defaultSortOrder: 'ASC', pageSize: 50 },
    list: ['title', 'slug', 'sort'],
    hidden: [],
    readonly: [],
    fields: {
      title: ['Název kategorie', ''],
      slug: ['Adresa stránky', 'Část odkazu za /kategorie/. U existující kategorie neměnit.'],
      description: ['Popis kategorie', 'Text nad výpisem produktů.'],
      sort: ['Pořadí v menu', 'Menší číslo je dřív.'],
      products: ['Produkty', 'Přiřazuje se obvykle u produktu, ne tady.'],
    },
    edit: [
      [['title', 6], ['slug', 6]],
      [['sort', 4]],
      [['description', 12]],
      [['products', 12]],
    ],
  },
};

const merge = (stored, wanted) => {
  const known = new Set(Object.keys(stored.metadatas || {}));
  const changes = [];

  for (const [field, [label, description]] of Object.entries(wanted.fields || {})) {
    if (!known.has(field)) continue;
    const meta = stored.metadatas[field];
    if (meta.edit.label !== label) changes.push(`${field}: label "${meta.edit.label}" -> "${label}"`);
    meta.edit.label = label;
    meta.edit.description = description;
    meta.list.label = label;
  }

  for (const field of wanted.hidden || []) {
    if (!known.has(field)) continue;
    if (stored.metadatas[field].edit.visible !== false) changes.push(`${field}: hidden`);
    stored.metadatas[field].edit.visible = false;
  }

  for (const field of wanted.readonly || []) {
    if (!known.has(field)) continue;
    stored.metadatas[field].edit.editable = false;
  }

  // Only fields that exist and are still visible, so the layout can never point
  // at something the admin cannot render.
  const layout = (wanted.edit || [])
    .map((row) =>
      row
        .filter(([name]) => known.has(name) && stored.metadatas[name].edit.visible !== false)
        .map(([name, size]) => ({ name, size })),
    )
    .filter((row) => row.length);

  if (layout.length) {
    if (JSON.stringify(stored.layouts.edit) !== JSON.stringify(layout)) changes.push('edit layout reordered');
    stored.layouts.edit = layout;
  }

  const list = (wanted.list || []).filter((name) => known.has(name));
  if (list.length) stored.layouts.list = list;

  Object.assign(stored.settings, wanted.settings || {});
  return changes;
};

async function main() {
  const apply = process.argv.includes('--apply');
  const client = new Client(
    process.env.DATABASE_URL
      ? { connectionString: process.env.DATABASE_URL }
      : {
          host: process.env.DATABASE_HOST || 'localhost',
          port: Number(process.env.DATABASE_PORT || 5432),
          database: process.env.DATABASE_NAME,
          user: process.env.DATABASE_USERNAME,
          password: process.env.DATABASE_PASSWORD,
        },
  );
  await client.connect();

  for (const [uid, wanted] of Object.entries(CONFIG)) {
    const key = `plugin_content_manager_configuration_content_types::${uid}`;
    const { rows } = await client.query('SELECT value FROM strapi_core_store_settings WHERE key = $1', [key]);
    if (!rows.length) {
      console.log(`\n${uid}: no stored configuration yet - open it once in the admin, then run this again.`);
      continue;
    }

    const stored = JSON.parse(rows[0].value);
    const changes = merge(stored, wanted);
    console.log(`\n${uid}: ${changes.length ? `${changes.length} changes` : 'already as configured'}`);
    for (const change of changes.slice(0, 6)) console.log(`  ${change}`);
    if (changes.length > 6) console.log(`  … and ${changes.length - 6} more`);

    if (apply) {
      await client.query('UPDATE strapi_core_store_settings SET value = $1 WHERE key = $2', [
        JSON.stringify(stored),
        key,
      ]);
    }
  }

  console.log(
    apply
      ? '\nWritten. Restart Strapi (pm2 restart pellwood-strapi) and reload the admin.\n'
      : '\nRead-only. Run with --apply to write it.\n',
  );
  await client.end();
}

module.exports = { CONFIG, merge };

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
