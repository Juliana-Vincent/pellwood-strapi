export type Order = {
  documentId: string;
  idOrder: number;
  name?: string;
  surname?: string;
  email?: string;
  city?: string;
  country?: string;
  sum?: number | string;
  currency?: string;
  paymentStatus?: string | null;
  state?: string | null;
  payOnline?: boolean;
  paymentMethod?: string;
  deliveryMethod?: string;
  basket?: unknown;
  orderDate?: string;
  createdAt?: string;
};

type Look = { label: string; variant: 'success' | 'warning' | 'danger' | 'primary' | 'secondary' | 'alternative' | 'neutral' };

/**
 * Payment comes from Comgate (`paymentStatus`); cash on delivery never has one.
 * The old field was called `status`, which Strapi 5 reserves for draft/published -
 * the admin read it as "published" and wrote that back over the real value.
 */
export const PAYMENT: Record<string, Look> = {
  paid: { label: 'Zaplaceno', variant: 'success' },
  pending: { label: 'Čeká na platbu', variant: 'warning' },
  authorized: { label: 'Předautorizováno', variant: 'alternative' },
  cod: { label: 'Dobírka', variant: 'secondary' },
  cancelled: { label: 'Nezaplaceno', variant: 'danger' },
  unknown: { label: '—', variant: 'neutral' },
};

export const paymentKey = (order: Order): keyof typeof PAYMENT => {
  if (!order.payOnline) return 'cod';
  switch ((order.paymentStatus || '').toUpperCase()) {
    case 'PAID':
      return 'paid';
    case 'PENDING':
      return 'pending';
    case 'AUTHORIZED':
      return 'authorized';
    case 'CANCELLED':
      return 'cancelled';
    default:
      return 'unknown';
  }
};

/**
 * Fulfilment is set by hand in the admin. Switching an order to "Vyřizuje se"
 * e-mails the customer (src/index.ts); the shipping notice comes from the carrier.
 */
export const STATES: Array<{ value: string; label: string; variant: Look['variant'] }> = [
  { value: 'new', label: 'Nová', variant: 'primary' },
  { value: 'processing', label: 'Vyřizuje se', variant: 'warning' },
  { value: 'packed', label: 'Připraveno', variant: 'alternative' },
  { value: 'shipped', label: 'Odesláno', variant: 'neutral' },
  { value: 'delivered', label: 'Doručeno', variant: 'success' },
  { value: 'cancelled', label: 'Zrušeno', variant: 'danger' },
];

/**
 * The tint behind a whole row in the order list. The design system's light "100"
 * shades all turn the same grey in the dark theme, so the row uses the "500"
 * shade (alike in both themes) at low opacity, plus a solid stripe on the left.
 */
const TONE: Record<Look['variant'], string> = {
  primary: '#4945ff',
  warning: '#f29d41',
  alternative: '#ac73e6',
  neutral: '#8e8ea9',
  success: '#5cb176',
  danger: '#ee5e52',
  secondary: '#66b7f1',
};

export const rowTint = (state?: string | null) => {
  const found = STATES.find((s) => s.value === state);
  if (!found) return { row: undefined, stripe: undefined };
  const color = TONE[found.variant];
  return {
    row: { background: `${color}1f` },
    stripe: { boxShadow: `inset 4px 0 0 ${color}` },
  };
};

export const stateLook = (state?: string | null): Look => {
  const found = STATES.find((s) => s.value === state);
  // Orders imported from the old shop can carry a value we no longer use.
  return found ? { label: found.label, variant: found.variant } : { label: state || '—', variant: 'neutral' };
};

export const itemCount = (basket: unknown): number | null => {
  if (!Array.isArray(basket)) return null;
  return basket.reduce((sum, item: any) => sum + (Number(item?.countVariant) || 0), 0);
};

export const formatMoney = (value: unknown, currency?: string): string => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  const isEur = currency === '€' || currency === 'EUR';
  return new Intl.NumberFormat(isEur ? 'en-IE' : 'cs-CZ', {
    style: 'currency',
    currency: isEur ? 'EUR' : 'CZK',
    minimumFractionDigits: isEur ? 2 : 0,
    maximumFractionDigits: isEur ? 2 : 0,
  }).format(amount);
};

const time = new Intl.DateTimeFormat('cs-CZ', { hour: '2-digit', minute: '2-digit' });
const full = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export const formatDate = (value?: string): string => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const today = new Date();
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(date, today)) return `Dnes ${time.format(date)}`;
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(date, yesterday)) return `Včera ${time.format(date)}`;
  return full.format(date);
};
