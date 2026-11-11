import type { StoreManifest } from '@slips/contracts';
export const id = '11111111-1111-4111-8111-111111111111';
export const manifest = (): StoreManifest => ({
  v: 1,
  store_id: id,
  placements: [{ type: 'home', layout: 'ring', item_ids: [id] }],
  items: [
    {
      id,
      title: 'Everyday essentials',
      format: 'story',
      cta_label: 'Add to cart',
      cta_action: 'add_to_cart',
      cta_url: null,
      cta_style: null,
      product: {
        id,
        name: 'Amber studio object',
        image_url: '/demo.png',
        price_minor: 15900,
        sale_price_minor: 12900,
        currency: 'SAR',
        availability: 'available',
        has_required_options: false,
        deleted: false,
      },
      slides: [
        {
          id,
          media_asset_id: id,
          kind: 'image',
          alt_text: 'A local geometric studio image fixture',
          status: 'processed',
          source_url: null,
          poster_url: null,
          renditions: [
            {
              profile: 'web',
              url: '/demo.png',
              content_type: 'image/png',
              width: 720,
              height: 960,
            },
          ],
        },
      ],
    },
  ],
});
