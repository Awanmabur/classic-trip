const API=window.API_BASE||"http://localhost:3010";
const LS_TOKEN="ct_access",LS_USER="ct_user";
const getToken=()=>localStorage.getItem(LS_TOKEN)||"";
const setToken=t=>t?localStorage.setItem(LS_TOKEN,t):localStorage.removeItem(LS_TOKEN);
const getUser=()=>{try{return JSON.parse(localStorage.getItem(LS_USER)||"null")}catch{return null}};
const setUser=u=>u?localStorage.setItem(LS_USER,JSON.stringify(u)):localStorage.removeItem(LS_USER);
const authHeaders=()=>getToken()?{"Authorization":"Bearer "+getToken()}:{};
function captureReferral(){
  try{
    const usp=new URLSearchParams(location.search);
    const ref=usp.get("ref")||usp.get("shareRef")||usp.get("code");
    if(ref){
      localStorage.setItem("ct_ref", String(ref).trim());
    }
  }catch(_){}
}
function getReferral(){ return localStorage.getItem("ct_ref")||""; }
async function api(path,{method="GET",headers={},body=null,isForm=false}={}){
  const opts={method,headers:{...headers,...authHeaders()}};
  if(body){ if(isForm){opts.body=body;} else {opts.headers["Content-Type"]="application/json";opts.body=JSON.stringify(body);} }
  const r=await fetch(API+path,opts); const data=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data?.message||("Request failed: "+r.status));
  return data;
}
function applyNavVisibility(){
  const user=getUser(), role=user?.role||null;
  document.querySelectorAll("[data-guest]").forEach(el=>el.style.display=user?"none":"");
  document.querySelectorAll("[data-auth]").forEach(el=>{
    const need=el.getAttribute("data-auth");
    if(!user){el.style.display="none";return;}
    if(need==="any"){el.style.display="";return;}
    if(need==="customer") el.style.display=(role==="customer"||role==="admin")?"":"none";
    if(need==="partner") el.style.display=(role==="partner"||role==="admin")?"":"none";
    if(need==="admin") el.style.display=(role==="admin")?"":"none";
  });
}

