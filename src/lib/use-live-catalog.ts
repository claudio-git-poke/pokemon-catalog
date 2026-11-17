'use client'
import {useEffect,useRef,useState} from 'react'
import {supabase,catalogUsesTurso} from './supabase'
import {createLiveInvalidator} from './live-invalidation'
export function useLiveCatalog(load:(signal:AbortSignal)=>Promise<void>,enabled=true,scope='global',minInterval=0){
 const latest=useRef(load);latest.current=load
 const refreshRef=useRef<()=>Promise<void>>(async()=>{})
 const [status,setStatus]=useState('connecting')
 useEffect(()=>{
  if(!enabled)return
  let active=true,connected=false
  const controller=new AbortController()
  const visible=()=>document.visibilityState!=='hidden'
  const invalidator=createLiveInvalidator({minInterval,refresh:async()=>{try{await latest.current(controller.signal)}catch(error){if(!controller.signal.aborted)console.error('Aggiornamento dashboard:',error)}},visible})
  let revision='',checking=false
  const signal=(value:unknown)=>{if(value===undefined||value===null)return;const next=String(value);if(next!==revision){revision=next;invalidator.invalidate()}}
  // Mobile browsers can keep a stale websocket marked SUBSCRIBED after sleep.
  // Check only the tiny revision row, not the expensive aggregate counters.
  const checkSignal=async()=>{if(checking||!visible()||controller.signal.aborted)return;checking=true;try{const {data,error}=await supabase.from('catalog_live_updates').select('revision').eq('scope','catalog').abortSignal(controller.signal).single();if(!error&&!controller.signal.aborted)signal(data?.revision)}catch{/* Reconnection and the next heartbeat retry transient transport failures. */}finally{checking=false}}
  refreshRef.current=()=>invalidator.refresh()
  void invalidator.refresh()
  if(catalogUsesTurso){connected=true;setStatus('live');void checkSignal()}
  const channel=catalogUsesTurso?null:supabase.channel(`catalog-counters-${crypto.randomUUID()}`).on('postgres_changes',{event:'UPDATE',schema:'public',table:'catalog_live_updates'},payload=>signal(payload.new.revision)).subscribe(state=>{
   if(!active)return;connected=state==='SUBSCRIBED';setStatus(connected?'live':'reconnecting');if(connected){invalidator.invalidate();void checkSignal()}
  })
  const wake=()=>{if(visible())invalidator.invalidate()}
  document.addEventListener('visibilitychange',wake);window.addEventListener('focus',wake)
  // Degraded mode only: keep useful data while the websocket reconnects.
  const fallback=setInterval(()=>{if(!connected&&visible())invalidator.invalidate()},30000)
  const heartbeat=setInterval(()=>{void checkSignal()},10000)
  return()=>{active=false;controller.abort();invalidator.stop();refreshRef.current=async()=>{};clearInterval(fallback);clearInterval(heartbeat);document.removeEventListener('visibilitychange',wake);window.removeEventListener('focus',wake);if(channel)void supabase.removeChannel(channel)}
 },[enabled,scope,minInterval])
 return {status,refresh:()=>refreshRef.current()}
}
