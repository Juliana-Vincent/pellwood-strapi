import * as React from 'react';
import { Layouts, Page, useFetchClient, useNotification } from '@strapi/strapi/admin';
import {
  Badge,
  Box,
  Button,
  EmptyStateLayout,
  Flex,
  Loader,
  Searchbar,
  SingleSelect,
  SingleSelectOption,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
  Tabs,
} from '@strapi/design-system';
import { OrderDetail } from './OrderDetail';
import {
  formatDate,
  formatMoney,
  itemCount,
  paymentKey,
  stateLook,
  Order,
  PAYMENT,
  STATES,
} from './orderStatus';

const UID = 'api::order.order';
const PAGE_SIZE = 50;

/** Flat keys, so the query string is built without guessing a serializer. */
const TAB_FILTERS: Record<string, Record<string, string>> = {
  all: {},
  unpaid: { 'filters[payOnline][$eq]': 'true', 'filters[paymentStatus][$eq]': 'PENDING' },
  toship: { 'filters[state][$in][0]': 'new', 'filters[state][$in][1]': 'packed' },
  sent: { 'filters[state][$in][0]': 'shipped', 'filters[state][$in][1]': 'delivered' },
  cancelled: { 'filters[$or][0][state][$eq]': 'cancelled', 'filters[$or][1][paymentStatus][$eq]': 'CANCELLED' },
};

const TABS = [
  { id: 'all', label: 'Vše' },
  { id: 'unpaid', label: 'Nezaplacené' },
  { id: 'toship', label: 'K odeslání' },
  { id: 'sent', label: 'Odeslané' },
  { id: 'cancelled', label: 'Zrušené' },
];

/** 1 objednávka, 2-4 objednávky, 5+ objednávek. */
const orderCount = (count: number) => {
  if (count === 1) return '1 objednávka';
  if (count >= 2 && count <= 4) return `${count} objednávky`;
  return `${count} objednávek`;
};

/**
 * Czech names are searched without their accents: the order carries an
 * accent-free copy of its name, e-mail and city (searchText), so "novak" finds
 * Nováková. % and _ are escaped because Strapi compiles $containsi to a LIKE.
 */
const searchFilter = (query: string): Record<string, string> => {
  const normalized = query
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\\%_]/g, (match) => `\\${match}`)
    .trim();
  return normalized ? { 'filters[searchText][$containsi]': normalized } : {};
};

const toQuery = (params: Record<string, string | number>) =>
  Object.entries(params)
    .filter(([, value]) => value !== '' && value !== undefined)
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join('&');

/** Which order the hash is pointing at, so the detail view survives a reload and
 *  the browser's back button returns to the list. */
const hashId = () => {
  const match = /#order=([\w-]+)/.exec(window.location.hash);
  return match ? match[1] : '';
};

