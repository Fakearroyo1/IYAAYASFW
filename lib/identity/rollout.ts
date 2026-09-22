// This controls the deployment stage only. Every credential/enrollment commit
// separately requires an active member in the existing whitelist, current epoch,
// and a member-bound invitation or proof. A provider login never creates a member.
export function rolloutAllowsMember(env:{IDENTITY_ROLLOUT?:string;IDENTITY_OWNER_MEMBER_ID?:string},memberId:string){
 return !!memberId&&(memberId===env.IDENTITY_OWNER_MEMBER_ID||env.IDENTITY_ROLLOUT==='all-approved'||env.IDENTITY_ROLLOUT==='member-beta');
}
