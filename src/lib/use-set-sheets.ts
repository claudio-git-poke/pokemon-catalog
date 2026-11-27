'use client'
// Loads the set sheets of the given catalog codes once per page session.
import {useEffect,useState} from 'react'
export type SetSheet={code:string,language:string,name:string|null,series?:string|null,release_date?:string|null,official?:number|null,total?:number|null,logo?:string|null,source:string,source_url?:string|null,derived_from?:string,filled_from?:string,matched_as?:string,also_from?:string[]}
const cache=new Map<string,SetSheet|null>()
export function useSetSheets(codes:string[]){
 const key=[...new Set(codes.filter(Boolean))].sort().join(',')
 const [,setVersion]=useState(0)
 useEffect(()=>{
  const missing=key.split(',').filter(c=>c&&!cache.has(c));if(!missing.length)return
  let live=true
  fetch('/api/set-sheets?codes='+encodeURIComponent(missing.join(','))).then(r=>r.ok?r.json():null).then(d=>{if(!d)return;for(const c of missing)cache.set(c,d.sheets?.[c]??null);if(live)setVersion(v=>v+1)}).catch(()=>{})
  return()=>{live=false}
 },[key])
 return (code:string)=>cache.get(code)??null
}
export const releaseYear=(sheet:SetSheet|null)=>sheet?.release_date?.slice(0,4)||null
