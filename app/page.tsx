import Pilot from './pilot';
import {getUser} from './auth';
import About from './about/page';
export const dynamic='force-dynamic';
export default async function Home(){return await getUser()?<Pilot/>:<About/>}
