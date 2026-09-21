import {headers} from 'next/headers';
import {env} from 'cloudflare:workers';
import {sessionUser} from '@/lib/auth/session';
import {applicationSession} from '@/lib/identity/sessions';
export async function getUser(){if(!env.DB)return null;const h=await headers();if(env.IDENTITY_ENABLED==='true')return applicationSession(env.DB,env,new Request('https://identity.invalid',{headers:h}),h.get('x-identity-audience')==='admin'?'admin':'member');return sessionUser(env.DB,h.get('cookie'))}
