-- Webhook runs pin an exact commit in `ref`, so the branch and PR number are kept alongside.
ALTER TABLE runs ADD COLUMN branch TEXT;
ALTER TABLE runs ADD COLUMN pr_number INTEGER;
