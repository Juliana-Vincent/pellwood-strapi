import type { StrapiApp } from '@strapi/strapi/admin';
import { ShoppingCart } from '@strapi/icons';

export default {
  config: {
    // Czech for the shop owner. Each person still picks their own language under
    // Settings -> Profile.
    locales: ['cs'],
  },
  register(app: StrapiApp) {
    // A read-at-a-glance list of orders: what came in, whether it is paid and
    // whether it has shipped. The native Content Manager stays available.
    app.addMenuLink({
      to: '/orders',
      icon: ShoppingCart,
      intlLabel: { id: 'orders.menu', defaultMessage: 'Objednávky' },
      position: 1,
      permissions: [],
      Component: () => import('./extensions/orders/OrdersPage'),
    });
  },
};
