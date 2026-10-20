-- M1 one waiting send per draft (docs/guides/mailbox.md §3 step 11, §4).
--
-- Scheduling a draft that was already scheduled added a second queued send beside the first, so
-- the message went out twice and showed twice in Drafts; and a draft discarded while scheduled
-- kept its send, its link set to null. The service now replaces a draft's queued send and cancels
-- it on discard. Here the waiting sends already doubled are cancelled, the newest kept, along with
-- those whose draft was discarded, and the index holds the rule from now on.
-- UP
UPDATE mail_send_queue q SET status = 'cancelled'
 WHERE q.status = 'queued' AND q.mail_draft_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM mail_send_queue n
                WHERE n.mail_draft_id = q.mail_draft_id AND n.status = 'queued'
                  AND (n.created_at, n.mail_send_queue_id) > (q.created_at, q.mail_send_queue_id));
UPDATE mail_send_queue SET status = 'cancelled' WHERE status = 'queued' AND mail_draft_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS mail_send_queue_one_per_draft_uq
  ON mail_send_queue (mail_draft_id) WHERE status = 'queued' AND mail_draft_id IS NOT NULL;

-- DOWN
-- The sends cancelled above stay cancelled: each was a second copy or belonged to a discarded draft.
DROP INDEX IF EXISTS mail_send_queue_one_per_draft_uq;
