import {env} from 'cloudflare:workers';
// Configure the owner address as a Worker secret; never accept it from a login request.
export const OWNER_EMAIL=env.OWNER_EMAIL?.trim().toLowerCase()||'';
