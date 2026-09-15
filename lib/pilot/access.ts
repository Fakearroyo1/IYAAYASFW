export async function accessFor(db:D1Database, member:{id:string;role:string}){
 const access=await db.prepare('SELECT snacks,gear FROM member_access WHERE member_id=?').bind(member.id).first<{snacks:number;gear:number}>();
 return {snacks:access?.snacks??1,gear:access?.gear??1};
}
export function canShop(member:{role:string},access:{snacks:number;gear:number},category:string){return member.role==='admin'||Boolean(category==='Gear'?access.gear:access.snacks)}