const OrdersPage = () => {
  const { get, put } = useFetchClient();
  const { toggleNotification } = useNotification();

  const [tab, setTab] = React.useState('all');
  const [search, setSearch] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [rows, setRows] = React.useState<Order[]>([]);
  const [total, setTotal] = React.useState(0);
  const [pageCount, setPageCount] = React.useState(1);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [counts, setCounts] = React.useState({ unpaid: 0, toship: 0, today: 0 });
  const [openId, setOpenId] = React.useState(hashId);

  React.useEffect(() => {
    const onPop = () => setOpenId(hashId());
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onPop);
    };
  }, []);

  const openOrder = (documentId: string) => {
    window.history.pushState(null, '', `#order=${documentId}`);
    setOpenId(documentId);
  };

  const closeOrder = () => {
    window.history.pushState(null, '', window.location.pathname);
    setOpenId('');
    load();
  };

  // Typing filters the list a moment after the last keystroke, not on every letter.
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = {
        page,
        pageSize: PAGE_SIZE,
        'sort[0]': 'orderDate:DESC',
        'sort[1]': 'createdAt:DESC',
        ...TAB_FILTERS[tab],
        ...searchFilter(query),
      };
      const { data } = await get(`/content-manager/collection-types/${UID}?${toQuery(params)}`);
      setRows(data?.results || []);
      setTotal(data?.pagination?.total || 0);
      setPageCount(data?.pagination?.pageCount || 1);
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || 'Objednávky se nepodařilo načíst.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [get, page, query, tab]);

  React.useEffect(() => {
    load();
  }, [load]);

  // The three numbers above the table: one count request each, page size 1.
  React.useEffect(() => {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);

    const countOf = async (params: Record<string, string | number>) => {
      const { data } = await get(
        `/content-manager/collection-types/${UID}?${toQuery({ page: 1, pageSize: 1, ...params })}`,
      );
      return data?.pagination?.total || 0;
    };

    Promise.all([
      countOf(TAB_FILTERS.unpaid),
      countOf(TAB_FILTERS.toship),
      countOf({ 'filters[createdAt][$gte]': midnight.toISOString() }),
    ])
      .then(([unpaid, toship, today]) => setCounts({ unpaid, toship, today }))
      .catch(() => undefined);
  }, [get, rows]);

  const changeState = async (order: Order, state: string) => {
    const previous = order.state;
    setRows((current) =>
      current.map((row) => (row.documentId === order.documentId ? { ...row, state } : row)),
    );
    try {
      await put(`/content-manager/collection-types/${UID}/${order.documentId}`, { state });
      toggleNotification({ type: 'success', message: `Objednávka #${order.idOrder}: ${stateLook(state).label}` });
    } catch (err: any) {
      setRows((current) =>
        current.map((row) => (row.documentId === order.documentId ? { ...row, state: previous } : row)),
      );
      toggleNotification({
        type: 'danger',
        message: err?.response?.data?.error?.message || 'Stav se nepodařilo uložit.',
      });
    }
  };

  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  if (openId) {
    return (
      <Page.Main>
        <Page.Title>Objednávka</Page.Title>
        <Layouts.Content>
          <OrderDetail documentId={openId} onBack={closeOrder} />
        </Layouts.Content>
      </Page.Main>
    );
  }

  return (
    <Page.Main>
      <Page.Title>Objednávky</Page.Title>
      <Layouts.Header
        title="Objednávky"
        subtitle={orderCount(total)}
        primaryAction={
          <Button variant="tertiary" onClick={load}>
            Obnovit
          </Button>
        }
      />
      <Layouts.Content>
        <Flex gap={4} marginBottom={6} alignItems="stretch">
          <SummaryCard
            label="Čeká na platbu"
            value={counts.unpaid}
            tone="warning600"
            onClick={() => setTab('unpaid')}
          />
          <SummaryCard
            label="K odeslání"
            value={counts.toship}
            tone="danger600"
            onClick={() => setTab('toship')}
          />
          <SummaryCard label="Dnes přijato" value={counts.today} />
        </Flex>

        <Tabs.Root
          value={tab}
          onValueChange={(value: string) => {
            setTab(value);
            setPage(1);
          }}
        >
          <Flex justifyContent="space-between" alignItems="center" gap={4} marginBottom={4} wrap="wrap">
            <Tabs.List aria-label="Filtr objednávek">
              {TABS.map((item) => (
                <Tabs.Trigger key={item.id} value={item.id} style={{ whiteSpace: 'nowrap' }}>
                  {item.label}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
            <Box width="320px">
              <Searchbar
                name="search"
                value={search}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => setSearch(event.target.value)}
                onClear={() => setSearch('')}
                clearLabel="Vymazat"
                placeholder="Číslo, jméno nebo e-mail"
              >
                Hledat objednávku
              </Searchbar>
            </Box>
          </Flex>

          <Tabs.Content value={tab}>
            {loading ? (
              <Flex justifyContent="center" padding={8}>
                <Loader>Načítám objednávky…</Loader>
              </Flex>
            ) : error ? (
              <EmptyStateLayout content={error} />
            ) : rows.length === 0 ? (
              <EmptyStateLayout content="Žádné objednávky neodpovídají tomuto filtru." />
            ) : (
              <Table colCount={8} rowCount={rows.length + 1}>
                <Thead>
                  <Tr>
                    <Th>
                      <Typography variant="sigma">Objednávka</Typography>
                    </Th>
                    <Th>
                      <Typography variant="sigma">Datum</Typography>
                    </Th>
                    <Th>
                      <Typography variant="sigma">Zákazník</Typography>
                    </Th>
                    <Th>
                      <Typography variant="sigma">Celkem</Typography>
                    </Th>
                    <Th>
                      <Typography variant="sigma">Platba</Typography>
                    </Th>
                    <Th>
                      <Typography variant="sigma">Stav</Typography>
                    </Th>
                    <Th>
                      <Typography variant="sigma">Položky</Typography>
                    </Th>
                    <Th>
                      <Typography variant="sigma">Doprava</Typography>
                    </Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {rows.map((order) => {
                    const payment = PAYMENT[paymentKey(order)];
                    const items = itemCount(order.basket);
                    const isNew = order.state === 'new';
                    return (
                      <Tr key={order.documentId}>
                        <Td>
                          <Typography
                            tag="a"
                            href={`#order=${order.documentId}`}
                            textColor="primary600"
                            fontWeight={isNew ? 'bold' : 'regular'}
                            onClick={(event: React.MouseEvent) => {
                              event.preventDefault();
                              openOrder(order.documentId);
                            }}
                          >
                            #{order.idOrder}
                          </Typography>
                        </Td>
                        <Td>
                          <Typography textColor="neutral600">
                            {formatDate(order.orderDate || order.createdAt)}
                          </Typography>
                        </Td>
                        <Td>
                          <Flex direction="column" alignItems="flex-start">
                            <Typography>
                              {[order.name, order.surname].filter(Boolean).join(' ') || '—'}
                            </Typography>
                            <Typography variant="pi" textColor="neutral600">
                              {order.email || ''}
                            </Typography>
                          </Flex>
                        </Td>
                        <Td>
                          <Typography fontWeight="semiBold">
                            {formatMoney(order.sum, order.currency)}
                          </Typography>
                        </Td>
                        <Td>
                          <Badge variant={payment.variant}>{payment.label}</Badge>
                        </Td>
                        <Td>
                          <SingleSelect
                            size="S"
                            aria-label={`Stav objednávky ${order.idOrder}`}
                            value={order.state || ''}
                            onChange={(value: string | number) => changeState(order, String(value))}
                          >
                            {STATES.map((item) => (
                              <SingleSelectOption key={item.value} value={item.value}>
                                {item.label}
                              </SingleSelectOption>
                            ))}
                          </SingleSelect>
                        </Td>
                        <Td>
                          <Typography textColor="neutral600">{items === null ? '—' : `${items} ks`}</Typography>
                        </Td>
                        <Td>
                          <Typography textColor="neutral600">{order.deliveryMethod || '—'}</Typography>
                        </Td>
                      </Tr>
                    );
                  })}
                </Tbody>
              </Table>
            )}

            <Flex justifyContent="space-between" alignItems="center" paddingTop={4}>
              <Typography variant="pi" textColor="neutral600">
                {from}–{to} z {total}
              </Typography>
              <Flex gap={2}>
                <Button variant="tertiary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Předchozí
                </Button>
                <Button variant="tertiary" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>
                  Další
                </Button>
              </Flex>
            </Flex>
          </Tabs.Content>
        </Tabs.Root>
      </Layouts.Content>
    </Page.Main>
  );
};

const SummaryCard = ({
  label,
  value,
  tone = 'neutral800',
  onClick,
}: {
  label: string;
  value: number;
  tone?: 'warning600' | 'danger600' | 'neutral800';
  onClick?: () => void;
}) => (
  <Box
    background="neutral0"
    hasRadius
    shadow="tableShadow"
    padding={4}
    width="200px"
    tag={onClick ? 'button' : 'div'}
    onClick={onClick}
    // A <button> takes the browser's own black text colour, which disappears on
    // the dark theme - hence colour set explicitly on both the box and the number.
    style={onClick ? { cursor: 'pointer', textAlign: 'left', color: 'inherit', border: 'none' } : undefined}
  >
    <Typography variant="pi" textColor="neutral600">
      {label}
    </Typography>
    <Box paddingTop={1}>
      <Typography variant="alpha" textColor={tone}>
        {value}
      </Typography>
    </Box>
  </Box>
);

export { OrdersPage };
export default OrdersPage;
