-- Files attached to mail received in the SuperAdmin Mailbox.
--
-- The Cloudflare email worker stores each attachment in the private vault
-- bucket under mail-inbound/<uuid>/<name> and posts its details with the
-- message. Each element: {"key", "fileName", "contentType", "size"}.

ALTER TABLE mail_messages ADD COLUMN attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE mail_messages
  ADD CONSTRAINT mail_attachments_chk CHECK (jsonb_typeof(attachments) = 'array' AND jsonb_array_length(attachments) <= 20);
