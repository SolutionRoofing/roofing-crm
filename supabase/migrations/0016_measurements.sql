-- Roof measurements on each job (from GAF QuickMeasure, HOVER/Roofr or typed in) and a quantity
-- formula on each price list item, so "Fill quantities from measurements" can size an estimate.
alter table public.jobs add column measurements jsonb not null default '{}'::jsonb;
alter table public.catalog_items add column formula text not null default ''
  check (length(formula) <= 300);
