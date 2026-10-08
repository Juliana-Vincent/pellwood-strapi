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

/** Fulfilment is set by hand in the admin. */
export const STATES: Array<{ value: string; label: string; variant: Look['variant'] }> = [
  { value: 'new', label: 'Nová', variant: 'warning' },
  { value: 'packed', label: 'Připraveno', variant: 'alternative' },
  { value: 'shipped', label: 'Odesláno', variant: 'primary' },
  { value: 'delivered', label: 'Doručeno', variant: 'success' },
  { value: 'cancelled', label: 'Zrušeno', variant: 'danger' },
];

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
