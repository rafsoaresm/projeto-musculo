-- Additive migration: the form before WhatsApp (Meu Site 0.66). 0001..0031 stay untouched.
--
-- site_inquiries.via: which form of the public page the message came from. 'FORM' is the contact form (every row before this one);
--   'WHATSAPP' is the form a visitor fills before the page sends them to the professional's WhatsApp (a name, a mobile and, when the site
--   asks it, a goal, kept in `message`). The inbox shows it, so the professional knows the person may already be writing on WhatsApp.

ALTER TABLE site_inquiries ADD COLUMN via TEXT NOT NULL DEFAULT 'FORM' CHECK (via IN ('FORM','WHATSAPP'));

INSERT INTO app_schema_versions(version) VALUES ('0032_site_inquiry_via');
