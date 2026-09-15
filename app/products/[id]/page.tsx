import {getUser} from '@/app/auth';
import {redirect} from 'next/navigation';
import ProductPage from './product-page';
export const dynamic='force-dynamic';
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;if(!await getUser())redirect('/login?next='+encodeURIComponent('/products/'+id));return <ProductPage id={id}/>}
