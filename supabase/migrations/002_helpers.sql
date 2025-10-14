-- Helper function: find record that matches at least two of three fields
create or replace function public.find_two_of_three_match(p_email text, p_phone text, p_full_name text)
returns table (id uuid)
language sql stable as $$
  with c as (
    select id,
      (case when email is not null and p_email is not null and lower(email) = lower(p_email) then 1 else 0 end) +
      (case when phone is not null and p_phone is not null and phone = p_phone then 1 else 0 end) +
      (case when full_name is not null and p_full_name is not null and full_name = p_full_name then 1 else 0 end) as matches
    from public.lead_identities
  )
  select id from c where matches >= 2 limit 1;
$$;

