import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'IYAAYASFW · Unit Supply',description:'Your unit snack bar. Snacks, member tabs, and unit gear.',robots:{index:false,follow:false},icons:{icon:'/favicon.svg'}};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
