(function(){
  function qs(sel, root){ return (root || document).querySelector(sel); }
  function qsa(sel, root){ return Array.from((root || document).querySelectorAll(sel)); }
  function ready(fn){ if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  ready(function(){
    qsa('.dashboardRoleSwitcher').forEach(function(select){
      select.addEventListener('change', function(){ if(select.value) window.location.href = select.value; });
    });
    qsa('.dashboardCompanySelector').forEach(function(select){
      select.addEventListener('change', function(){
        var url = new URL(window.location.href);
        url.searchParams.set('companyId', select.value);
        window.location.href = url.toString();
      });
    });
    var menuSearch = qs('.dashboardMenuSearch');
    if(menuSearch){
      menuSearch.addEventListener('input', function(){
        var q = menuSearch.value.trim().toLowerCase();
        qsa('.dashboardMenu .navBtn').forEach(function(btn){
          var text = (btn.getAttribute('data-label') || btn.textContent || '').toLowerCase();
          btn.hidden = q && !text.includes(q);
          var group = btn.closest('.navGroup');
          if(group && q && !btn.hidden) group.open = true;
        });
      });
    }
    var globalSearch = qs('#dashboardGlobalSearch');
    if(globalSearch){
      globalSearch.addEventListener('input', function(){
        var q = globalSearch.value.trim().toLowerCase();
        qsa('.section').forEach(function(section){
          section.dataset.searchMatch = !q || section.textContent.toLowerCase().includes(q) ? 'true' : 'false';
        });
      });
    }
  });
}());
