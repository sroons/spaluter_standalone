/* canvas drawing for mockups — pulsar-synthesis-flavoured waveforms */
function ctxOf(id){
  const c=document.getElementById(id); if(!c) return null;
  const r=c.getBoundingClientRect(); const dpr=2;
  c.width=Math.round(r.width*dpr); c.height=Math.round(r.height*dpr);
  const x=c.getContext('2d'); x.scale(dpr,dpr); return {x,w:r.width,h:r.height};
}
function pulsaret(t,k){ // brief grain
  const car=Math.sin(t*Math.PI*2*k.f1)*Math.cos(t*Math.PI*2*k.f2+k.ph);
  const ph=(t%k.per)/k.per; const env=ph<k.duty?Math.exp(-k.dec*ph/k.duty):0;
  return car*env;
}
function drawScope(id){
  const o=ctxOf(id); if(!o) return; const {x,w,h}=o; const mid=h/2;
  function trace(col,k,amp,lw){
    x.lineWidth=lw; x.strokeStyle=col; x.beginPath();
    for(let px=0;px<=w;px++){ const t=px/w; const y=mid+pulsaret(t,k)*amp;
      px?x.lineTo(px,y):x.moveTo(px,y);} 
    x.shadowColor=col; x.shadowBlur=8; x.stroke(); x.shadowBlur=0;
  }
  trace('#cfe6ff',{f1:26,f2:5,ph:.8,per:.16,duty:.85,dec:3.2},h*0.36,1.4);
  trace('#ff6f24',{f1:20,f2:4.5,ph:0,per:.22,duty:.82,dec:2.6},h*0.40,1.8);
}
function drawWave(id,kind,col){
  const o=ctxOf(id); if(!o) return; const {x,w,h}=o; const mid=h/2;
  // faint grid
  x.strokeStyle='rgba(207,230,255,.05)'; x.lineWidth=1;
  for(let gx=0;gx<w;gx+=22){x.beginPath();x.moveTo(gx,0);x.lineTo(gx,h);x.stroke();}
  x.strokeStyle='rgba(207,230,255,.10)'; x.beginPath();x.moveTo(0,mid);x.lineTo(w,mid);x.stroke();
  x.lineWidth=2; x.strokeStyle=col; x.shadowColor=col; x.shadowBlur=6; x.beginPath();
  for(let px=0;px<=w;px++){ const t=px/w; let y;
    if(kind==='sine') y=Math.sin(t*Math.PI*2*3);
    else if(kind==='sinc'){const s=(t-.5)*16; y=s===0?1:Math.sin(s)/s;}
    else if(kind==='gauss') y=Math.exp(-Math.pow((t-.5)/.16,2))*2-1;
    else if(kind==='square') y=(t*4%1)<.5?.86:-.86;
    else if(kind==='tri'){const p=(t*2+.25)%1; y=(1-4*Math.abs(p-.5))*.86;}
    else if(kind==='saw') y=((t*2)%1)*1.7-.85;
    else if(kind==='rand'){const seg=Math.floor(t*9); y=(Math.sin(seg*97.13)*.5);}
    else y=Math.sin(t*Math.PI*2*3);
    const yy=mid-y*(h*0.40); px?x.lineTo(px,yy):x.moveTo(px,yy);
  }
  x.stroke(); x.shadowBlur=0;
}
function drawEnvFill(id,col){
  const o=ctxOf(id); if(!o) return; const {x,w,h}=o;
  x.fillStyle=col; x.beginPath(); x.moveTo(0,h);
  for(let px=0;px<=w;px++){const t=px/w; const y=h-Math.exp(-Math.pow((t-.5)/.18,2))*(h*0.86); x.lineTo(px,y);} 
  x.lineTo(w,h); x.closePath(); x.fill();
}
window.addEventListener('load',()=>{ if(window.__draw) window.__draw(); });
