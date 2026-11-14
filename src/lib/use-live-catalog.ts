'use client'
import {useEffect,useRef,useState} from 'react'
import {supabase} from './supabase'
import {createLiveInvalidator} from './live-invalidation'
export function useLiveCatalog(load:(signal:AbortSignal)=>Promise<void>,enabled=true,scope='global'){
 const latest=useRef(load);latest.current=load
 const refreshRef=useRef<()=>Promise<void>>(async()=>{})
 const [status,setStatus]=useState('connecting')
 useEffect(()=>{
  if(!enabled)return
  let active=true,connected=false
  const controller=new AbortController()
  const visible=()=>document.visibilityState!=='hidden'
  const invalidator=createLiveInvalidator({refresh:async()=>{try{await latest.current(controller.signal)}catch(error){if(!controller.signal.aborted)console.error('Aggiornamento dashboard:',error)}},visible})
  refreshRef.current=()=>invalidator.refresh()
  void invalidator.refresh()
  const channel=supabase.channel(`catalog-counters-${crypto.randomUUID()}`).on('postgres_changes',{event:'UPDATE',schema:'public',table:'catalog_live_updates'},()=>invalidator.invalidate()).subscribe(state=>{
   if(!active)return;connected=state==='SUBSCRIBED';setStatus(connected?'live':'reconnecting');if(connected)invalidator.invalidate()
  })
  const wake=()=>{if(visible())void invalidator.refresh()}
  document.addEventListener('visibilitychange',wake);window.addEventListener('focus',wake)
  // Degraded mode only: keep useful data while the websocket reconnects.
  const fallback=setInterval(()=>{if(!connected&&visible())invalidator.invalidate()},30000)
  return()=>{active=false;controller.abort();invalidator.stop();refreshRef.current=async()=>{};clearInterval(fallback);document.removeEventListener('visibilitychange',wake);window.removeEventListener('focus',wake);void supabase.removeChannel(channel)}
 },[enabled,scope])
 return {status,refresh:()=>refreshRef.current()}
}
