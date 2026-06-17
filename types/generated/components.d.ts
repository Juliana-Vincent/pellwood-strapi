import type { Schema, Struct } from '@strapi/strapi';

export interface SharedBanner extends Struct.ComponentSchema {
  collectionName: 'components_shared_banners';
  info: {
    displayName: 'Banner';
    icon: 'picture';
  };
  attributes: {
    image: Schema.Attribute.Media<'images'>;
    title: Schema.Attribute.String;
    url: Schema.Attribute.String;
  };
}

export interface SharedButton extends Struct.ComponentSchema {
  collectionName: 'components_shared_buttons';
  info: {
    displayName: 'Button';
    icon: 'link';
  };
  attributes: {
    title: Schema.Attribute.String;
    url: Schema.Attribute.String;
  };
}

export interface SharedChapter extends Struct.ComponentSchema {
  collectionName: 'components_shared_chapters';
  info: {
    displayName: 'Chapter';
    icon: 'book';
  };
  attributes: {
    image: Schema.Attribute.Media<'images'>;
    text: Schema.Attribute.Blocks;
    title: Schema.Attribute.String;
  };
}

export interface SharedFooterItem extends Struct.ComponentSchema {
  collectionName: 'components_shared_footer_items';
  info: {
    displayName: 'FooterItem';
    icon: 'bulletList';
  };
  attributes: {
    content: Schema.Attribute.Blocks;
    title: Schema.Attribute.String;
  };
}

export interface SharedMenuItem extends Struct.ComponentSchema {
  collectionName: 'components_shared_menu_items';
  info: {
    displayName: 'MenuItem';
    icon: 'bulletList';
  };
  attributes: {
    menuUrl: Schema.Attribute.String;
    title: Schema.Attribute.String;
  };
}

export interface SharedParameter extends Struct.ComponentSchema {
  collectionName: 'components_shared_parameters';
  info: {
    displayName: 'Parameter';
    icon: 'cog';
  };
  attributes: {
    title: Schema.Attribute.String;
    value: Schema.Attribute.String;
  };
}

export interface SharedVariant extends Struct.ComponentSchema {
  collectionName: 'components_shared_variants';
  info: {
    displayName: 'Variant';
    icon: 'bulletList';
  };
  attributes: {
    inStock: Schema.Attribute.Boolean;
    price: Schema.Attribute.String;
    title: Schema.Attribute.String;
    weight: Schema.Attribute.String;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'shared.banner': SharedBanner;
      'shared.button': SharedButton;
      'shared.chapter': SharedChapter;
      'shared.footer-item': SharedFooterItem;
      'shared.menu-item': SharedMenuItem;
      'shared.parameter': SharedParameter;
      'shared.variant': SharedVariant;
    }
  }
}
