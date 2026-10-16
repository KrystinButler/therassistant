import { useEffect, useState, type ReactNode } from 'react';
/** Once opened, keep an editor mounted so local navigation cannot erase its draft. */
export function PersistentSection({active,label,children}:{active:boolean;label:string;children:ReactNode}) {
 const [visited,setVisited]=useState(active);
 useEffect(()=>{if(active)setVisited(true);},[active]);
 return <section hidden={!active} aria-label={label}>{active||visited?children:null}</section>;
}
