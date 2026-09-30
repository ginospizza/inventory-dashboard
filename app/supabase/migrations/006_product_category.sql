-- Product categories for grouping secondary SKUs (James, Sept 30 2026:
-- "Sometimes we change a SKU for a new product, new supplier, etc, but it
-- would useful if the old and new SKUs are grouped").
--
-- Free text, nullable: a product with no category shows on its own as before.
-- The Secondary Products tab groups products sharing a category (matched
-- case-insensitively) under one subtotal row, so year-over-year still reads
-- correctly when an old SKU is replaced by a new one.
--
-- Seeded with the three groups James pointed out; he can edit the rest in
-- Admin > Product Classification.
--
-- Idempotent.

begin;

alter table products add column if not exists category text;

update products set category = 'Pepperoni'    where code in ('20214', 'T020214')  and category is null;
update products set category = 'Green Olives' where code in ('40107', '040107C')  and category is null;
update products set category = 'Black Olives' where code in ('40108', '40108A')   and category is null;

commit;
