-- M10 governed knowledge base and AI assistant conversations.
-- UP
CREATE TABLE IF NOT EXISTS knowledge_category (
  knowledge_category_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES knowledge_category(knowledge_category_id),
  code citext NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  display_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_article (
  knowledge_article_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_category_id uuid REFERENCES knowledge_category(knowledge_category_id),
  slug citext NOT NULL UNIQUE,
  title text NOT NULL,
  summary text,
  status text NOT NULL DEFAULT 'draft',
  visibility text NOT NULL DEFAULT 'internal',
  owner_id uuid REFERENCES employee(employee_id),
  current_version integer NOT NULL DEFAULT 1 CHECK (current_version > 0),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_article_version (
  knowledge_article_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_article_id uuid NOT NULL REFERENCES knowledge_article(knowledge_article_id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  body text NOT NULL,
  change_summary text,
  source_document_id uuid REFERENCES document(document_id),
  created_by uuid NOT NULL REFERENCES app_user(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (knowledge_article_id, version)
);

CREATE TABLE IF NOT EXISTS knowledge_embedding (
  knowledge_embedding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_article_version_id uuid NOT NULL REFERENCES knowledge_article_version(knowledge_article_version_id) ON DELETE CASCADE,
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  content text NOT NULL,
  embedding vector,
  model text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (knowledge_article_version_id, chunk_index, model)
);

CREATE TABLE IF NOT EXISTS ai_conversation (
  ai_conversation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(user_id),
  title text,
  status text NOT NULL DEFAULT 'active',
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_message (
  ai_message_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_conversation_id uuid NOT NULL REFERENCES ai_conversation(ai_conversation_id) ON DELETE CASCADE,
  parent_message_id uuid REFERENCES ai_message(ai_message_id),
  role text NOT NULL,
  content text NOT NULL,
  ai_run_id uuid REFERENCES ai_run(run_id),
  feedback text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_message_citation (
  ai_message_citation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_message_id uuid NOT NULL REFERENCES ai_message(ai_message_id) ON DELETE CASCADE,
  knowledge_article_version_id uuid REFERENCES knowledge_article_version(knowledge_article_version_id),
  document_id uuid REFERENCES document(document_id),
  label text NOT NULL,
  locator jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (knowledge_article_version_id IS NOT NULL OR document_id IS NOT NULL)
);

-- DOWN
DROP TABLE IF EXISTS ai_message_citation;
DROP TABLE IF EXISTS ai_message;
DROP TABLE IF EXISTS ai_conversation;
DROP TABLE IF EXISTS knowledge_embedding;
DROP TABLE IF EXISTS knowledge_article_version;
DROP TABLE IF EXISTS knowledge_article;
DROP TABLE IF EXISTS knowledge_category;
