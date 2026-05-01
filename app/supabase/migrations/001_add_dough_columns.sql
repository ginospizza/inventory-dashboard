-- Add dough-specific columns to weekly_metrics for dough stores (DD, WM, some PP/WM)

ALTER TABLE weekly_metrics ADD COLUMN IF NOT EXISTS dough_ordered_kg numeric NOT NULL DEFAULT 0;
ALTER TABLE weekly_metrics ADD COLUMN IF NOT EXISTS dough_estimated_kg numeric NOT NULL DEFAULT 0;
ALTER TABLE weekly_metrics ADD COLUMN IF NOT EXISTS dough_diff numeric NOT NULL DEFAULT 0;
ALTER TABLE weekly_metrics ADD COLUMN IF NOT EXISTS dough_cheese_ratio numeric NOT NULL DEFAULT 0;
ALTER TABLE weekly_metrics ADD COLUMN IF NOT EXISTS store_type text NOT NULL DEFAULT 'flour';
ALTER TABLE weekly_metrics ADD COLUMN IF NOT EXISTS dough_status text NOT NULL DEFAULT 'ok';
ALTER TABLE weekly_metrics ADD COLUMN IF NOT EXISTS dough_cheese_status text NOT NULL DEFAULT 'ok';

-- Add check constraints
ALTER TABLE weekly_metrics ADD CONSTRAINT chk_store_type CHECK (store_type IN ('flour', 'dough'));
ALTER TABLE weekly_metrics ADD CONSTRAINT chk_dough_status CHECK (dough_status IN ('ok', 'warn', 'bad'));
ALTER TABLE weekly_metrics ADD CONSTRAINT chk_dough_cheese_status CHECK (dough_cheese_status IN ('ok', 'warn', 'bad'));
