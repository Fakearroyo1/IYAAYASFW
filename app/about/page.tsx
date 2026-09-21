import {BrandMark} from '@/app/store/appearance';
export const metadata={title:'IYAAYASFW member login | About',description:'Member access for a privately operated unit snackbar and gear store.'};
export default function About(){return <main className="identity-shell"><article className="panel identity-panel public-info">
 <a className="brand" href="/about"><BrandMark/><span>IYAAYASFW<span className="brand-sub">Unit Supply</span></span></a>
 <h1>IYAAYASFW member login</h1>
 <p>Member access for IYAAYASFW Unit Supply, a small, privately operated military-unit snackbar and gear website.</p>
 <h2>What the app does</h2>
 <p>Approved members use the store to browse snacks and unit gear, place pickup orders, view their own purchases and payment records, and use optional community and rewards features. Designated administrators manage inventory, orders, member access and account support.</p>
 <h2>How member login works</h2>
 <p>Members can use Google, a personal Microsoft account, a passkey, or an existing snackbar password. Linking a new method requires authorization and verification of an existing method or a private invitation. Signing in with a provider does not create public membership or grant administrator access.</p>
 <p>Google and Microsoft supply basic identity information so the app can recognize the member's linked account. The app requests sign-in and basic profile/email scopes. It does not request access to email messages, contacts, calendars, or cloud files.</p>
 <h2>Private membership</h2>
 <p>Access is limited to approved members. Catalog access, purchases, balances, member lists and administrative tools require sign-in. This information page and the privacy policy are publicly accessible.</p>
 <p>For membership, support, corrections or privacy requests, contact the snackbar administrator through your established unit contact channel or the support email shown on the Google sign-in consent screen. Never send passwords, passkey PINs or recovery codes.</p>
 <nav className="identity-links" aria-label="About and member access"><a href="/login">Member sign-in</a><a href="/privacy">Privacy policy</a></nav>
 </article></main>;}
