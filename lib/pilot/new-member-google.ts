import { type DB, first, stmt, guard, uid, audit } from "./core";

// Creation is an explicit administrator whitelist decision. Store a one-use,
// epoch-bound reservation; provider claims still have to prove the address.
export async function newMemberGoogle(
  db: DB,
  memberId: string,
  email: string,
  actor: string,
  active: boolean,
) {
  if (
    !(await first(
      db,
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='identity_state'",
    ))
  )
    return [];
  const now = Date.now(),
    match = email.toLowerCase();
  return [
    guard(
      db,
      "NOT EXISTS(SELECT 1 FROM identity_grants WHERE kind='bootstrap' AND provider='google' AND lower(match_email)=?) AND NOT EXISTS(SELECT 1 FROM identity_credentials WHERE kind='google' AND lower(observed_email)=? AND member_id<>?)",
      match,
      match,
      memberId,
    ),
    stmt(
      db,
      "INSERT INTO identity_grants(id,member_id,kind,purpose,provider,match_email,raw_email,epoch,created_by,created_at,expires_at) SELECT ?,member_id,'bootstrap','first-association','google',?,?,epoch,?,?,? FROM identity_state WHERE member_id=?",
      uid(),
      match,
      email,
      actor,
      now,
      now + 90 * 86400000,
      memberId,
    ),
    audit(db, actor, "new_member_google_preauthorized", memberId, {
      active,
      source: "administrator_whitelist",
      expiresAt: now + 90 * 86400000,
    }),
  ];
}
