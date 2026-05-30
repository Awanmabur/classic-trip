window.ClassicTrip = window.ClassicTrip || {};
window.ClassicTrip.toast = function(message){ const el=document.querySelector('#toast'); if(!el) return; el.textContent=message; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),2200); };
