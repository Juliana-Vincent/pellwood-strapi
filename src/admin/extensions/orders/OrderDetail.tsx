import * as React from 'react';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';
import {
  Badge,
  Box,
  Button,
  Divider,
  Flex,
  Loader,
  SingleSelect,
  SingleSelectOption,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { formatDate, formatMoney, paymentKey, stateLook, Order, PAYMENT, STATES } from './orderStatus';

const UID = 'api::order.order';

type BasketLine = {
  id?: string;
  imgUrl?: string;
  nameProduct?: string;
  variantName?: string;
  countVariant?: number | string;
  variantPrice?: number | string;
};

type FullOrder = Order & {
  phone?: string;
  address?: string;
  code?: string;
  note?: string;
  paymentPrice?: string;
  deliveryPrice?: string;
  anotherAddressCheck?: boolean;
  companyDataCheck?: boolean;
  anotherAdress?: Record<string, string> | null;
  companyData?: Record<string, string> | null;
};

const COUNTRIES: Record<string, string> = {
  cz: 'Česká republika',
  sk: 'Slovensko',
  de: 'Německo',
  at: 'Rakousko',
};

/** deliveryPrice/paymentPrice are stored as typed-in strings ("150 Kč", "ZDARMA"). */
const priceLabel = (value: unknown, currency?: string) => {
  if (value === null || value === undefined || value === '') return '—';
  const asNumber = Number(value);
  return Number.isFinite(asNumber) && String(value).trim() !== ''
    ? formatMoney(asNumber, currency)
    : String(value);
};

const Line = ({ label, value }: { label: string; value?: React.ReactNode }) => {
  if (value === undefined || value === null || value === '') return null;
  return (
    <Flex gap={2} alignItems="baseline" paddingBottom={1}>
      <Box minWidth="110px">
        <Typography variant="pi" textColor="neutral600">
          {label}
        </Typography>
      </Box>
      <Typography>{value}</Typography>
    </Flex>
  );
};

/** Right-aligned label/value row for the totals block. */
const SummaryRow = ({
  label,
  hint,
  value,
  strong,
}: {
  label: string;
  hint?: string;
  value: React.ReactNode;
  strong?: boolean;
}) => (
  <Flex justifyContent="space-between" alignItems="baseline" gap={6} paddingBottom={1} width="320px">
    <Flex direction="column" alignItems="flex-start">
      <Typography variant={strong ? 'delta' : 'omega'} textColor={strong ? 'neutral800' : 'neutral700'}>
        {label}
      </Typography>
      {hint ? (
        <Typography variant="pi" textColor="neutral500">
          {hint}
        </Typography>
      ) : null}
    </Flex>
    <Typography variant={strong ? 'delta' : 'omega'} fontWeight={strong ? 'bold' : 'semiBold'}>
      {value}
    </Typography>
  </Flex>
);

const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <Box background="neutral0" hasRadius shadow="tableShadow" padding={5} marginBottom={4}>
    <Box paddingBottom={3}>
      <Typography variant="delta">{title}</Typography>
    </Box>
    {children}
  </Box>
);

