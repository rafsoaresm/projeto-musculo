-- Additive migration: the tagging of the public pages (Meu Site 0.71). 0001..0033 stay untouched.
--
-- site_tracking: one row per organization (one site per organization), read at each request of a public page, so changing an ID takes effect at
--   the next visit with no new publication, for both editors. It holds only public identifiers of the tools the site owner chose (Google
--   Analytics 4, Google Ads and the Meta Pixel), what the site counts as a conversion and the address of the site's own privacy notice: never a
--   script, never a secret. Google Tag Manager is not here on purpose: the public pages share the origin of the app (PENDENCIAS R3), and a
--   container runs any code its owner chooses. Nothing is loaded on a page before the visitor consents (the banner is the site's script).
--   The formats are checked by the application first; the CHECKs below are a second line of defence.
--   lead_value_cents: what one contact is worth to the professional, in cents of BRL, sent as the value of a conversion when set.
--   count_*: which contacts count as conversions for Google Ads and Meta (GA4 receives its events either way).

CREATE TABLE site_tracking (
  organization_id TEXT PRIMARY KEY NOT NULL REFERENCES organizations(id),
  ga4_id TEXT CHECK (ga4_id IS NULL OR (length(ga4_id) BETWEEN 8 AND 14 AND ga4_id GLOB 'G-*' AND substr(ga4_id, 3) NOT GLOB '*[^A-Z0-9]*')),
  ads_id TEXT CHECK (ads_id IS NULL OR (length(ads_id) BETWEEN 11 AND 15 AND ads_id GLOB 'AW-*' AND substr(ads_id, 4) NOT GLOB '*[^0-9]*')),
  ads_label_lead TEXT CHECK (ads_label_lead IS NULL OR (length(ads_label_lead) BETWEEN 6 AND 40 AND ads_label_lead NOT GLOB '*[^A-Za-z0-9_-]*')),
  ads_label_contact TEXT CHECK (ads_label_contact IS NULL OR (length(ads_label_contact) BETWEEN 6 AND 40 AND ads_label_contact NOT GLOB '*[^A-Za-z0-9_-]*')),
  meta_pixel_id TEXT CHECK (meta_pixel_id IS NULL OR (length(meta_pixel_id) BETWEEN 10 AND 20 AND meta_pixel_id NOT GLOB '*[^0-9]*')),
  lead_value_cents INTEGER CHECK (lead_value_cents IS NULL OR lead_value_cents BETWEEN 0 AND 100000000),
  count_whatsapp INTEGER NOT NULL DEFAULT 1 CHECK (count_whatsapp IN (0,1)),
  count_form INTEGER NOT NULL DEFAULT 1 CHECK (count_form IN (0,1)),
  count_email INTEGER NOT NULL DEFAULT 0 CHECK (count_email IN (0,1)),
  count_instagram INTEGER NOT NULL DEFAULT 0 CHECK (count_instagram IN (0,1)),
  privacy_url TEXT CHECK (privacy_url IS NULL OR (length(privacy_url) BETWEEN 12 AND 500 AND privacy_url GLOB 'https://?*' AND privacy_url NOT GLOB '*[ <>"]*')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by_user_id TEXT NOT NULL REFERENCES users(id),
  -- A label of a conversion belongs to a Google Ads account: none without its ID.
  CHECK (ads_id IS NOT NULL OR (ads_label_lead IS NULL AND ads_label_contact IS NULL))
);

INSERT INTO app_schema_versions(version) VALUES ('0034_site_tracking');
