type Options={refresh:()=>Promise<void>;visible:()=>boolean;delay?:number;minInterval?:number;clock?:()=>number;schedule?:(fn:()=>void,ms:number)=>unknown;cancel?:(handle:unknown)=>void}
export function createLiveInvalidator({refresh,visible,delay=1500,minInterval=0,clock=Date.now,schedule=(fn,ms)=>setTimeout(fn,ms),cancel=h=>clearTimeout(h as ReturnType<typeof setTimeout>)}:Options){
 let active=true,dirty=false,busy=false,timer:unknown=null,lastStart=-Infinity
 function plan(){if(active&&dirty&&!busy&&timer===null&&visible())timer=schedule(()=>{timer=null;void run()},Math.max(delay,minInterval-(clock()-lastStart)))}
 async function run(){if(!active||busy||!visible())return;dirty=false;busy=true;lastStart=clock();try{await refresh()}finally{busy=false;plan()}}
 return {
  invalidate(){dirty=true;plan()},
  async refresh(){dirty=true;if(timer!==null){cancel(timer);timer=null}await run()},
  stop(){active=false;if(timer!==null)cancel(timer);timer=null}
 }
}
