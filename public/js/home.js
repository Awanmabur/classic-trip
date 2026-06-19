
    const $ = (s, r=document) => r.querySelector(s);
    const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
    const today = new Date().toISOString().slice(0,10);

    const bootstrap = window.CLASSIC_TRIP_DATA || {};
    const listings = bootstrap.listings || [];
    const marketplace = bootstrap.marketplace || {};

    const icons = {Bus:'fa-bus',Hotel:'fa-hotel',Flight:'fa-plane-departure',Train:'fa-train',Ferry:'fa-ship',Tour:'fa-map-location-dot','Car rental':'fa-car','Airport transfer':'fa-van-shuttle',Events:'fa-calendar-days',Cargo:'fa-boxes-stacked','Visa support':'fa-passport','Travel insurance':'fa-shield-heart','Travel packages':'fa-suitcase-rolling'};
    let current = null, selected = [], held = [], holdId = '', timerId = null, seconds = 600, addonTotal = 0;

    function money(n, c='UGX'){return `${c} ${Math.round(n).toLocaleString()}`}
    function escapeHtml(value){return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))}
    function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.classList.remove('show'),2300)}
    function copyText(text, message){
      if(navigator.clipboard?.writeText){
        navigator.clipboard.writeText(text).then(()=>toast(message)).catch(()=>toast('Share link ready to copy from the address bar.'));
      } else {
        toast('Share link ready to copy from the address bar.');
      }
    }


    const blogs = {
      route:{tag:'Route guide', icon:'fa-route', title:'Kampala to Nairobi: what travelers should know', date:'06 May 2026', read:'4 min read', img:'https://images.unsplash.com/photo-1517840901100-8179e982acb7?auto=format&fit=crop&w=1200&q=70', intro:'A simple guide for customers comparing buses between Uganda and Kenya.', body:['Choose a departure that gives enough time for check-in, luggage loading and border processing. In the real platform, each partner can add pickup points, boarding instructions and document rules.', 'The seat map helps customers choose a preferred position before payment. When they hold a seat, the platform reserves it for 10 minutes so another customer cannot take it during checkout.', 'For cross-border trips, add clear passport or ID requirements, baggage limits, refund rules and support contacts so customers know what to prepare before travel.']},
      hotel:{tag:'Stay tips', icon:'fa-hotel', title:'How to choose rooms, houses and apartments safely', date:'04 May 2026', read:'3 min read', img:'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=70', intro:'Help customers understand room maps, amenities and booking confidence.', body:['Hotel partners can upload a room, floor or house layout so customers understand exactly what they are booking. This is useful for rooms, apartments, villas and guest houses.', 'Customers should check the room type, capacity, amenities, cancellation rule and payment method before confirming. The saved page also lets them compare favorite stays later.', 'After payment, the receipt and booking details appear in My Bookings and can also be delivered through Gmail or WhatsApp.']},
      promo:{tag:'Promotion', icon:'fa-bullhorn', title:'How partner promotions help companies get bookings', date:'01 May 2026', read:'5 min read', img:'https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=1200&q=70', intro:'Show partners how promoted listings, banners and referral links can increase visibility.', body:['Promoted listings can place a partner higher in the route, hotel, flight or train results. A clean ads page can show active campaigns, budget, clicks and bookings.', 'Promoters can share links and receive commission when their link converts. In this concept, the platform supports promoter commission and platform fee tracking.', 'Good promotion pages should include images, route/city targeting, performance analytics, payment history and simple controls for pausing or boosting a campaign.']},
      tickets:{tag:'Booking help', icon:'fa-ticket', title:'Where to find tickets after Gmail or WhatsApp delivery', date:'29 Apr 2026', read:'2 min read', img:'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&w=1200&q=70', intro:'Customers can access tickets from messages and from the My Bookings page.', body:['After payment, the booking can be sent through Gmail and WhatsApp. The same ticket should also be stored in My Bookings so customers can open it later.', 'The receipt button helps customers see the service, selected seat or room, total paid, customer name, delivery channel and confirmation status.', 'In the real backend, this page can sync tickets by email, phone number, account login or booking code.']}
    };
    let activeBlogId = null;
    function openBlog(id){
      const ev = window.event; if(ev) ev.stopPropagation();
      const b = blogs[id]; if(!b) return toast('Blog page not found.');
      activeBlogId = id;
      $('#blogModalTag').innerHTML = `<i class="fa-solid ${b.icon}"></i> ${b.tag}`;
      $('#blogModalTitle').textContent = b.title;
      $('#blogModalSub').textContent = `${b.date} • ${b.read}`;
      $('#blogModalImg').src = b.img;
      $('#blogHeroTitle').textContent = b.title;
      $('#blogHeroIntro').textContent = b.intro;
      $('#blogArticleBody').innerHTML = `<div class="blogMeta"><span><i class="fa-regular fa-calendar"></i> ${b.date}</span><span><i class="fa-regular fa-clock"></i> ${b.read}</span><span><i class="fa-solid ${b.icon}"></i> ${b.tag}</span></div>` + b.body.map((p,i)=>`${i===1?'<h4>Before you book</h4>':''}<p>${p}</p>`).join('');
      $('#blogModal').classList.add('open');
      document.body.style.overflow='hidden';
    }
    function closeBlog(){ $('#blogModal').classList.remove('open'); document.body.style.overflow=''; }
    function loveBlog(id){ const ev = window.event; if(ev) ev.stopPropagation(); const b = blogs[id]; toast(b ? `${b.title} saved.` : 'Blog saved.'); }
    function shareBlog(id){
      const ev = window.event; if(ev) ev.stopPropagation();
      const b = blogs[id]; const title = b ? b.title : 'Classic Trip blog';
      if(navigator.share){ navigator.share({title, text:`Read this on Classic Trip: ${title}`}).catch(()=>{}); }
      else copyText(`${window.location.origin}${window.location.pathname}#blog-${id}`, 'Blog share link copied.');
    }

    const backendBookings = (window.CLASSIC_TRIP_DATA && window.CLASSIC_TRIP_DATA.bookings) || [];
    let myBookings = backendBookings;
    function saveBookings(){ myBookings = backendBookings.concat(myBookings.filter(item => !backendBookings.some(existing => existing.code === item.code))); }
    function bookingIcon(type){ return icons[type] || 'fa-ticket'; }

    function saveListing(id){
      const ev = window.event; if(ev) ev.stopPropagation();
      const item = listings.find(x=>x.id===id);
      toast(item ? `${item.title} saved to Love page.` : 'Saved to Love page.');
      scrollToSectionId('saved');
    }
    function shareListing(id){
      const ev = window.event; if(ev) ev.stopPropagation();
      const item = listings.find(x=>x.id===id);
      const title = item ? item.title : 'Classic Trip listing';
      if(navigator.share){
        navigator.share({title, text:`Check this on Classic Trip: ${title}`}).catch(()=>{});
      } else {
        const href = item?.url || (item ? `/listings/${item.serviceType}/${item.slug}` : window.location.pathname);
        copyText(new URL(href, window.location.origin).href, 'Share link copied.');
      }
    }

    function renderSaved(){
      const wrap = $('#savedCards'); if(!wrap) return;
      const savedItems = ['bus','hotel','flight','train','more'].flatMap(group=>listings.filter(x=>x.group===group).slice(0, group === 'more' ? 2 : 1)).filter(Boolean);
      wrap.innerHTML = savedItems.map(x=>`<article class="ticketCard"><div class="ticketTop"><div><span class="badge badgeInfo"><i class="fa-solid ${icons[x.type]||'fa-ticket'}"></i> ${x.type}</span><h3 class="ticketTitle" style="margin-top:8px">${x.title}</h3><div class="ticketMeta"><span><i class="fa-solid fa-building"></i> ${x.partner}</span><span><i class="fa-regular fa-clock"></i> ${x.time}</span><span><i class="fa-solid fa-star"></i> ${x.rating}</span></div></div><div class="ticketCode">Saved</div></div><div class="kv"><div><span>From</span><b>${x.from}</b></div><div><span>To</span><b>${x.to}</b></div><div><span>Price</span><b>${money(x.price,x.currency)}</b></div></div><div class="ticketActions"><button class="btn btnGhost" onclick="toast('Saved pick kept in your account.')"><i class="fa-regular fa-heart"></i> Saved</button>${x.bookable ? `<button class="btn btnPrimary" onclick="goBook('${x.id}', event)"><i class="fa-solid fa-ticket"></i> Book</button>` : `<button class="btn btnGhost" onclick="goListing('${x.id}', event)"><i class="fa-regular fa-eye"></i> View</button>`}</div></article>`).join('');
    }
    function renderBookings(){
      const wrap = $('#bookingCards'); if(!wrap) return;
      if(!myBookings.length){
        wrap.innerHTML = `<div class="ticketCard"><h3 class="ticketTitle">No bookings yet</h3><p class="muted" style="margin:0;font-size:13px;font-weight:800">After payment confirmation, tickets will appear here. Tickets received from Gmail or WhatsApp can also be synced into this page later.</p></div>`;
        return;
      }
      wrap.innerHTML = myBookings.map((b,i)=>`
        <article class="ticketCard">
          <div class="ticketTop">
            <div>
              <span class="badge badgeInfo"><i class="fa-solid ${bookingIcon(b.type)}"></i> ${b.type}</span>
              <h3 class="ticketTitle" style="margin-top:8px">${b.title}</h3>
              <div class="ticketMeta"><span><i class="fa-solid fa-user"></i> ${b.customer}</span><span><i class="fa-solid fa-chair"></i> ${b.selected}</span><span><i class="fa-solid fa-share-nodes"></i> ${b.channel}</span></div>
            </div>
            <div class="ticketCode">${b.code}</div>
          </div>
          <div class="kv"><div><span>Status</span><b>${b.status}</b></div><div><span>Total</span><b>${b.total}</b></div><div><span>Source</span><b>${b.date}</b></div></div>
          <div class="ticketActions"><button class="btn btnGhost" onclick="openReceipt(${i})"><i class="fa-solid fa-receipt"></i> Open receipt</button>${b.ticketUrl ? `<a class="btn btnPrimary" href="${b.ticketUrl}"><i class="fa-solid fa-ticket"></i> Open ticket</a>` : `<a class="btn btnPrimary" href="/tickets?bookingRef=${encodeURIComponent(b.code)}"><i class="fa-solid fa-ticket"></i> Find ticket</a>`}</div>
        </article>`).join('');
    }

    function renderMarketplaceSurface(){
      const typeStats = marketplace.typeStats || [];
      typeStats.forEach(stat => {
        const sectionId = stat.type === 'bus' ? 'bus' : stat.type;
        const text = document.querySelector(`#${sectionId} .sectionHead p`);
        if(!text || !stat.count) return;
        const parts = [`${stat.count} live listings`, `${stat.remainingSeats || 0} seats / rooms open`];
        if(stat.nextDeparture) parts.push(`next ${new Date(stat.nextDeparture).toLocaleString('en-GB', {dateStyle:'medium', timeStyle:'short'})}`);
        if(stat.price?.lowest) parts.push(`from ${money(stat.price.lowest, stat.price.currency)}`);
        text.textContent = parts.join(' - ');
      });

      const ads = $('#adsCards');
      const highlights = marketplace.routeHighlights || [];
      if(ads && highlights.length){
        ads.innerHTML = highlights.slice(0,4).map(item => `
          <article class="promoCard">
            <div class="promoIcon"><i class="fa-solid fa-route"></i></div>
            <span class="badge badgeInfo">${escapeHtml(item.corridor || item.key || 'Route')}</span>
            <h3>${escapeHtml(item.label || 'Live route')}</h3>
            <p>${escapeHtml(String(item.count || 0))} listings with ${escapeHtml(String(item.remainingSeats || 0))} seats or rooms open from backend inventory.</p>
            <a class="btn btnGhost" href="/search?corridor=${encodeURIComponent(item.corridor || item.key || '')}">View options</a>
          </article>
        `).join('');
      }

      const guides = marketplace.guides || [];
      const blogCards = $('#blogCards');
      if(blogCards && guides.length){
        blogCards.innerHTML = guides.map(card => `
          <article class="promoCard blogCard">
            <div class="blogImage">
              <img src="${escapeHtml(card.image || '')}" alt="${escapeHtml(card.title || 'Travel guide')}">
              <span class="badge badgeInfo blogTag"><i class="fa-solid fa-route"></i> ${escapeHtml(card.tag || 'Guide')}</span>
              <div class="blogIconActions">
                <a class="miniIcon" title="View" href="${escapeHtml(card.url || '#')}"><i class="fa-regular fa-eye"></i></a>
                <button class="miniIcon" title="Save" onclick="saveListing('${escapeHtml(card.listingId || '')}')"><i class="fa-regular fa-heart"></i></button>
                <button class="miniIcon" title="Share" onclick="shareListing('${escapeHtml(card.listingId || '')}')"><i class="fa-solid fa-share-nodes"></i></button>
              </div>
            </div>
            <div class="blogBody">
              <h3>${escapeHtml(card.title || 'Travel guide')}</h3>
              <div class="blogMeta"><span><i class="fa-solid fa-location-dot"></i> ${escapeHtml(card.location || 'Route')}</span><span><i class="fa-solid fa-building"></i> ${escapeHtml(card.partner || 'Partner')}</span><span><i class="fa-solid fa-coins"></i> ${card.price ? money(card.price.amount, card.price.currency) : 'Live price'}</span></div>
              <p>${escapeHtml(card.excerpt || 'Generated from live listing data.')}</p>
              <div class="blogActions"><a class="btn btnGhost" href="${escapeHtml(card.url || '#')}"><i class="fa-regular fa-eye"></i> Open listing</a></div>
            </div>
          </article>
        `).join('');
      }
    }
    function openReceipt(i){
      const b = myBookings[i]; if(!b) return;
      $('#receiptTitle').textContent = b.title;
      $('#receiptSub').textContent = `${b.code} • ${b.status}`;
      $('#receiptPaper').innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:8px"><div class="brand"><span class="mark">CT</span><span>Classic Trip</span></div><span class="ticketCode">${b.code}</span></div>
        <div class="receiptRow"><span>Customer</span><b>${b.customer}</b></div>
        <div class="receiptRow"><span>Service</span><b>${b.title}</b></div>
        <div class="receiptRow"><span>Type</span><b>${b.type}</b></div>
        <div class="receiptRow"><span>Selected</span><b>${b.selected}</b></div>
        <div class="receiptRow"><span>Paid total</span><b>${b.total}</b></div>
        <div class="receiptRow"><span>Delivery</span><b>${b.channel} + My bookings</b></div>
        <div class="receiptRow"><span>Status</span><b>${b.status}</b></div>`;
      $('#receiptModal').classList.add('open');
      document.body.style.overflow='hidden';
    }
    function closeReceipt(){ $('#receiptModal').classList.remove('open'); document.body.style.overflow=''; }

    function listingCornerBadge(x){
      if(x.availability <= 0) return {cls:'full', icon:'fa-circle-xmark', text:'No seats'};
      if(x.isSponsored) return {cls:'promo', icon:'fa-bullhorn', text:'Sponsored'};
      if(!x.bookable) return {cls:'promo', icon:'fa-clock', text:'Teaser'};
      return {cls:'available', icon:'fa-circle-check', text:`${x.remainingInventory || x.availability || 'Live'} left`};
    }

    function cardHTML(x){
      const corner = listingCornerBadge(x);
      return `<article class="listing" data-id="${escapeHtml(x.id)}" data-group="${escapeHtml(x.group)}" data-corridor="${escapeHtml(x.corridor||'regional')}" role="button" tabindex="0" aria-label="Open ${escapeHtml(x.title)}">
        <div class="thumb"><img src="${escapeHtml(x.img)}" alt="${escapeHtml(x.title)}"><div class="cornerBadge ${corner.cls}"><i class="fa-solid ${corner.icon}"></i> ${escapeHtml(corner.text)}</div><div class="thumbBadges"><span class="badge badgeOk"><i class="fa-solid fa-star"></i> ${escapeHtml(x.rating || 'New')}</span><span class="badge badgeInfo"><i class="fa-solid ${icons[x.type]||'fa-ticket'}"></i> ${escapeHtml(x.typeLabel || x.type)}</span></div><div class="thumbActions"><button class="miniIcon" type="button" title="Save" onclick="saveListing('${escapeHtml(x.id)}')"><i class="fa-regular fa-heart"></i></button><button class="miniIcon" type="button" title="Share" onclick="shareListing('${escapeHtml(x.id)}')"><i class="fa-solid fa-share-nodes"></i></button></div></div>
        <div class="listingBody">
          <h3 class="listingTitle">${escapeHtml(x.title)}</h3>
          <div class="meta"><span><i class="fa-regular fa-clock"></i> ${escapeHtml(x.nextDepartLabel || x.time || 'Flexible')}</span><span><i class="fa-solid fa-layer-group"></i> ${escapeHtml(x.unitsLabel || 'Live availability')}</span><span><i class="fa-solid fa-building"></i> ${escapeHtml(x.partner)}</span></div>
          <p class="desc">${escapeHtml(x.sub || '')}. ${escapeHtml(x.policy || '')}. ${escapeHtml(x.bookableReason || 'Catalog availability is synced from backend inventory.')}</p>
          <div class="priceRow"><div><div class="price">${money(x.price,x.currency)}</div><div class="small">${escapeHtml(x.bookableReason || (x.bookable ? 'Starting price' : 'Read-only preview'))}</div></div><div class="actions"><button class="btn btnGhost" onclick="goListing('${escapeHtml(x.id)}', event)"><i class="fa-regular fa-eye"></i> View</button>${x.bookable ? `<button class="btn btnPrimary" onclick="goBook('${escapeHtml(x.id)}', event)"><i class="fa-solid fa-ticket"></i> Book</button>` : `<button class="btn btnGhost" onclick="goListing('${escapeHtml(x.id)}', event)"><i class="fa-regular fa-clock"></i> Soon</button>`}</div></div>
        </div>
      </article>`;
    }

    function goListing(id, ev){
      ev?.stopPropagation();
      const item = listings.find(x=>x.id===id);
      if(!item) return toast('Listing not found.');
      window.location.href = item.url || `/listings/${item.serviceType}/${item.slug}`;
    }

    function goBook(id, ev){
      ev?.stopPropagation();
      const item = listings.find(x=>x.id===id);
      if(!item) return toast('Listing not found.');
      window.location.href = item.url || `/listings/${item.serviceType}/${item.slug}`;
    }

    const groupConfig = {
      bus:{container:'cards', section:'bus', label:'buses'},
      hotel:{container:'hotelCards', section:'hotel', label:'hotels'},
      flight:{container:'flightCards', section:'flight', label:'flights'},
      train:{container:'trainCards', section:'train', label:'trains'},
      more:{container:'moreCards', section:'more', label:'more services'}
    };
    const initialCardLimit = () => window.matchMedia('(max-width: 680px)').matches ? 3 : 6;
    const visibleCounts = {bus:initialCardLimit(), hotel:initialCardLimit(), flight:initialCardLimit(), train:initialCardLimit(), more:initialCardLimit()};

    function renderGroup(group){
      const cfg = groupConfig[group];
      const data = listings.filter(x=>x.group===group);
      const shown = data.slice(0, visibleCounts[group]);
      $('#' + cfg.container).innerHTML = shown.map(cardHTML).join('');
      const btn = $('#more-' + group);
      if(btn){
        const left = data.length - shown.length;
        btn.classList.toggle('hide', left <= 0);
        const next = window.matchMedia('(max-width: 680px)').matches ? 3 : 6;
        btn.innerHTML = `<i class="fa-solid fa-plus"></i> More ${Math.min(next, Math.max(left,0))}`;
      }
    }
    function render(){ Object.keys(groupConfig).forEach(renderGroup); applyHighlights(); }
    function showMore(group){
      const cfg = groupConfig[group];
      const data = listings.filter(x=>x.group===group);
      const oldCount = visibleCounts[group];
      const next = window.matchMedia('(max-width: 680px)').matches ? 3 : 6;
      visibleCounts[group] = Math.min(oldCount + next, data.length);
      renderGroup(group);
      applyHighlights();
      const container = document.getElementById(cfg.container);
      if(container){
        Array.from(container.children).slice(oldCount).forEach((card, i)=>{
          card.classList.add('revealIn');
          card.style.animationDelay = `${Math.min(i * 45, 220)}ms`;
        });
      }
      const firstNew = data[oldCount];
      if(firstNew){
        setTimeout(()=>scrollToCardId(firstNew.id), 80);
      }
      toast(`More ${cfg.label} opened.`);
    }

    let activeGroup = 'all', activeCorridor = 'all';
    function applyHighlights(){
      $$('.listing').forEach(c=>{
        c.classList.remove('hide');
        const routeOk = activeCorridor !== 'all' && (c.dataset.corridor === activeCorridor || equivalentCorridor(c.dataset.corridor) === activeCorridor);
        c.classList.toggle('routeMatch', routeOk);
      });
    }
    function equivalentCorridor(code){
      const map = {'ke-ug':'ug-ke'};
      return map[code] || code;
    }
    function navOffset(){
      const nav = document.querySelector('.nav');
      return nav ? Math.ceil(nav.getBoundingClientRect().height + 10) : 10;
    }
    function scrollWithGap(el){
      if(!el) return;
      const top = el.getBoundingClientRect().top + window.pageYOffset - navOffset();
      window.scrollTo({top: Math.max(top, 0), behavior:'smooth'});
    }
    function scrollToSectionId(id){
      scrollWithGap(document.getElementById(id));
      setActiveNavById(id);
    }
    function scrollToCardId(id){
      scrollWithGap(document.querySelector(`[data-id="${id}"]`));
    }
    function filterCards(group, btn){
      activeGroup = group;
      $$('#categoryFilters button, #drawerCategoryFilters button').forEach(b=>b.classList.remove('active'));
      btn?.classList.add('active');
      applyHighlights();
      const target = group === 'all' ? 'bus' : (groupConfig[group]?.section || 'bus');
      scrollToSectionId(target);
      toast(group==='all'?'Moved to all listings':'Moved to '+groupConfig[group].label);
      if(btn?.closest('.drawerPanel')) $('#drawer')?.classList.remove('open');
    }
    function filterRoute(corridor, btn){
      activeCorridor = corridor;
      $$('#routeFilters button, #drawerRouteFilters button').forEach(b=>b.classList.remove('active'));
      btn?.classList.add('active');
      applyHighlights();
      if(corridor === 'all'){
        scrollToSectionId('bus');
        toast('Showing all East Africa routes.');
        if(btn?.closest('.drawerPanel')) $('#drawer')?.classList.remove('open');
        return;
      }
      const first = listings.find(x=>x.corridor===corridor || equivalentCorridor(x.corridor)===corridor);
      if(first){
        visibleCounts[first.group] = Math.max(visibleCounts[first.group], listings.filter(x=>x.group===first.group).findIndex(x=>x.id===first.id)+1);
        renderGroup(first.group); applyHighlights();
        scrollToSectionId(groupConfig[first.group].section);
        setTimeout(()=>scrollToCardId(first.id), 250);
        toast('Route highlighted without hiding other listings.');
        if(btn?.closest('.drawerPanel')) $('#drawer')?.classList.remove('open');
      } else {
        scrollToSectionId('bus');
        toast('Route selected. Add listings for this corridor later.');
        if(btn?.closest('.drawerPanel')) $('#drawer')?.classList.remove('open');
      }
    }

    function runSearch(){
      const type = $('.tab.active', $('#searchTabs')).dataset.type;
      const params = new URLSearchParams();
      params.set('serviceType', type);
      const date = $('#dateInput')?.value;
      if(date) params.set('date', date);
      if(type === 'hotel'){
        const city = $('#cityInput')?.value.trim();
        if(city) params.set('city', city);
      } else {
        const origin = $('#fromInput')?.value.trim();
        const destination = $('#toInput')?.value.trim();
        if(origin) params.set('origin', origin);
        if(destination) params.set('destination', destination);
      }
      window.location.href = `/search?${params.toString()}`;
    }

    function openListing(id, bookNow=false){
      current = listings.find(x=>x.id===id); selected=[]; held=[]; holdId=''; addonTotal=0; seconds=600;
      $('#modalType').innerHTML = `<i class="fa-solid ${icons[current.type]||'fa-ticket'}"></i> ${current.type}`;
      $('#modalTitle').textContent=current.title; $('#modalSub').textContent=`${current.partner} • ${current.from} → ${current.to} • ${current.time}`;
      $('#modalImg').src=current.img; $('#modalHeroTitle').textContent=current.title; $('#modalHeroSub').textContent=current.sub;
      $('#layoutTitle').textContent = current.group==='hotel' ? 'Choose room / house unit' : current.group==='flight' ? 'Choose flight seat' : current.group==='train' ? 'Choose coach seat' : current.group==='more' ? 'Choose available slot' : 'Choose bus seat';
      $('#layoutHint').textContent = current.group==='hotel' ? 'Partner can upload floor plan and mark room status.' : 'Partner can choose 2+2, 2+1, VIP, sleeper or custom layout.';
      $('#addons').innerHTML = addonOptions(current.group).map(a=>`<label class="addon"><span><input type="checkbox" value="${a.price}" onchange="calc()"> ${a.name}</span><b>${money(a.price,current.currency)}</b></label>`).join('');
      renderLayout();
      updateSummary();
      $('#checkoutStep').classList.remove('active');
      $('.sheetBody').style.display='grid';
      $('#viewModal').classList.add('open'); document.body.style.overflow='hidden';
      startTimer();
      if(bookNow) toast('Select an available option, then proceed booking.');
    }

    function closeModal(){ $('#viewModal').classList.remove('open'); document.body.style.overflow=''; clearInterval(timerId); }
    $('#viewModal').addEventListener('click', e=>{ if(e.target.id==='viewModal') closeModal(); });

    function addonOptions(g){
      if(g==='flight') return [{name:'Extra baggage 20kg',price:90000},{name:'Preferred meal',price:35000},{name:'Priority boarding',price:45000}];
      if(g==='hotel') return [{name:'Breakfast',price:25000},{name:'Airport pickup',price:70000},{name:'Late checkout',price:50000}];
      if(g==='bus'||g==='train') return [{name:'Extra luggage',price:10000},{name:'Travel insurance',price:5000},{name:'Snack pack',price:8000}];
      return [{name:'Insurance',price:15000},{name:'Guide support',price:30000},{name:'Priority service',price:20000}];
    }

    function cell(code, cls='seat', label=code){
      const taken = current.taken.includes(code);
      const isSel = selected.includes(code);
      const isHeld = held.includes(code);
      const safeCode = String(code).replace(/'/g, '&#39;');
      return `<button class="${cls} ${taken?'taken':''} ${isSel?'selected':''} ${isHeld?'holding':''}" ${taken?'disabled':''} onclick="togglePick('${safeCode}')"><span>Seat No</span><b>${label}</b></button>`;
    }

    function renderLayout(){
      let h = '';
      if(current.layout==='bus-2-2'){
        h += '<div class="vehicleFront">DRIVER • FRONT</div>';
        for(let row=0; row<8; row++){ const start = row * 4 + 1; h += `<div class="seatRow">${cell(String(start),'seat',start)}${cell(String(start+1),'seat',start+1)}<span class="aisle"></span>${cell(String(start+2),'seat',start+2)}${cell(String(start+3),'seat',start+3)}</div>`; }
      } else if(current.layout==='bus-2-1'){
        h += '<div class="vehicleFront">VIP FRONT</div>';
        for(let row=0; row<7; row++){ const start = row * 3 + 1; h += `<div class="seatRow">${cell(String(start),'seat',start)}${cell(String(start+1),'seat',start+1)}<span class="aisle"></span><span></span>${cell(String(start+2),'seat',start+2)}</div>`; }
      } else if(current.layout==='bus-sleeper'){
        h += '<div class="vehicleFront">SLEEPER COACH</div>';
        for(let row=0; row<6; row++){ const start = row * 4 + 1; h += `<div class="seatRow">${cell(String(start),'seat',start)}${cell(String(start+1),'seat',start+1)}<span class="aisle"></span>${cell(String(start+2),'seat',start+2)}${cell(String(start+3),'seat',start+3)}</div>`; }
      } else if(current.layout==='hotel-rooms'){
        h += '<div class="vehicleFront">FLOOR PLAN • TAP ROOM</div><div class="roomGrid">';
        ['101','102','103','104','201','202','203','204','301','302','303','304'].forEach(r=>h += roomCell(r));
        h += '</div>';
      } else if(current.layout==='hotel-house'){
        h += '<div class="vehicleFront">VILLA / HOUSE UNITS</div><div class="roomGrid">';
        ['Villa 1','Villa 2','R1','R2','R3','R4','R5','R6'].forEach(r=>h += roomCell(r));
        h += '</div>';
      } else if(current.layout==='flight'){
        h += '<div class="vehicleFront">COCKPIT • FRONT</div><div class="flightGrid">';
        for(let i=1;i<=8;i++){h += `<div class="flightRow">${cell(i+'A')}${cell(i+'B')}${cell(i+'C')}<span></span>${cell(i+'D')}${cell(i+'E')}${cell(i+'F')}</div>`}
        h += '</div>';
      } else if(current.layout==='train'){
        h += '<div class="vehicleFront">COACH A</div><div class="trainGrid">';
        ['A','B','C','D','E','F'].forEach(r=>[1,2,3,4].forEach(n=>h += cell(r+n,'slot')));
        h += '</div>';
      } else {
        h += '<div class="vehicleFront">AVAILABLE SLOTS</div><div class="trainGrid">';
        ['S1','S2','S3','S4','S5','S6','S7','S8','SUV 1','SUV 2','SUV 3','SUV 5'].forEach(s=>h += cell(s,'slot'));
        h += '</div>';
      }
      $('#layoutBox').innerHTML = h;
    }

    function roomCell(code){
      const taken = current.taken.includes(code), isSel=selected.includes(code), isHeld=held.includes(code);
      return `<button class="room ${taken?'taken':''} ${isSel?'selected':''} ${isHeld?'holding':''}" ${taken?'disabled':''} onclick="togglePick('${code}')"><span>${code}</span><small>${taken?'Booked':'Available'}</small></button>`;
    }

    function togglePick(code){
      if(selected.includes(code)) selected = selected.filter(x=>x!==code);
      else {
        if((current.bookable || current.group==='more') && selected.length >= 1) selected = [code];
        else selected.push(code);
      }
      renderLayout(); updateSummary();
    }

    function calc(){
      addonTotal = $$('#addons input:checked').reduce((s,i)=>s+Number(i.value),0);
      updateSummary();
    }

    function updateSummary(){
      const qty = Math.max(selected.length, 0);
      const base = qty * current.price;
      const fee = qty ? Math.round(base * 0.045 + 3500) : 0;
      const total = base + fee + addonTotal;
      $('#selectedOut').textContent = selected.length ? selected.join(', ') : 'None';
      $('#baseOut').textContent = money(base,current.currency);
      $('#feeOut').textContent = money(fee,current.currency);
      $('#totalOut').textContent = money(total,current.currency);
    }

    async function holdSelection(){
      if(!selected.length) return toast('Choose at least one available option first.');
      if(!current.bookable) return toast('Booking is not open for this service yet.');
      try {
        const response = await fetch(`/api/listings/${current.id}/hold`, {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({ selected:selected[0] })
        });
        const data = await response.json();
        if(!response.ok) throw new Error(data.error || 'Hold failed');
        holdId = data.hold.id;
        held = [...new Set([...held, ...selected])];
        selected = [];
        seconds = 600;
        renderLayout(); updateSummary(); startTimer();
        toast('Selected option held for 10 minutes.');
      } catch (error) {
        toast(error.message || 'Unable to hold selection.');
      }
    }

    function resetSelection(){ selected=[]; held=[]; holdId=''; addonTotal=0; $$('#addons input').forEach(i=>i.checked=false); renderLayout(); updateSummary(); seconds=600; updateTimer(); toast('Selection reset.'); }

    function startTimer(){ clearInterval(timerId); updateTimer(); timerId=setInterval(()=>{seconds--; updateTimer(); if(seconds<=0){clearInterval(timerId); held=[]; selected=[]; renderLayout(); updateSummary(); toast('Hold expired. Please select again.'); seconds=600;}},1000); }
    function updateTimer(){const m=String(Math.floor(seconds/60)).padStart(2,'0'), s=String(seconds%60).padStart(2,'0'); $('#timer').textContent=`${m}:${s}`;}

    function getChoice(){ return selected.length ? selected : held; }
    function getTotals(choice=getChoice()){
      const qty = Math.max(choice.length,1);
      const base = qty * current.price;
      const fee = Math.round(base * 0.045 + 3500);
      return {base, fee, total:base + fee + addonTotal};
    }
    function goPaymentPage(){
      const choice = getChoice();
      if(!choice.length) return toast('Select or hold a seat/room/slot first.');
      if(!current.bookable) return toast('Booking is not open for this service yet.');
      const totals = getTotals(choice);
      $('#checkoutListing').textContent = current.title;
      $('#checkoutSelected').textContent = choice.join(', ');
      $('#checkoutTotal').textContent = money(totals.total,current.currency);
      $('.sheetBody').style.display='none';
      $('#checkoutStep').classList.add('active');
      toast('Payment page opened. Fill user info and payment details.');
    }
    function backToSelection(){
      $('#checkoutStep').classList.remove('active');
      $('.sheetBody').style.display='grid';
    }
    async function confirmBooking(){
      const choice = getChoice();
      if(!choice.length) return toast('Select or hold a seat/room/slot first.');
      const name = $('#nameInput').value.trim();
      const phone = $('#phoneInput').value.trim();
      const email = $('#emailInput').value.trim();
      if(!name || !phone || !email) return toast('Enter customer name, phone number, and email.');
      const method = document.querySelector('input[name="payMethod"]:checked')?.value || 'Mobile Money';
      const total = getTotals(choice).total;
      try {
        const response = await fetch('/api/bookings', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({ listingId:current.id, fullName:name, passengerName:name, phone, email, selected:choice[0], holdId, total, notes:`Homepage quick checkout via ${method}` })
        });
        const data = await response.json();
        if(!response.ok) throw new Error(data.error || 'Booking failed');
        const booking = {
          code:data.booking.bookingRef,
          title:current.title,
          type:current.type,
          selected:choice.join(', '),
          total:money(data.booking.pricing.total,data.booking.pricing.currency),
          customer:name,
          date:'Just confirmed',
          channel:'Backend ticket',
          status:data.booking.bookingStatus,
          ticketUrl:data.ticketUrl
        };
        myBookings.unshift(booking); saveBookings(); renderBookings();
        toast(`Ticket saved in My bookings: ${booking.code}`);
        $('#modalHeroTitle').textContent = 'Payment page completed';
        $('#modalHeroSub').textContent = `Customer: ${name} - Payment: ${method} - Ticket available in My bookings.`;
        held = [...new Set([...held, ...choice])]; selected=[]; backToSelection(); renderLayout(); updateSummary(); closeModal(); window.location.href = data.ticketUrl;
      } catch (error) {
        toast(error.message || 'Booking failed. Please try again.');
      }
    }


    function setupDrawerFilters(){
      const holder = $('#drawerFilters');
      if(!holder) return;
      const cat = $('#categoryFilters')?.cloneNode(true);
      const routes = $('#routeFilters')?.cloneNode(true);
      if(cat){ cat.id = 'drawerCategoryFilters'; }
      if(routes){ routes.id = 'drawerRouteFilters'; }
      holder.innerHTML = '<div><div class="drawerFilterTitle">Categories</div><div class="drawerFilterHint">Choose what to browse.</div></div>';
      if(cat) holder.appendChild(cat);
      const routeWrap = document.createElement('div');
      routeWrap.innerHTML = '<div class="drawerFilterTitle">Country routes</div><div class="drawerFilterHint">Country-to-country first, then local routes.</div>';
      if(routes) routeWrap.appendChild(routes);
      holder.appendChild(routeWrap);
    }
    setupDrawerFilters();

    $('#themeBtn').addEventListener('click',()=>{
      const next=document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark';
      document.documentElement.setAttribute('data-theme',next); localStorage.setItem('ct_theme',next);
      $('#themeIcon').className=next==='dark'?'fa-solid fa-moon':'fa-solid fa-sun';
    });
    const saved = localStorage.getItem('ct_theme'); if(saved){document.documentElement.setAttribute('data-theme',saved); $('#themeIcon').className=saved==='dark'?'fa-solid fa-moon':'fa-solid fa-sun'}
    $('#menuBtn')?.addEventListener('click',()=>$('#drawer').classList.add('open'));
    $('#bottomNav')?.addEventListener('click',e=>{
      const b=e.target.closest('button'); if(!b) return;
      if(b.dataset.action==='menu'){ $('#drawer').classList.add('open'); return; }
      scrollToSectionId(b.dataset.target || 'home');
      $$('#bottomNav button').forEach(x=>x.classList.remove('active')); b.classList.add('active');
    });
    document.addEventListener('click', e=>{
      const card = e.target.closest('.listing');
      if(!card || e.target.closest('button,a,input,select,textarea,label')) return;
      goListing(card.dataset.id, e);
    });
    document.addEventListener('keydown', e=>{
      if((e.key !== 'Enter' && e.key !== ' ') || !e.target.classList?.contains('listing')) return;
      e.preventDefault(); goListing(e.target.dataset.id, e);
    });
    $('#closeDrawer')?.addEventListener('click',()=>$('#drawer').classList.remove('open'));
    $('#drawer').addEventListener('click',e=>{if(e.target.id==='drawer')$('#drawer').classList.remove('open')});
    $('#blogModal')?.addEventListener('click',e=>{if(e.target.id==='blogModal')closeBlog()});
    $$('#drawer a').forEach(a=>a.addEventListener('click',()=>$('#drawer').classList.remove('open')));

    $('#searchTabs').addEventListener('click',e=>{
      const b=e.target.closest('.tab'); if(!b)return;
      $$('.tab',$('#searchTabs')).forEach(x=>x.classList.remove('active')); b.classList.add('active');
      const isHotel=b.dataset.type==='hotel'; $('#cityField').classList.toggle('hide',!isHotel); $('#fromField').classList.toggle('hide',isHotel); $('#toField').classList.toggle('hide',isHotel);
    });


    function setActiveNavById(id){
      $$('#navLinks a, .drawerLinks a').forEach(a=>{
        const target = (a.getAttribute('href')||'').replace('#','');
        a.classList.toggle('active', target === id);
      });
      $$('#bottomNav button[data-target]').forEach(b=>b.classList.toggle('active', b.dataset.target === id || (id==='bus' && b.dataset.target==='bus')));
    }
    $$('#navLinks a, .drawerLinks a').forEach(a=>{
      a.addEventListener('click',(e)=>{
        e.preventDefault();
        const id=(a.getAttribute('href')||'#home').replace('#','');
        scrollToSectionId(id);
        $('#drawer')?.classList.remove('open');
      });
    });
    const navSections=['home','bus','hotel','flight','train','more','ads','blogs','saved','my-bookings'].map(id=>document.getElementById(id)).filter(Boolean);
    window.addEventListener('scroll',()=>{
      let currentId='home';
      navSections.forEach(sec=>{
        if(sec.getBoundingClientRect().top <= navOffset() + 10) currentId=sec.id;
      });
      setActiveNavById(currentId);
    }, {passive:true});

    renderMarketplaceSurface();
    render();
    renderSaved();
    renderBookings();
  
