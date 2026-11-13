-- Customer view polish: zero-quantity lines ("only if needed" extras that weren't needed) are left
-- out of what the customer sees. The first visible line (the package line) always stays.
create or replace function private.customer_items(p_items jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  i jsonb;
  hidden_section boolean := false;
  hidden_total numeric := 0;
  out jsonb := '[]'::jsonb;
  first_item int := null;
  q numeric;
begin
  for i in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if i ->> 'type' = 'section' then
      hidden_section := coalesce(i ->> 'display', '') = 'hidden';
      if not hidden_section then
        out := out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'type', 'section', 'title', i -> 'title', 'display', i -> 'display', 'show_total', i -> 'show_total')));
      end if;
    elsif hidden_section then
      hidden_total := hidden_total + round(coalesce(nullif(i ->> 'qty', '')::numeric, 0) * coalesce(nullif(i ->> 'price', '')::numeric, 0), 2);
    elsif first_item is not null and coalesce(nullif(i ->> 'qty', '')::numeric, 0) = 0 then
      continue;
    else
      out := out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'name', i -> 'name', 'desc', i -> 'desc', 'unit', i -> 'unit', 'qty', i -> 'qty', 'price', i -> 'price')));
      if first_item is null then first_item := jsonb_array_length(out) - 1; end if;
    end if;
  end loop;

  if hidden_total <> 0 then
    if first_item is null then
      out := out || jsonb_build_array(jsonb_build_object('name', 'Roofing project', 'desc', '', 'unit', 'EA', 'qty', 1, 'price', hidden_total));
    else
      q := coalesce(nullif(out -> first_item ->> 'qty', '')::numeric, 0);
      if q = 0 then
        out := jsonb_set(out, array[first_item::text, 'qty'], '1'::jsonb);
        q := 1;
      end if;
      out := jsonb_set(out, array[first_item::text, 'price'],
        to_jsonb(round((coalesce(nullif(out -> first_item ->> 'price', '')::numeric, 0) * q + hidden_total) / q, 2)));
    end if;
  end if;
  return out;
end $$;
