'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Moon, Sun, Layers3, Activity, ImageOff, Search } from 'lucide-react'
export default function SiteHeader() {
 const pathname=usePathname()
 const [theme,setTheme]=useState('dark')
 useEffect(()=>{setTheme(document.documentElement.dataset.theme || 'dark')},[])
 function toggle(){const next=theme==='dark'?'light':'dark';setTheme(next);document.documentElement.dataset.theme=next;try{localStorage.setItem('bindex-theme',next)}catch{}}
 return <header className="site-header"><div className="site-header-inner"><Link href="/" className="brand"><span className="brand-mark"><Layers3 size={23}/></span><span>Bindex<small>IL TUO ARCHIVIO POKÉMON</small></span></Link><nav aria-label="Navigazione principale"><Link className={pathname==='/identifica'?'active':''} href="/identifica"><Search size={17}/>Identifica</Link><Link className={pathname==='/' || pathname==='/carte'?'active':''} href="/carte"><Layers3 size={17}/>Catalogo</Link><a className={pathname==='/mancanti'?'active':''} href="/carte?foto=missing"><ImageOff size={17}/>Senza foto</a><Link className={pathname==='/automazione'?'active':''} href="/automazione"><Activity size={17}/>Automazione</Link></nav><button className="theme-toggle" onClick={toggle} aria-label={theme==='dark'?'Attiva modalità chiara':'Attiva modalità notte'} title={theme==='dark'?'Modalità chiara':'Modalità notte'}>{theme==='dark'?<Sun size={20}/>:<Moon size={20}/>}</button></div></header>
}
