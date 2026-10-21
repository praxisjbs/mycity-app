-- M9 the AI connections' starting model lists (docs/guides/integrations.md §1.2 decision 2).
--
-- What each model is and does, and the provider's list price in dollars where it is published
-- and known; a price left null is filled when IT confirms one. Like Nigeria's public holidays
-- (0448), a provider's model list is set by an outside party, not a business choice MyCity makes,
-- so it may be a reference seed (A26). No key and no endpoint URL is seeded: a custom endpoint is
-- typed on the page.
--
-- The list is only a start: saving or testing a key reads the provider's own list, marks which of
-- these the key can use and adds the models the seed does not know. Anthropic's list holds Sonnet
-- and Haiku only (decision 3).
-- UP
INSERT INTO ai_model (provider, model, display_name, capabilities, source,
                      input_usd_per_million, output_usd_per_million, audio_usd_per_million, usd_per_audio_hour)
VALUES
  ('gemini', 'gemini-3.8-flash', 'Gemini 3.8 Flash', ARRAY['text', 'image', 'audio'], 'seed', NULL, NULL, NULL, NULL),
  ('gemini', 'gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite', ARRAY['text', 'image', 'audio'], 'seed', NULL, NULL, NULL, NULL),
  ('gemini', 'gemini-2.5-pro', 'Gemini 2.5 Pro', ARRAY['text', 'image', 'audio'], 'seed', 1.2500, 10.0000, NULL, NULL),
  ('gemini', 'gemini-2.5-flash', 'Gemini 2.5 Flash', ARRAY['text', 'image', 'audio'], 'seed', 0.3000, 2.5000, 1.0000, NULL),
  ('gemini', 'gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite', ARRAY['text', 'image', 'audio'], 'seed', 0.1000, 0.4000, 0.3000, NULL),
  ('groq', 'whisper-large-v3', 'Whisper Large v3', ARRAY['audio'], 'seed', NULL, NULL, NULL, 0.1110),
  ('groq', 'whisper-large-v3-turbo', 'Whisper Large v3 Turbo', ARRAY['audio'], 'seed', NULL, NULL, NULL, 0.0400),
  ('openai', 'text-embedding-3-small', 'Text Embedding 3 Small', ARRAY['embeddings'], 'seed', 0.0200, NULL, NULL, NULL),
  ('openai', 'text-embedding-3-large', 'Text Embedding 3 Large', ARRAY['embeddings'], 'seed', 0.1300, NULL, NULL, NULL),
  ('anthropic', 'claude-sonnet-5-5', 'Claude Sonnet 5.5', ARRAY['text', 'image'], 'seed', 2.0000, 10.0000, NULL, NULL),
  ('anthropic', 'claude-haiku-5-5', 'Claude Haiku 5.5', ARRAY['text', 'image'], 'seed', 0.1000, 0.5000, NULL, NULL),
  ('deepseek', 'deepseek-v4-flash', 'DeepSeek V4 Flash', ARRAY['text'], 'seed', NULL, NULL, NULL, NULL),
  ('deepseek', 'deepseek-v4-pro', 'DeepSeek V4 Pro', ARRAY['text'], 'seed', NULL, NULL, NULL, NULL)
-- DO NOTHING: a row the key's list or a person has since changed is never written over.
ON CONFLICT (provider, model) DO NOTHING;

-- DOWN
DELETE FROM ai_model
 WHERE source = 'seed'
   AND (provider, model::text) IN (
     ('gemini', 'gemini-3.8-flash'),
     ('gemini', 'gemini-3.5-flash-lite'),
     ('gemini', 'gemini-2.5-pro'),
     ('gemini', 'gemini-2.5-flash'),
     ('gemini', 'gemini-2.5-flash-lite'),
     ('groq', 'whisper-large-v3'),
     ('groq', 'whisper-large-v3-turbo'),
     ('openai', 'text-embedding-3-small'),
     ('openai', 'text-embedding-3-large'),
     ('anthropic', 'claude-sonnet-5-5'),
     ('anthropic', 'claude-haiku-5-5'),
     ('deepseek', 'deepseek-v4-flash'),
     ('deepseek', 'deepseek-v4-pro')
   );
