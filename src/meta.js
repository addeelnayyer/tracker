// Builds the server-rendered link-preview metadata (Open Graph + Twitter Card)
// for each page. Pages fetch their data client-side, so social crawlers — which
// don't run JavaScript — would otherwise see an empty shell. These tags give
// WhatsApp, Facebook, X, LinkedIn, Telegram, etc. a real title, description and
// thumbnail to render in link previews.

const SITE_NAME = 'Nasr';
const DEFAULT_IMAGE = '/images/og-default.png';
const DEFAULT_IMAGE_TYPE = 'image/png';

// Social platforms ignore relative paths, so og:image/og:url must be absolute.
// Honour the proxy headers (Cloud Functions / hosting terminate TLS upstream).
const baseUrl = (req) => `${req.protocol}://${req.get('host')}`;

const absolute = (req, pathOrUrl) =>
  /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : `${baseUrl(req)}${pathOrUrl}`;

// Keep descriptions within the ~200 chars platforms display before truncating.
const truncate = (text, max = 200) => {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
};

const formatMoney = (amount, currency) => {
  const value = Number(amount) || 0;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: (currency || 'USD').toUpperCase(),
      maximumFractionDigits: 0
    }).format(value);
  } catch {
    // Intl throws on an unknown currency code; fall back to a plain number.
    return `${value.toLocaleString('en-US')} ${currency || ''}`.trim();
  }
};

// SVGs are rejected by most preview crawlers (WhatsApp/Facebook), so only treat
// raster images as usable thumbnails.
const isPreviewableImage = (doc) =>
  typeof doc.mime_type === 'string' &&
  doc.mime_type.startsWith('image/') &&
  doc.mime_type !== 'image/svg+xml';

const displayOrder = (doc) =>
  typeof doc.display_order === 'number' ? doc.display_order : Date.parse(doc.uploaded_at) || 0;

// First gallery image, in the order donors see it, used as the campaign thumbnail.
const firstImageUrl = (documents = []) => {
  const image = documents
    .filter(isPreviewableImage)
    .sort((a, b) => displayOrder(a) - displayOrder(b))[0];
  return image ? image.url : null;
};

const defaults = (req) => ({
  type: 'website',
  siteName: SITE_NAME,
  twitterCard: 'summary_large_image',
  image: absolute(req, DEFAULT_IMAGE),
  imageType: DEFAULT_IMAGE_TYPE,
  imageWidth: 1200,
  imageHeight: 630,
  imageAlt: `${SITE_NAME} — Campaign Ledger`,
  noindex: false
});

// Home page / generic shell.
const siteMeta = (req, overrides = {}) => ({
  ...defaults(req),
  title: 'Nasr — Honest, public fundraising ledgers',
  description: truncate(
    'Set a goal, share your link, and keep an honest, public record of every donation. Nasr gives your campaign a transparent ledger anyone can follow.'
  ),
  url: absolute(req, req.originalUrl || '/'),
  ...overrides
});

// Campaign page, built from live campaign + document data.
const campaignMeta = (req, campaign, documents = []) => {
  const raised = formatMoney(campaign.accumulated_amount, campaign.currency);
  const goal = formatMoney(campaign.target_amount, campaign.currency);
  const pct = campaign.target_amount > 0
    ? Math.min(Math.round((campaign.accumulated_amount / campaign.target_amount) * 100), 100)
    : 0;
  const image = firstImageUrl(documents);

  return {
    ...defaults(req),
    title: `${campaign.name} — ${SITE_NAME}`,
    description: truncate(
      `${raised} raised of ${goal} goal (${pct}% funded). Follow the public donation ledger for ${campaign.name} and chip in.`
    ),
    url: absolute(req, `/campaign/${campaign.slug}`),
    imageAlt: `${campaign.name} — ${SITE_NAME} campaign`,
    // A real campaign image is dynamic, so its dimensions are unknown; let the
    // crawler probe them and only advertise dimensions for the bundled default.
    ...(image ? { image: absolute(req, image), imageType: undefined, imageWidth: undefined, imageHeight: undefined } : {})
  };
};

module.exports = { siteMeta, campaignMeta };
