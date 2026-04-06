-- Idempotent repair: mark invited users who accepted a team invite but still have is_company_seat = false
-- (e.g. accepted before backend set the flag on insert/update).

UPDATE public.users u
SET is_company_seat = true
WHERE EXISTS (
  SELECT 1
  FROM public.company_invites ci
  WHERE LOWER(TRIM(ci.email)) = LOWER(TRIM(u.email))
    AND ci.company_id = u.company_id
    AND ci.status = 'accepted'
);