const OrderDetail = ({ documentId, onBack }: { documentId: string; onBack: () => void }) => {
  const { get, put } = useFetchClient();
  const { toggleNotification } = useNotification();
  const [order, setOrder] = React.useState<FullOrder | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    get(`/content-manager/collection-types/${UID}/${documentId}`)
      .then(({ data }: any) => {
        if (!cancelled) setOrder(data?.data || data);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.response?.data?.error?.message || 'Objednávku se nepodařilo načíst.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [documentId, get]);

  const changeState = async (state: string) => {
    const previous = order?.state;
    setOrder((current) => (current ? { ...current, state } : current));
    try {
      await put(`/content-manager/collection-types/${UID}/${documentId}`, { state });
      toggleNotification({ type: 'success', message: `Stav změněn na: ${stateLook(state).label}` });
    } catch (err: any) {
      setOrder((current) => (current ? { ...current, state: previous } : current));
      toggleNotification({
        type: 'danger',
        message: err?.response?.data?.error?.message || 'Stav se nepodařilo uložit.',
      });
    }
  };

  if (loading) {
    return (
      <Flex justifyContent="center" padding={10}>
        <Loader>Načítám objednávku…</Loader>
      </Flex>
    );
  }
  if (error || !order) {
    return (
      <Box padding={6}>
        <Typography textColor="danger600">{error || 'Objednávka nenalezena.'}</Typography>
        <Box paddingTop={4}>
          <Button variant="tertiary" onClick={onBack}>
            Zpět na objednávky
          </Button>
        </Box>
      </Box>
    );
  }

  const basket: BasketLine[] = Array.isArray(order.basket) ? (order.basket as BasketLine[]) : [];
  const subtotal = basket.reduce(
    (sum, line) => sum + (Number(line.variantPrice) || 0) * (Number(line.countVariant) || 0),
    0,
  );
  const payment = PAYMENT[paymentKey(order)];
  const delivery = order.anotherAddressCheck && order.anotherAdress ? order.anotherAdress : null;

  return (
    <Box id="order-print">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #order-print, #order-print * { visibility: visible; }
          #order-print { position: absolute; left: 0; top: 0; width: 100%; padding: 0; }
          #order-print .no-print { display: none !important; }
        }
      `}</style>

      <Flex justifyContent="space-between" alignItems="flex-start" paddingBottom={5} wrap="wrap" gap={4}>
        <Box>
          <Typography variant="alpha">Objednávka #{order.idOrder}</Typography>
          <Box paddingTop={1}>
            <Typography textColor="neutral600">{formatDate(order.orderDate || order.createdAt)}</Typography>
          </Box>
          <Flex gap={2} paddingTop={3} alignItems="center">
            <Badge variant={payment.variant}>{payment.label}</Badge>
            <Badge variant={stateLook(order.state).variant}>{stateLook(order.state).label}</Badge>
          </Flex>
        </Box>
        <Flex gap={2} className="no-print" wrap="wrap">
          <Box minWidth="170px">
            <SingleSelect
              size="S"
              aria-label="Stav objednávky"
              value={order.state || ''}
              onChange={(value: string | number) => changeState(String(value))}
            >
              {STATES.map((item) => (
                <SingleSelectOption key={item.value} value={item.value}>
                  {item.label}
                </SingleSelectOption>
              ))}
            </SingleSelect>
          </Box>
          <Button variant="tertiary" onClick={() => window.print()}>
            Tisk
          </Button>
          <Button variant="tertiary" onClick={onBack}>
            Zpět na objednávky
          </Button>
        </Flex>
      </Flex>

      <Flex alignItems="flex-start" gap={4} wrap="wrap">
        <Box flex="1 1 520px" minWidth="420px">
          <Card title="Položky objednávky">
            <Table colCount={5} rowCount={basket.length + 1}>
              <Thead>
                <Tr>
                  <Th>
                    <Typography variant="sigma">Produkt</Typography>
                  </Th>
                  <Th>
                    <Typography variant="sigma">Varianta</Typography>
                  </Th>
                  <Th>
                    <Typography variant="sigma">Počet</Typography>
                  </Th>
                  <Th>
                    <Typography variant="sigma">Cena za kus</Typography>
                  </Th>
                  <Th>
                    <Typography variant="sigma">Celkem</Typography>
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {basket.map((line, index) => (
                  <Tr key={`${line.id || index}-${line.variantName || ''}`}>
                    <Td>
                      <Flex gap={3} alignItems="center">
                        {line.imgUrl ? (
                          <img
                            src={line.imgUrl}
                            alt=""
                            width={40}
                            height={40}
                            style={{ objectFit: 'contain', borderRadius: 4, background: '#fff' }}
                          />
                        ) : null}
                        <Typography fontWeight="semiBold">{line.nameProduct || '—'}</Typography>
                      </Flex>
                    </Td>
                    <Td>
                      <Typography textColor="neutral600">
                        {line.variantName && line.variantName !== line.nameProduct ? line.variantName : '—'}
                      </Typography>
                    </Td>
                    <Td>
                      <Typography>{Number(line.countVariant) || 0} ks</Typography>
                    </Td>
                    <Td>
                      <Typography textColor="neutral600">
                        {formatMoney(line.variantPrice, order.currency)}
                      </Typography>
                    </Td>
                    <Td>
                      <Typography fontWeight="semiBold">
                        {formatMoney(
                          (Number(line.variantPrice) || 0) * (Number(line.countVariant) || 0),
                          order.currency,
                        )}
                      </Typography>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>

            {basket.length === 0 && (
              <Box paddingTop={3}>
                <Typography textColor="neutral600">Objednávka neobsahuje žádné položky.</Typography>
              </Box>
            )}

            <Box paddingTop={4} paddingBottom={3}>
              <Divider />
            </Box>
            <Flex direction="column" alignItems="flex-end">
              <SummaryRow label="Mezisoučet" value={formatMoney(subtotal, order.currency)} />
              <SummaryRow
                label="Doprava"
                hint={order.deliveryMethod}
                value={priceLabel(order.deliveryPrice, order.currency)}
              />
              <SummaryRow
                label="Platba"
                hint={order.paymentMethod}
                value={priceLabel(order.paymentPrice, order.currency)}
              />
              <Box paddingTop={2} paddingBottom={1} width="320px">
                <Divider />
              </Box>
              <SummaryRow label="Celkem" value={formatMoney(order.sum, order.currency)} strong />
            </Flex>
          </Card>

          {order.note ? (
            <Card title="Poznámka zákazníka">
              <Typography>{order.note}</Typography>
            </Card>
          ) : null}
        </Box>

        <Box flex="0 1 360px" minWidth="300px">
          <Card title="Zákazník">
            <Line label="Jméno" value={[order.name, order.surname].filter(Boolean).join(' ') || '—'} />
            <Line label="E-mail" value={order.email} />
            <Line label="Telefon" value={order.phone} />
          </Card>

          <Card title={delivery ? 'Fakturační adresa' : 'Doručovací adresa'}>
            <Line label="Ulice" value={order.address} />
            <Line label="Město" value={order.city} />
            <Line label="PSČ" value={order.code} />
            <Line label="Země" value={COUNTRIES[String(order.country)] || order.country} />
          </Card>

          {delivery ? (
            <Card title="Doručovací adresa">
              <Line
                label="Jméno"
                value={[delivery.name, delivery.surname].filter(Boolean).join(' ') || undefined}
              />
              <Line label="Ulice" value={delivery.address} />
              <Line label="Město" value={delivery.city} />
              <Line label="PSČ" value={delivery.code} />
              <Line label="Země" value={COUNTRIES[String(delivery.country)] || delivery.country} />
              <Line label="Telefon" value={delivery.phone} />
            </Card>
          ) : null}

          {order.companyDataCheck && order.companyData ? (
            <Card title="Firemní údaje">
              <Line label="Firma" value={order.companyData.companyName} />
              <Line label="IČO" value={order.companyData.ico} />
              <Line label="DIČ" value={order.companyData.dic} />
            </Card>
          ) : null}
        </Box>
      </Flex>
    </Box>
  );
};

export { OrderDetail };
export default OrderDetail;
