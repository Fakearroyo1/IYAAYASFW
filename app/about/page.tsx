import {BrandMark} from '@/app/store/appearance';
export const metadata={title:'IYAAYASFW member login | About',description:'Member access for a privately operated unit snackbar and gear store.'};
export default function About(){return <main className="identity-shell"><article className="panel identity-panel public-info">
 <a className="brand" href="/about"><BrandMark/><span>IYAAYASFW<span className="brand-sub">Unit Supply</span></span></a>
 <h1>IYAAYASFW member login</h1>
 <p>Member access for IYAAYASFW Unit Supply, a small, privately operated military-unit snackbar and gear website.</p>
 <h2>What the app does</h2>
 <p>Approved members use the store to browse snacks and unit gear, place pickup orders, view their own purchases and payment records, and use optional community and rewards features. Designated administrators manage inventory, orders, member access and account support.</p>
 <nav className="identity-links" aria-label="Member access and privacy"><a href="/login">Member sign-in</a><a href="/privacy">Privacy policy</a></nav>
 <h2>How member login works</h2>
 <p>Members can use Google, a personal Microsoft account, a passkey, or an existing snackbar password. Linking a new method requires authorization and verification of an existing method or a private invitation. Signing in with a provider does not create public membership or grant administrator access.</p>
 <h2>Why we request Google account information</h2>
 <p>Google sign-in is optional. If you choose it, the app requests the openid, email and profile permissions to verify your Google account and recognize the sign-in method linked to your approved member ID. We keep Google's account identifier and the email observed during sign-in for account access, linked-method display and account support. Your existing store membership, purchases and permissions stay attached to your member ID. We do not use Google data for advertising or request access to email messages, contacts, calendars or cloud files. Personal Microsoft sign-in serves the same purpose.</p>
 <h2>Private membership</h2>
 <p>Access is limited to approved members. Catalog access, purchases, balances, member lists and administrative tools require sign-in. This information page and the privacy policy are publicly accessible.</p>
 <p>For membership, support, corrections or privacy requests, contact the snackbar administrator at <a href="mailto:snackbar@iyaayasfw.com">snackbar@iyaayasfw.com</a> or through your established unit contact channel. Never send passwords, passkey PINs or recovery codes.</p>
 <nav className="identity-links" aria-label="About and member access"><a href="/login">Member sign-in</a><a href="/privacy">Privacy policy</a></nav>
 </article></main>;}