const fmtDate=d=>{try{return new Date(d).toLocaleString()}catch{return String(d)}};
function cardTrip(t){
  const route=t.routeId||{}, vehicle=t.vehicleId||{};
  const title=route.title||`${route.from||"—"} ⇄ ${route.to||"—"}`;
  const type=(route.type||"trip").toUpperCase();
  const price=`${t.currency||"UGX"} ${Number(t.basePrice||0).toLocaleString()}`;
  const remaining=Math.max(0,(t.totalSeats||0)-(t.bookedSeats||0)-(t.heldSeats||0));
  return `<div class="cardItem">
    <h3>${title}</h3>
    <div class="meta">${type} • ${fmtDate(t.departureAt)} • ${vehicle.name||""}</div>
    <div class="row">
      <div><div class="meta">${price}</div><div class="meta">${remaining} seats left</div></div>
      <a class="btn btn--primary" href="/trip/${t._id}">Select</a>
    </div></div>`;
}
function initHomeTabs(){
  const wrap=document.getElementById("homeTabs"); if(!wrap) return;
  const hidden=document.getElementById("homeType");
  wrap.addEventListener("click",(e)=>{
    const btn=e.target.closest(".tab"); if(!btn) return;
    wrap.querySelectorAll(".tab").forEach(x=>x.classList.remove("is-active"));
    btn.classList.add("is-active"); hidden.value=btn.dataset.type||"";
  });
}
async function loadFeaturedTrips(){
  const el=document.getElementById("featuredTrips"); if(!el) return;
  try{ const r=await api("/api/trips?limit=6"); const items=r.items||[];
    el.innerHTML=items.map(cardTrip).join("")||`<div class="muted">No trips yet. Create trips in Partner → New Trip.</div>`;
  }catch(e){ el.innerHTML=`<div class="muted">Could not load trips: ${e.message}</div>`; }
}
function initLogin(){
  const form=document.getElementById("loginForm"); if(!form) return;
  const msg=document.getElementById("loginMsg");
  form.addEventListener("submit",async(e)=>{
    e.preventDefault(); msg.textContent="Signing in…";
    const body=Object.fromEntries(new FormData(form).entries());
    try{ const r=await api("/api/auth/login",{method:"POST",body});
      setToken(r.accessToken); setUser(r.user); applyNavVisibility();
      msg.textContent="✅ Logged in. Redirecting…"; setTimeout(()=>location.href="/",600);
    }catch(err){ msg.textContent="❌ "+err.message; }
  });
}
function initRegister(){
  const form=document.getElementById("registerForm"); if(!form) return;
  const msg=document.getElementById("registerMsg");
  form.addEventListener("submit",async(e)=>{
    e.preventDefault(); msg.textContent="Creating…";
    const body=Object.fromEntries(new FormData(form).entries());
    try{ const r=await api("/api/auth/register",{method:"POST",body});
      setToken(r.accessToken); setUser(r.user); applyNavVisibility();
      msg.textContent="✅ Account created. Redirecting…"; setTimeout(()=>location.href="/",600);
    }catch(err){ msg.textContent="❌ "+err.message; }
  });
}
function initLogout(){
  const btn=document.getElementById("btnLogout"); if(!btn) return;
  btn.addEventListener("click",async()=>{
    try{await api("/api/auth/logout",{method:"POST"});}catch(_){}
    setToken(""); setUser(null); applyNavVisibility(); location.href="/logout";
  });
}
function initSearch(){
  const form=document.getElementById("searchForm"), results=document.getElementById("results"), meta=document.getElementById("resultsMeta");
  if(!form||!results) return;
  function syncFromQuery(){
    const usp=new URLSearchParams(location.search);
    ["type","from","to","date"].forEach(k=>{const el=form.querySelector(`[name="${k}"]`); if(el&&usp.get(k)) el.value=usp.get(k);});
    return usp;
  }
  async function run(usp){
    results.innerHTML=""; meta.textContent="Loading…";
    const qs=new URLSearchParams(); ["type","from","to","date","country","city"].forEach(k=>{const v=usp.get(k); if(v) qs.set(k,v);});
    qs.set("limit","18");
    const r=await api("/api/trips?"+qs.toString()); const items=r.items||[];
    results.innerHTML=items.map(cardTrip).join("")||`<div class="muted">No results. Try another search.</div>`;
    meta.textContent=`${r.total||items.length} results`;
  }
  form.addEventListener("submit",(e)=>{
    e.preventDefault();
    const usp=new URLSearchParams(new FormData(form));
    history.replaceState({}, "", "/search?"+usp.toString());
    run(usp).catch(err=>meta.textContent="❌ "+err.message);
  });
  const usp=syncFromQuery(); if([...usp.keys()].length) run(usp).catch(()=>{});
}
function initTrip(){
  const tripId=window.TRIP_ID; if(!tripId) return;
  const titleEl=document.getElementById("tripTitle"), metaEl=document.getElementById("tripMeta");
  const gridEl=document.getElementById("seatGrid"), noteEl=document.getElementById("seatNote");
  const selCount=document.getElementById("selCount"), selPrice=document.getElementById("selPrice"), selStatus=document.getElementById("selStatus");
  const btnHold=document.getElementById("btnHold"), btnConfirm=document.getElementById("btnConfirm");
  let trip=null, selected=new Set(), heldByYou=new Set();
  const renderSummary=()=>{
    const n=selected.size; selCount.textContent=String(n);
    selPrice.textContent=trip?`${trip.currency} ${(trip.basePrice*n).toLocaleString()}`:"—";
    selStatus.textContent=heldByYou.size?"Held":"Not held";
    selStatus.className=heldByYou.size?"":"muted";
  };
  const renderSeats=(vehicle,availability)=>{
    const cols=vehicle.cols||6; gridEl.style.gridTemplateColumns=`repeat(${cols}, 1fr)`;
    const booked=new Set(availability.bookedSeats||[]), held=new Set(availability.heldSeats||[]);
    const seats=vehicle.seats||[]; const maxRow=vehicle.rows||Math.max(...seats.map(s=>s.row||1),1); const maxCol=cols;
    const grid=Array.from({length:maxRow*maxCol},()=>null);
    for(const s of seats){const r=Number(s.row||1)-1,c=Number(s.col||1)-1; grid[r*maxCol+c]=s;}
    const seatClass=(id,isAisle,taken,hold)=>["seat",isAisle?"is-aisle":"",taken?"is-taken":"",hold?"is-held":"",selected.has(id)?"is-selected":""] .filter(Boolean).join(" ");
    gridEl.innerHTML=grid.map(s=>{
      if(!s) return `<div class="seat is-aisle"></div>`;
      const id=s.seatId||s.label; const isA=!!s.isAisle; const taken=booked.has(id); const hol=held.has(id);
      return `<div class="${seatClass(id,isA,taken,hol)}" data-seat="${id}" data-aisle="${isA?1:0}" data-taken="${taken?1:0}">${isA?"":id}</div>`;
    }).join("");
    gridEl.onclick=(e)=>{
      const seat=e.target.closest("[data-seat]"); if(!seat) return;
      const id=seat.getAttribute("data-seat");
      if(seat.getAttribute("data-aisle")==="1"||seat.getAttribute("data-taken")==="1") return;
      if(selected.has(id)) selected.delete(id); else selected.add(id);
      if(heldByYou.size) heldByYou.clear();
      seat.classList.toggle("is-selected");
      renderSummary();
    };
  };
  (async()=>{
    try{
      const t=await api("/api/trips/"+tripId); trip=t.trip;
      const s=await api("/api/seats/trip/"+tripId);
      titleEl.textContent=(trip.routeId?.title||"Trip")+" — "+(trip.vehicleId?.name||"");
      metaEl.textContent=`${(trip.routeId?.type||"TRIP").toUpperCase()} • ${fmtDate(trip.departureAt)} • ${trip.currency} ${Number(trip.basePrice).toLocaleString()} • ${s.trip.remainingSeats} seats left`;
      renderSeats(s.vehicle,s.availability); renderSummary();
      // Show referral pill
const refCode=getReferral();
const refPill=document.getElementById("refPill"); if(refPill) refPill.textContent=refCode?refCode:"None";

// Share link (for logged-in user)
const shareLink=document.getElementById("shareLink");
const btnCopyShare=document.getElementById("btnCopyShare");
const shareMsg=document.getElementById("shareMsg");
if(shareLink && getUser()){
  // try get referral code from user object; if missing, fetch promotions/me
  const u=getUser();
  const ensureCode=async()=>{
    if(u?.referralCode) return u.referralCode;
    try{
      const pr=await api("/api/promotions/me");
      const code=pr.user?.referralCode||"";
      const nu={...u, referralCode:code}; setUser(nu);
      return code;
    }catch(_){ return ""; }
  };
  ensureCode().then(code=>{
    const link=location.origin+`/trip/${tripId}?ref=`+encodeURIComponent(code);
    shareLink.value=link;
    if(btnCopyShare) btnCopyShare.onclick=async()=>{
      await navigator.clipboard.writeText(link);
      shareMsg.textContent="✅ Copied!";
      setTimeout(()=>shareMsg.textContent="",1200);
    };
  });
}

btnHold.onclick=async()=>{
  if(!getToken()) {noteEl.textContent="❌ Login first to hold seats."; return;}
  if(!selected.size){noteEl.textContent="Select seats first."; return;}
  noteEl.textContent="Holding seats…";
  try{
    const r=await api(`/api/seats/trip/${tripId}/hold`,{method:"POST",body:{seats:[...selected]}});
    heldByYou=new Set(r.heldByYou||[]);
    noteEl.textContent=`✅ Held: ${[...heldByYou].join(", ")} (expires in ${r.holdMinutes} min)`;
    renderSummary();
    const s2=await api("/api/seats/trip/"+tripId); renderSeats(s2.vehicle,s2.availability);
  }catch(err){noteEl.textContent="❌ "+err.message;}
};

btnConfirm.onclick=async()=>{
  if(!getToken()) {noteEl.textContent="❌ Login first, or use Guest booking on the right."; return;}
  if(!selected.size){noteEl.textContent="Select seats first."; return;}
  noteEl.textContent="Confirming booking…";
  try{
    const useWalletEl=document.getElementById("useWallet");
    const useWallet=!!(useWalletEl && useWalletEl.checked);
    const r=await api(`/api/bookings/confirm`,{method:"POST",body:{tripId,seats:[...selected],paymentProvider:"none",referralCode:getReferral(),useWallet}});
    noteEl.textContent=`✅ Booking created: ${r.booking._id}`;
    selected.clear(); heldByYou.clear(); renderSummary();
    setTimeout(()=>location.href="/me/bookings",800);
  }catch(err){noteEl.textContent="❌ "+err.message;}
};

// Guest confirm
const btnGuest=document.getElementById("btnGuestConfirm");
if(btnGuest){
  const gNote=document.getElementById("gNote");
  btnGuest.onclick=async()=>{
    if(getToken()){ gNote.textContent="You are logged in. Use Confirm Booking for seat holds & wallet."; return; }
    if(!selected.size){gNote.textContent="Select seats first."; return;}
    const name=document.getElementById("gName")?.value||"";
    const email=document.getElementById("gEmail")?.value||"";
    const phone=document.getElementById("gPhone")?.value||"";
    gNote.textContent="Booking…";
    try{
      const r=await api(`/api/bookings/guest/confirm`,{method:"POST",body:{tripId,seats:[...selected],guest:{name,email,phone},referralCode:getReferral()}});
      gNote.textContent="✅ Booked! Redirecting to your guest booking page…";
      selected.clear(); renderSummary();
      setTimeout(()=>location.href="/guest/booking/"+encodeURIComponent(r.booking.guestLookupCode),800);
    }catch(err){ gNote.textContent="❌ "+err.message; }
  };
}
    }catch(e){metaEl.textContent="❌ "+e.message;}
  })();
}
function initMyBookings(){
  const el=document.getElementById("myBookings"), msg=document.getElementById("myBookingsMsg");
  if(!el) return;
  if(!getToken()){ msg.textContent="Login to see your bookings."; return; }
  (async()=>{
    try{
      const r=await api("/api/bookings/me"); const items=r.items||[];
      el.innerHTML=items.map(b=>{
        const trip=b.tripId||{}, route=trip.routeId||{};
        const title=route.title||"Booking", seats=(b.seats||[]).map(s=>s.seatId).join(", ");
        return `<div class="cardItem">
          <h3>${title}</h3>
          <div class="meta">${b.status.toUpperCase()} • ${fmtDate(b.travelDate)} • Seats: ${seats}</div>
          <div class="row"><div class="meta">${b.currency} ${Number(b.amount).toLocaleString()}</div>
          <button class="btn btn--ghost" data-cancel="${b._id}">Cancel</button></div></div>`;
      }).join("")||`<div class="muted">No bookings yet.</div>`;
      el.onclick=async(e)=>{
        const btn=e.target.closest("[data-cancel]"); if(!btn) return;
        btn.disabled=true;
        try{ await api(`/api/bookings/${btn.dataset.cancel}/cancel`,{method:"PATCH"}); location.reload(); }
        catch(err){ msg.textContent="❌ "+err.message; btn.disabled=false; }
      };
    }catch(err){ msg.textContent="❌ "+err.message; }
  })();
}
function initPartner(){
  const el=document.getElementById("partnerTrips"), msg=document.getElementById("partnerMsg");
  if(!el) return;
  const user=getUser();
  if(!user|| (user.role!=="partner" && user.role!=="admin")){ msg.textContent="Login as Partner to access this page."; return; }
  (async()=>{
    try{
      const r=await api("/api/partners/dashboard");
      document.getElementById("kTrips").textContent=r.stats?.trips??"0";
      document.getElementById("kBookings").textContent=r.stats?.totalBookings??"0";
      document.getElementById("kConfirmed").textContent=r.stats?.confirmedBookings??"0";
      const trips=r.recentTrips||[];
      el.innerHTML=trips.map(t=>`<div class="cardItem">
        <h3>${fmtDate(t.departureAt)}</h3><div class="meta">Trip ID: ${t._id}</div>
        <div class="row"><a class="btn btn--ghost" href="/partner/trips/${t._id}/occupancy">Occupancy</a>
        <a class="btn btn--primary" href="/partner/trips/${t._id}/manifest">Manifest</a></div></div>`).join("")||`<div class="muted">No trips yet. Create one.</div>`;
    }catch(err){ msg.textContent="❌ "+err.message; }
  })();
}
function initVehicleNew(){
  const form=document.getElementById("vehicleForm"); if(!form) return;
  const msg=document.getElementById("vehicleMsg");
  const layout=document.getElementById("layoutName"), wrap=document.getElementById("customSeatsWrap");
  const user=getUser();
  if(!user|| (user.role!=="partner" && user.role!=="admin")){ msg.textContent="Login as Partner first."; return; }
  layout.onchange=()=>wrap.style.display=layout.value==="custom"?"":"none";
  form.onsubmit=async(e)=>{
    e.preventDefault(); msg.textContent="Creating…";
    try{ const r=await api("/api/vehicles",{method:"POST",body:new FormData(form),isForm:true});
      msg.textContent="✅ Vehicle created: "+r.vehicle._id; form.reset();
    }catch(err){ msg.textContent="❌ "+err.message; }
  };
}
function initRouteNew(){
  const form=document.getElementById("routeForm"); if(!form) return;
  const msg=document.getElementById("routeMsg");
  const type=document.getElementById("routeType"), routeF=document.getElementById("routeFields"), hotelF=document.getElementById("hotelFields");
  const user=getUser();
  if(!user|| (user.role!=="partner" && user.role!=="admin")){ msg.textContent="Login as Partner first."; return; }
  const sync=()=>{ const isHotel=type.value==="hotel"; routeF.style.display=isHotel?"none":""; hotelF.style.display=isHotel?"": "none"; };
  type.onchange=sync; sync();
  form.onsubmit=async(e)=>{
    e.preventDefault(); msg.textContent="Creating…";
    try{ const r=await api("/api/routes",{method:"POST",body:new FormData(form),isForm:true});
      msg.textContent="✅ Listing created: "+r.route._id; form.reset();
    }catch(err){ msg.textContent="❌ "+err.message; }
  };
}
async function fillSelect(sel,items,label){ sel.innerHTML=(items||[]).map(it=>`<option value="${it._id}">${label(it)}</option>`).join(""); }
function initTripNew(){
  const form=document.getElementById("tripForm"); if(!form) return;
  const msg=document.getElementById("tripMsg");
  const user=getUser();
  if(!user|| (user.role!=="partner" && user.role!=="admin")){ msg.textContent="Login as Partner first."; return; }
  (async()=>{
    try{
      const routes=await api("/api/routes/mine/list");
      const vehicles=await api("/api/vehicles");
      await fillSelect(document.getElementById("routeId"),routes.items||[],r=>`${(r.type||"").toUpperCase()} • ${r.title}`);
      await fillSelect(document.getElementById("vehicleId"),vehicles.items||[],v=>`${(v.type||"").toUpperCase()} • ${v.name} • ${v.layoutName} • ${v.totalSeats} seats`);
    }catch(err){ msg.textContent="❌ "+err.message; }
  })();
  form.onsubmit=async(e)=>{
    e.preventDefault(); msg.textContent="Creating trip…";
    const body=Object.fromEntries(new FormData(form).entries());
    try{ const r=await api("/api/trips",{method:"POST",body});
      msg.textContent="✅ Trip created: "+r.trip._id; form.reset();
    }catch(err){ msg.textContent="❌ "+err.message; }
  };
}
function initOccupancy(){
  const tripId=window.TRIP_ID; const meta=document.getElementById("occMeta");
  if(!meta||!tripId) return;
  const user=getUser();
  if(!user|| (user.role!=="partner" && user.role!=="admin")){ meta.textContent="Login as Partner first."; return; }
  (async()=>{
    try{
      const r=await api(`/api/partners/trips/${tripId}/occupancy`);
      meta.textContent="Departure: "+fmtDate(r.trip.departureAt);
      document.getElementById("oTotal").textContent=r.trip.totalSeats;
      document.getElementById("oBooked").textContent=r.trip.bookedSeats;
      document.getElementById("oHeld").textContent=r.trip.heldSeats;
      document.getElementById("oRemaining").textContent=r.trip.remainingSeats;
      const wrap=document.getElementById("seatsTaken");
      wrap.innerHTML=(r.seatsTaken||[]).slice(0,200).map(s=>`<span class="pillSeat">${s}</span>`).join("")||`<div class="muted">No booked seats yet.</div>`;
    }catch(err){ meta.textContent="❌ "+err.message; }
  })();
}
function initManifest(){
  const tripId=window.TRIP_ID; const meta=document.getElementById("manMeta");
  const wrap=document.getElementById("manifest"), msg=document.getElementById("manMsg");
  if(!meta||!wrap||!tripId) return;
  const user=getUser();
  if(!user|| (user.role!=="partner" && user.role!=="admin")){ meta.textContent="Login as Partner first."; return; }
  (async()=>{
    try{
      const r=await api(`/api/partners/trips/${tripId}/manifest`);
      meta.textContent="Departure: "+fmtDate(r.trip.departureAt);
      wrap.innerHTML=(r.bookings||[]).map(b=>{
        const seats=(b.seats||[]).map(s=>s.seatId).join(", ");
        const u=b.userId||null; const g=b.guest||{};
        const who=u?u.name:(g.name||"Guest");
        const whoMeta=u?(u.email||""):(g.email||g.phone||"");
        return `<div class="cardItem">
          <h3>${who} — ${b.status.toUpperCase()}</h3>
          <div class="meta">${whoMeta}</div>
          <div class="meta">Seats: ${seats}</div>
          <div class="meta">${b.currency} ${Number(b.amount).toLocaleString()}</div>
        </div>`;
      }).join("")||`<div class="muted">No bookings yet.</div>`;
    }catch(err){ msg.textContent="❌ "+err.message; }
  })();
}
(function(){
  captureReferral();
  applyNavVisibility();
  initHomeTabs();
  initLogin();
  initRegister();
  initLogout();
  initSearch();
  initTrip();
  initMyBookings();
  initPartner();
  initVehicleNew();
  initRouteNew();
  initTripNew();
  initOccupancy();
  initManifest();
  loadFeaturedTrips();
})();
