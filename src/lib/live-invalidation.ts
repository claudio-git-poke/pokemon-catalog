type Options={refresh:()=>Promise<void>;visible:()=>boolean;delay?:number;schedule?:(fn:()=>void,ms:number)=>unknown;cancel?:(handle:unknown)=>void}
export function createLiveInvalidator({refresh,visible,delay=1500,schedule=(fn,ms)=>setTimeout(fn,ms),cancel=h=>clearTimeout(h as ReturnType<typeof setTimeout>)}:Options){
 let active=true,dirty=false,busy=false,timer:unknown=null
 function plan(){if(active&&dirty&&!busy&&timer===null&&visible())timer=schedule(()=>{timer=null;void run()},delay)}
 async function run(){if(!active||busy||!visible())return;dirty=false;busy=true;try{await refresh()}finally{busy=false;plan()}}
 return {
  invalidate(){dirty=true;plan()},
  async refresh(){dirty=true;if(timer!==null){cancel(timer);timer=null}await run()},
  stop(){active=false;if(timer!==null)cancel(timer);timer=null}
 }
}
