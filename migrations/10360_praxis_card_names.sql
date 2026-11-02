-- M10 Praxis AI, seamless tasks and meetings (docs/guides/praxis-ai.md §1.3 decision 31, §6.11): a card names the people, departments and projects its fields hold, apart from the records a press acts on, so an id reads as a name and the verb counts only what is acted on.
-- UP

-- Each name a card's fields hold ({ type, id, label }), written by the assistant's cards service at the
-- draft, an edit and the press; never null (an empty list when the card names nobody).
ALTER TABLE ai_action_draft ADD COLUMN IF NOT EXISTS names jsonb NOT NULL DEFAULT '[]'::jsonb;

-- DOWN
ALTER TABLE ai_action_draft DROP COLUMN IF EXISTS names;
