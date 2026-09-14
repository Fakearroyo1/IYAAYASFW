import {headers} from 'next/headers';
import {env} from 'cloudflare:workers';
import {sessionUser} from '@/lib/auth/session';
export async function getUser(){if(!env.DB)return null;return sessionUser(env.DB,(await headers()).get('cookie'))}
