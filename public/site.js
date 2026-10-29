/* Shared behaviour for every page: year, clock, theme, toasts,
   copy-to-clipboard links, and the genie transition between pages. */
(function(){
  var ivx = window.ivx = window.ivx || {};
  var root = document.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  ivx.reduceMotion = reduceMotion;

  var yearEl = document.getElementById('year');
  if(yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---------------- Clock (always Bucaramanga time) ---------------- */
  var clockEl = document.getElementById('clock');
  if(clockEl){
    var clockFmt;
    try{
      clockFmt = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Bogota', weekday: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true
      });
    }catch(e){ clockFmt = null; }
    var updateClock = function(){
      if(!clockFmt){ clockEl.textContent = ''; return; }
      var p = {};
      clockFmt.formatToParts(new Date()).forEach(function(part){ p[part.type] = part.value; });
      clockEl.textContent = p.weekday + ' ' + p.day + ' ' + p.hour + ':' + p.minute + ' ' + p.dayPeriod;
    };
    clockEl.setAttribute('title', 'Local time in Bucaramanga');
    updateClock();
    setInterval(updateClock, 15000);
  }

  /* ---------------- Theme ---------------- */
  var systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  ivx.currentTheme = function(){
    return root.dataset.theme || (systemDark.matches ? 'dark' : 'light');
  };
  // mode: 'light', 'dark', or 'auto' (follow the system)
  ivx.setTheme = function(mode){
    try{
      if(mode === 'auto'){ localStorage.removeItem('theme'); }
      else { localStorage.setItem('theme', mode); }
    }catch(e){}
    if(mode === 'auto'){ delete root.dataset.theme; }
    else { root.dataset.theme = mode; }
  };
  ivx.themeMode = function(){ return root.dataset.theme || 'auto'; };
  ivx.toggleTheme = function(){
    var next = ivx.currentTheme() === 'dark' ? 'light' : 'dark';
    // Picking the same theme as the system means "follow the system" again.
    ivx.setTheme(next === (systemDark.matches ? 'dark' : 'light') ? 'auto' : next);
    return next;
  };

  /* ---------------- Liquid Glass tint (0 = clear, 1 = tinted) ---------------- */
  ivx.glassTint = function(){
    var v = parseFloat(getComputedStyle(root).getPropertyValue('--glass-tint'));
    return isNaN(v) ? 0.4 : v;
  };
  ivx.setGlassTint = function(v){
    v = Math.max(0, Math.min(1, v));
    root.style.setProperty('--glass-tint', v);
    try{ localStorage.setItem('glassTint', String(v)); }catch(e){}
  };

  /* ---------------- Specular highlight follows the pointer ---------------- */
  if(!reduceMotion && window.matchMedia('(hover: hover) and (pointer: fine)').matches){
    var lastGlass = null, pending = null, queued = false;
    document.addEventListener('pointermove', function(e){
      pending = e;
      if(queued) return;
      queued = true;
      requestAnimationFrame(function(){
        queued = false;
        var ev = pending;
        var el = ev.target.closest && ev.target.closest('.glass');
        if(lastGlass && lastGlass !== el){
          lastGlass.style.removeProperty('--mx');
          lastGlass.style.removeProperty('--my');
        }
        lastGlass = el;
        if(!el) return;
        var r = el.getBoundingClientRect();
        el.style.setProperty('--mx', ((ev.clientX - r.left) / r.width * 100).toFixed(1) + '%');
        el.style.setProperty('--my', ((ev.clientY - r.top) / r.height * 100).toFixed(1) + '%');
      });
    }, { passive: true });
  }

  /* ---------------- Menu bar frosts over once content scrolls under it ---------------- */
  // (also solid while a window is zoomed to full screen underneath it)
  var menubar = document.querySelector('.menubar');
  ivx.syncMenubar = function(){
    if(menubar) menubar.classList.toggle('scrolled', window.scrollY > 4 || root.classList.contains('has-zoomed-window'));
  };
  window.addEventListener('scroll', ivx.syncMenubar, { passive: true });
  ivx.syncMenubar();

  /* ---------------- Toast ---------------- */
  var toastEl, toastTimer;
  ivx.toast = function(msg){
    if(!toastEl){
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    // force reflow so repeated toasts re-animate
    void toastEl.offsetWidth;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ toastEl.classList.remove('show'); }, 2600);
  };

  ivx.copy = function(text, okMsg, failMsg){
    function fallback(){ ivx.toast(failMsg || text); }
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(function(){ ivx.toast(okMsg); }, fallback);
    } else {
      fallback();
    }
  };

  // Elements like the Discord buttons copy a value instead of navigating.
  document.addEventListener('click', function(e){
    var el = e.target.closest && e.target.closest('[data-copy]');
    if(!el) return;
    e.preventDefault();
    var value = el.getAttribute('data-copy');
    var what = el.getAttribute('data-copy-label') || 'Text';
    ivx.copy(value, what + ' copied: ' + value, what + ': ' + value);
  });

  /* ---------------- Dock stack (phones) ---------------- */
  // Dock items marked data-overflow fold into a "More" folder on phones;
  // the CSS only hides them once this has built the stack.
  var dockEl = document.querySelector('.dock');
  var overflow = dockEl ? Array.prototype.slice.call(dockEl.querySelectorAll('[data-overflow]')) : [];
  if(overflow.length){
    var stackBtn = document.createElement('button');
    stackBtn.type = 'button';
    stackBtn.className = 'dock-item dock-stack';
    stackBtn.setAttribute('aria-label', 'More apps');
    stackBtn.setAttribute('aria-expanded', 'false');
    stackBtn.setAttribute('aria-controls', 'dockStack');

    var panel = document.createElement('div');
    panel.id = 'dockStack';
    panel.className = 'dock-stack-panel glass strong';
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', 'More apps');
    panel.hidden = true;

    overflow.forEach(function(src){
      var tileClass = src.className.replace(/\bdock-item\b/, '').trim();
      // the folder tile previews up to four of the apps inside
      if(stackBtn.children.length < 4){
        var dot = document.createElement('span');
        dot.className = tileClass.replace(/\btile\b/, '').trim();
        stackBtn.appendChild(dot);
      }
      var item = document.createElement(src.tagName === 'A' ? 'a' : 'button');
      ['href', 'target', 'rel', 'data-copy', 'data-copy-label', 'aria-label'].forEach(function(attr){
        if(src.hasAttribute(attr)) item.setAttribute(attr, src.getAttribute(attr));
      });
      if(item.tagName === 'BUTTON') item.type = 'button';
      item.className = 'dock-stack-item';
      var tile = document.createElement('span');
      tile.className = tileClass;
      tile.setAttribute('aria-hidden', 'true');
      tile.appendChild(src.querySelector('svg').cloneNode(true));
      var label = document.createElement('span');
      label.textContent = (src.getAttribute('data-label') || '').split(' · ')[0];
      item.appendChild(tile);
      item.appendChild(label);
      panel.appendChild(item);
    });

    overflow[overflow.length - 1].insertAdjacentElement('afterend', stackBtn);
    dockEl.parentNode.appendChild(panel);
    dockEl.classList.add('has-stack');

    var setStack = function(open){
      panel.hidden = !open;
      stackBtn.setAttribute('aria-expanded', String(open));
      if(open){
        var w = dockEl.parentNode.getBoundingClientRect();
        var b = stackBtn.getBoundingClientRect();
        var half = panel.offsetWidth / 2 + 8;
        var x = Math.max(half, Math.min(w.width - half, b.left + b.width / 2 - w.left));
        panel.style.setProperty('--stack-x', x + 'px');
      }
    };
    stackBtn.addEventListener('click', function(){
      var open = panel.hidden;
      setStack(open);
      if(open) panel.querySelector('.dock-stack-item').focus({ preventScroll: true });
    });
    // picking an app, tapping elsewhere, or Esc folds the stack back up
    panel.addEventListener('click', function(e){
      if(e.target.closest('.dock-stack-item')) setStack(false);
    });
    document.addEventListener('click', function(e){
      if(!panel.hidden && !panel.contains(e.target) && !stackBtn.contains(e.target)) setStack(false);
    });
    document.addEventListener('keydown', function(e){
      if(e.key === 'Escape' && !panel.hidden){ setStack(false); stackBtn.focus(); }
    });
  }

  /* ---------------- Genie transition to/from the Dock ---------------- */
  var pieceSelector = document.body.getAttribute('data-genie') || 'main .window, .hero';
  function pieces(){ return Array.prototype.slice.call(document.querySelectorAll(pieceSelector)); }
  function center(el){
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  // Generic genie: shrink elements into a target (e.g. a Dock icon), or grow
  // them back out of it. Also used by desktop.js to minimize windows.
  function genieCollapse(els, targetEl, onDone){
    var t = center(targetEl);
    els.forEach(function(el){
      var c = center(el);
      el.style.transition = 'transform 0.38s cubic-bezier(0.4,0,0.65,1), opacity 0.32s ease';
      el.style.transform = 'translate(' + (t.x - c.x) + 'px,' + (t.y - c.y) + 'px) scale(0.04)';
      el.style.opacity = '0';
    });
    setTimeout(onDone, reduceMotion ? 0 : 380);
  }

  function genieExpand(els, fromEl, onDone){
    var o = center(fromEl);
    els.forEach(function(el){
      var c = center(el);
      el.style.transition = 'none';
      el.style.transform = 'translate(' + (o.x - c.x) + 'px,' + (o.y - c.y) + 'px) scale(0.04)';
      el.style.opacity = '0';
    });
    requestAnimationFrame(function(){
      requestAnimationFrame(function(){
        els.forEach(function(el){
          el.style.transition = 'transform 0.42s cubic-bezier(0.16,1,0.3,1), opacity 0.32s ease';
          el.style.transform = '';
          el.style.opacity = '';
        });
        // hand transitions back to the stylesheet once the animation is done
        setTimeout(function(){
          resetStyles(els);
          if(onDone) onDone();
        }, 460);
      });
    });
  }

  function resetStyles(els){
    els.forEach(function(el){
      el.style.transition = el.style.transform = el.style.opacity = '';
    });
  }
  function resetPieces(){ resetStyles(pieces()); }

  ivx.genie = { collapse: genieCollapse, expand: genieExpand, reset: resetStyles };

  document.querySelectorAll('.dock-item[data-genie]').forEach(function(icon){
    icon.addEventListener('click', function(e){
      if(reduceMotion || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      genieCollapse(pieces(), icon, function(){
        try{ sessionStorage.setItem('ivxNav', location.pathname); }catch(err){}
        window.location.href = icon.getAttribute('href');
      });
    });
  });

  // Arriving from another page via the Dock: grow in from the icon that
  // points back where we came from. Runs after page scripts have laid out.
  var cameFrom = null;
  try{
    cameFrom = sessionStorage.getItem('ivxNav');
    sessionStorage.removeItem('ivxNav');
  }catch(e){}
  if(cameFrom && !reduceMotion){
    document.addEventListener('DOMContentLoaded', function(){
      var icon = Array.prototype.slice.call(document.querySelectorAll('.dock-item[data-genie]'))
        .filter(function(a){ return a.pathname === cameFrom || a.pathname === cameFrom.replace(/\.html$/, ''); })[0];
      if(!icon) return;
      requestAnimationFrame(function(){
        requestAnimationFrame(function(){ genieExpand(pieces(), icon); });
      });
    });
  }

  // Coming back via the browser's back button restores the page from cache,
  // still collapsed into the Dock — put everything back.
  window.addEventListener('pageshow', function(e){
    if(e.persisted) resetPieces();
  });
})();
