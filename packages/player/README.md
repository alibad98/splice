# Player preview

The loader/stub remains unchanged. `@slips/player/preview` exports `mountPreview`; `@slips/player/viewer` exports the reusable Preact Shadow DOM viewer. Neither is statically imported by the loader. Preact is the only runtime dependency; manifest contracts are type-only imports.

```ts
import { mountPreview } from '@slips/player/preview';
const preview = mountPreview(document.querySelector('#player')!, {
  parentOrigin: 'https://dashboard.example',
  apiBase: 'https://api.example',
  locale: 'ar',
});
// Optional direct API, with the same validation as messages:
preview.update(manifest, 'en');
preview.destroy();
```

The embedding application supplies the iframe document and calls mountPreview. Register the parent message listener before loading that iframe. Configure parentOrigin from trusted application configuration, never from an incoming message. The iframe posts `{ type: 'slips.preview.ready', v: 1 }` to that exact origin. The parent checks both event.origin against the known player origin and event.source against iframe.contentWindow, then sends:

```ts
iframe.contentWindow.postMessage({
  type: 'slips.preview.update', v: 1, locale: 'ar', manifest,
}, 'https://player.example');
```

The iframe checks both the exact configured origin and window.parent. Wrong origins/sources, unsupported versions, malformed nested manifest data and unsafe URLs leave the last valid state intact. There are no wildcard target origins. Updates reuse the ShadowRoot, reset the selected slide, stop/remove obsolete video sources and clear feedback. Destroy stops video, unmounts, restores host language/direction and removes the message listener; calls after destroy do nothing.

The parent owns authenticated manifest retrieval, bearer-only media fetching, object URL creation/revocation and the iframe document's CSP. Never put tokens in messages or URLs. Media accepts HTTP(S), `/api-root/paths` resolved against the explicit API base, and host-created HTTP(S)-origin blob URLs. Protocol-relative URLs, credentials, data/script/file URLs and relative paths without a leading slash are rejected. Retain object URLs until the media is replaced or the viewer is destroyed. Preview itself never fetches manifests. Importing/uploaded sources are not rendered until inspection; scanned slides prefer their supplied poster, then inspected source. Processed slides use the appropriate web/image or video rendition.

MockStorefrontPlatform simulates cart and navigation, with localized accessible feedback. It makes no commerce, navigation, analytics or telemetry requests. Missing/deleted products have no purchasable card; out-of-stock and required-options products disable add-to-cart. Open product remains available for these states. Native video controls are enabled without autoplay. Merchant text is literal text with dir=auto; locale sets the host and viewer direction. Currency uses the currency's minor-unit exponent and Western digits.

The 9:16 stage is independent of React/Tailwind/UI-kit imports. Set the host's inline size to fit the available viewport height (see the test fixture); Story 3.12 owns dashboard phone-frame composition and loading/retry UI. CSS custom properties are inherited through the ShadowRoot:

| Property | Default | Role |
| --- | --- | --- |
| --slips-max-width | 360px | Stage maximum inline size |
| --slips-radius | 16px | Stage corners |
| --slips-ink | #15110f | Foreground/active indicator |
| --slips-surface | #ffffff | Header/product/control surface |
| --slips-media-surface | #f5f3f1 | Media/empty surface |
| --slips-muted | #615954 | Secondary/availability/safety copy |
| --slips-track | #ece8e4 | Inactive indicator/light CTA |
| --slips-control-border | #8f8681 | Button boundary |
| --slips-focus | #ff4a3d | Focus outline |
| --slips-accent | #ffc23d | Text selection |
| --slips-cta | #15110f | Default action background |
| --slips-cta-text | #ffc23d | Default action foreground |

Respect contrast when overriding properties. System fonts are binding. The product/action dock uses 4px spacing increments and 12–16px corners; the CTA remains a pill. No decorative motion is added, including under reduced motion.

`e2e/fixtures/preview.html` is a real iframe harness using the built entry and clearly labelled synthetic media/product data. Raster provenance is in `e2e/fixtures/MEDIA.md`. Browser captures are written under the repository `.impeccable/review/` for desktop/mobile, Arabic/English and complete/incomplete states. Existing CLS and gzip-budget checks continue to cover the loader.
# Dashboard embedding

The dashboard serves the built preview entry and its shared chunks at `/player-preview/`.
Its `prepare-preview.mjs` copies the workspace player build and the trusted iframe
bootstrap before development or production builds. Turbo tracks these generated
assets, and the dashboard image copies `public` beside the standalone server.
Build the player before running the dashboard directly; root development and Turbo
builds do this through the workspace dependency.

The parent registers its message listener before setting the iframe URL. Only the
exact same-origin iframe window and v1 `slips.preview.ready` message can start
updates. The child takes its origin from its own same-origin location and API base
from generated application configuration, with no message/query configuration or
session credentials. Its CSP prohibits connection requests, forms and objects;
the unchanged player uses `MockStorefrontPlatform` for actions.

`LivePreviewPanel` receives the editor's last saved server snapshot. The parent
fetches and validates StoreManifest v1, resolves media against the merchant API,
and fetches selected protected byte endpoints through SessionClient in bearer
mode. Product/CDN URLs never receive those credentials. Parent-owned blob URLs
remain alive until replacement or teardown; superseded results release their own
resources. Manifest and locale updates use the existing ready/update protocol
without navigating the iframe. Retry independently repeats retrieval/startup.

The Next.js proxy must allow `frame-ancestors 'self' <configured Salla origin>`
on `/player-preview/index.html`: the iframe has a same-origin dashboard parent,
and embedded mode also has Salla as an ancestor. Other route framing policies
remain unchanged. Dashboard browser tests start both the editor harness and a
production Next.js server to exercise these headers and real player startup.
Run `pnpm turbo run build --filter=@slips/dashboard...` before the dashboard
`test:e2e` command, as CI does.
