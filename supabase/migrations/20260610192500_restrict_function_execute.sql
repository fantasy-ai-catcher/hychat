-- Legacy default privileges also granted execute on every public function
-- to anon. All HyChat RPCs are called with an authenticated (possibly
-- anonymous-auth) session, never with the bare anon key, so anon needs no
-- execute rights at all.
revoke execute on all functions in schema public from anon;

alter default privileges for role postgres in schema public
  revoke execute on functions from anon;
