import Pilot from './pilot';
import {getUser} from './auth';
import {redirect} from 'next/navigation';
export const dynamic='force-dynamic';
export default async function Home(){if(!await getUser())redirect('/login');return <Pilot/>}
