// A beta is an explicit list of existing member IDs, never an email/domain rule.
// Invalid configuration grants no beta access. Owner and full-release behavior
// remain separate so retaining an old list cannot expand owner-smoke.
export function betaMemberIds(value:string|undefined):string[]{
 try{
  const ids:unknown=JSON.parse(value||'[]');
  if(!Array.isArray(ids)||ids.length>100||ids.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(id))||new Set(ids).size!==ids.length)return [];
  return ids;
 }catch{return [];}
}
export function rolloutAllowsMember(env:{IDENTITY_ROLLOUT?:string;IDENTITY_OWNER_MEMBER_ID?:string;IDENTITY_BETA_MEMBER_IDS?:string},memberId:string){
 return !!memberId&&(memberId===env.IDENTITY_OWNER_MEMBER_ID||env.IDENTITY_ROLLOUT==='all-approved'||env.IDENTITY_ROLLOUT==='member-beta'&&betaMemberIds(env.IDENTITY_BETA_MEMBER_IDS).includes(memberId));
}
