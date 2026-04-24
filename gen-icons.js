const fs=require('fs');const p=require('path');const d=p.join(process.env.USERPROFILE,'PortfolioAgent','appPackage');
const sig=Buffer.from([137,80,78,71,13,10,26,10]);
const ct=new Int32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;ct[n]=c;}
function crc(b){let c=-1;for(let i=0;i<b.length;i++)c=ct[(c^b[i])&0xff]^(c>>>8);return(c^-1)>>>0;}
function mk(t,data){const l=Buffer.alloc(4);l.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(t),data]);const cb=Buffer.alloc(4);cb.writeUInt32BE(crc(td));return Buffer.concat([l,td,cb]);}
const zlib=require('zlib');
function zs(r){return zlib.deflateSync(r,{level:9});}

function lerp(a,b,t){return Math.round(a+(b-a)*t);}
function dist(x,y,lx1,ly1,lx2,ly2){const dx=lx2-lx1,dy=ly2-ly1,len2=dx*dx+dy*dy;if(len2===0)return Math.sqrt((x-lx1)**2+(y-ly1)**2);let t=((x-lx1)*dx+(y-ly1)*dy)/len2;t=Math.max(0,Math.min(1,t));const px=lx1+t*dx,py=ly1+t*dy;return Math.sqrt((x-px)**2+(y-py)**2);}
function polyDist(x,y,pts){let mn=Infinity;for(let i=0;i<pts.length-1;i++){mn=Math.min(mn,dist(x,y,pts[i][0],pts[i][1],pts[i+1][0],pts[i+1][1]));}return mn;}

// 192x192 color icon — blue gradient bg with white stock trend arrow
const W=192,H=192;
const ih=Buffer.alloc(13);ih.writeUInt32BE(W,0);ih.writeUInt32BE(H,4);ih[8]=8;ih[9]=2; // RGB (no alpha to save space)
const rs=1+W*3,raw=Buffer.alloc(rs*H);
const R=24; // corner radius

// Trend line points (scaled for 192x192)
const line=[[20,148],[52,120],[72,140],[110,70],[140,95],[168,32]];
const ax=168,ay=32;
const arrowPts=[[ax,ay],[ax-18,ay+4],[ax-12,ay+14]];

for(let y=0;y<H;y++){const o=y*rs;for(let x=0;x<W;x++){const px=o+1+x*3;
  // Blue gradient
  const t=(x/W*0.4+y/H*0.6);
  const r=lerp(10,30,t),g=lerp(50,120,t),b=lerp(90,180,t);
  // Trend line
  const dd=polyDist(x,y,line);
  let white=0;
  if(dd<4)white=255;else if(dd<7)white=Math.round(200*(1-(dd-4)/3));
  // Arrowhead
  const v0=[arrowPts[1][0]-arrowPts[0][0],arrowPts[1][1]-arrowPts[0][1]];
  const v1=[arrowPts[2][0]-arrowPts[0][0],arrowPts[2][1]-arrowPts[0][1]];
  const v2=[x-arrowPts[0][0],y-arrowPts[0][1]];
  const d00=v0[0]*v0[0]+v0[1]*v0[1],d01=v0[0]*v1[0]+v0[1]*v1[1],d02=v0[0]*v2[0]+v0[1]*v2[1];
  const d11=v1[0]*v1[0]+v1[1]*v1[1],d12=v1[0]*v2[0]+v1[1]*v2[1];
  const inv=1/(d00*d11-d01*d01);
  const u=(d11*d02-d01*d12)*inv,v=(d00*d12-d01*d02)*inv;
  if(u>=0&&v>=0&&u+v<=1)white=255;
  raw[px]=Math.min(255,r+white);raw[px+1]=Math.min(255,g+white);raw[px+2]=Math.min(255,b+white);
}}
fs.writeFileSync(p.join(d,'color.png'),Buffer.concat([sig,mk('IHDR',ih),mk('IDAT',zs(raw)),mk('IEND',Buffer.alloc(0))]));

// 32x32 outline
const OW=32,OH=32;const oi=Buffer.alloc(13);oi.writeUInt32BE(OW,0);oi.writeUInt32BE(OH,4);oi[8]=8;oi[9]=6;
const ors=1+OW*4,or2=Buffer.alloc(ors*OH);
const sLine=line.map(([x,y])=>[Math.round(x*OW/W),Math.round(y*OH/H)]);
for(let y=0;y<OH;y++){const o=y*ors;for(let x=0;x<OW;x++){const px=o+1+x*4;
  const d2=polyDist(x,y,sLine);
  if(d2<1.8){or2[px]=0x58;or2[px+1]=0xA6;or2[px+2]=0xFF;or2[px+3]=255;}
}}
fs.writeFileSync(p.join(d,'outline.png'),Buffer.concat([sig,mk('IHDR',oi),mk('IDAT',zs(or2)),mk('IEND',Buffer.alloc(0))]));
const cs=fs.statSync(p.join(d,'color.png')).size;
const os=fs.statSync(p.join(d,'outline.png')).size;
console.log('Icons created — color: '+cs+' bytes, outline: '+os+' bytes');
