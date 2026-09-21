import {ArrowRight,ShoppingBag,ReceiptText,UsersRound} from 'lucide-react';
import {BrandMark,ThemeToggle} from '@/app/store/appearance';

export const metadata={title:'IYAAYASFW member login | Unit Supply',description:'Your unit snackbar, gear and member account. Sign in to IYAAYASFW Unit Supply.'};

export default function About(){return <div className="landing">
 <a className="skip" href="#member-sign-in">Skip to sign-in</a>
 <header className="landing-header">
  <a className="brand" href="/" aria-label="IYAAYASFW Unit Supply home"><BrandMark/><span>IYAAYASFW<span className="brand-sub">Unit Supply</span></span></a>
  <nav aria-label="Public navigation"><a href="#about">About</a><a href="/privacy">Privacy</a><ThemeToggle/></nav>
 </header>
 <main>
  <section className="landing-hero" aria-labelledby="landing-title">
   <p className="landing-eyebrow">IYAAYASFW member login</p>
   <h1 id="landing-title">Your unit.<br/><span>Your essentials.</span></h1>
   <p className="landing-intro">Snacks, unit gear, and your member account.<br className="landing-desktop-break"/> All in one familiar place.</p>
   <a id="member-sign-in" className="landing-primary" href="/login">Sign in <ArrowRight size={22} aria-hidden="true"/></a>
   <p className="landing-methods">Google, Microsoft, passkey or password.</p>
   <p className="landing-access">For approved unit members.</p>
  </section>
  <section className="landing-features" aria-label="Your Unit Supply account">
   <div><ShoppingBag size={25} strokeWidth={1.5} aria-hidden="true"/><h2>Pick up your favorites.</h2><p>Browse snacks and unit gear.{' '}<br/>Order for pickup.</p></div>
   <div><ReceiptText size={25} strokeWidth={1.5} aria-hidden="true"/><h2>Keep track, easily.</h2><p>Check your purchases, payments{' '}<br/>and member tab.</p></div>
   <div><UsersRound size={25} strokeWidth={1.5} aria-hidden="true"/><h2>Made for your unit.</h2><p>Stay connected with optional{' '}<br/>community and rewards features.</p></div>
  </section>
  <section id="about" className="landing-about" aria-labelledby="about-title">
   <div className="landing-about-intro"><p className="landing-eyebrow">A small store. A familiar community.</p><h2 id="about-title">Built around{' '}<br/>the everyday.</h2></div>
   <div className="landing-about-copy">
    <h3>What the app does</h3>
    <p>IYAAYASFW Unit Supply is a privately operated military-unit snackbar and gear website. Approved members place pickup orders and manage their own account. Designated administrators handle inventory, orders and member support.</p>
    <h3>One membership. Your choice of sign-in.</h3>
    <p>Use Google, a personal Microsoft account, a passkey or your existing snackbar password. New methods are linked to your existing membership after verification. Signing in does not create public membership or grant administrator access.</p>
   </div>
  </section>
  <section className="landing-privacy" aria-labelledby="landing-privacy-title">
   <h2 id="landing-privacy-title">Why we request Google account information</h2>
   <p>Google sign-in is optional. We request openid, email and profile permissions to verify your account, recognize your linked sign-in method and help with account support. We keep your Google account identifier and observed email with your approved member ID. We do not request your messages, contacts, calendars or files, or use Google data for advertising. Personal Microsoft sign-in serves the same purpose.</p>
   <p>Your store records and management tools require sign-in. Read our <a href="/privacy">privacy policy</a> for how information is used, stored, protected and deleted.</p>
  </section>
 </main>
 <footer className="landing-footer"><span>IYAAYASFW · Unit Supply</span><nav aria-label="Support and privacy"><a href="mailto:snackbar@iyaayasfw.com">Contact the store</a><a href="/privacy">Privacy policy</a><a href="/login">Member sign-in <ArrowRight size={14} aria-hidden="true"/></a></nav></footer>
</div>;}
