/* The "desktop" shared by every page: working window controls (close,
   minimize to the Dock, zoom) and a menu bar whose menus really do things.
   Loaded after site.js; the home page adds Spotlight, Mission Control and
   Notification Center hooks through ivx.home (see index.js). */
(function(){
  var ivx = window.ivx;
  var root = document.documentElement;
  var body = document.body;
  var reduceMotion = ivx.reduceMotion;
  var isHome = !!document.getElementById('resume');
  var dock = document.querySelector('.dock');

  function slice(list){ return Array.prototype.slice.call(list); }
  function desktopMode(){ return body.classList.contains('desktop-mode'); }

  /* =====================================================================
     WINDOW MANAGER
     Each window is 'open', 'minimized' (a tile in the Dock) or 'closed'.
     ===================================================================== */
  var wins = slice(document.querySelectorAll('main .window'));
  var zCounter = 10;

  function titleOf(win){
    var t = win.querySelector('.window-title');
    return t ? t.textContent.trim() : 'Window';
  }
  function stateOf(win){ return win._state || 'open'; }
  function isOpen(win){ return stateOf(win) === 'open'; }
  function byId(id){ return wins.filter(function(w){ return w.id === id; })[0] || null; }

  function bringToFront(win){
    zCounter++;
    win.style.zIndex = zCounter;
  }

  function setActive(win){
    wins.forEach(function(w){ w.classList.toggle('window-active', w === win); });
  }

  // The window menu commands act on: the highlighted window, else the open
  // window nearest the middle of the screen.
  function activeWindow(){
    var active = wins.filter(function(w){ return isOpen(w) && w.classList.contains('window-active'); })[0];
    if(active) return active;
    var best = null, bestDistance = Infinity, mid = window.innerHeight / 2;
    wins.forEach(function(w){
      if(!isOpen(w)) return;
      var r = w.getBoundingClientRect();
      if(r.bottom < 0 || r.top > window.innerHeight) return;
      var d = Math.abs((r.top + r.bottom) / 2 - mid);
      if(d < bestDistance){ best = w; bestDistance = d; }
    });
    return best;
  }

  function topmostOpen(except){
    return wins.filter(function(w){ return w !== except && isOpen(w); })
      .sort(function(a, b){ return (+b.style.zIndex || 0) - (+a.style.zIndex || 0); })[0] || null;
  }

  function focusWin(win, opts){
    if(desktopMode()) bringToFront(win);
    else if(!(opts && opts.noScroll) && !win.classList.contains('is-zoomed')){
      win.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    }
    setActive(win);
  }

  // Play a one-off CSS animation class, then call done.
  function playAnim(win, cls, done){
    if(reduceMotion){ if(done) done(); return; }
    var finished = false;
    function finish(){
      if(finished) return;
      finished = true;
      win.classList.remove(cls);
      if(done) done();
    }
    win.classList.add(cls);
    win.addEventListener('animationend', finish, { once: true });
    setTimeout(finish, 400);
  }

  // After a window disappears, hand focus and the highlight to the next one.
  function afterHide(win){
    var next = topmostOpen(win);
    var hadFocus = win.contains(document.activeElement);
    if(next){
      setActive(next);
      if(hadFocus){
        var btn = next.querySelector('.traffic button');
        if(btn) btn.focus({ preventScroll: true });
      }
    } else {
      setActive(null);
      if(hadFocus) document.activeElement.blur();
    }
  }

  function closeWin(win){
    if(!isOpen(win)) return;
    if(win.dataset.closeHref){ window.location.href = win.dataset.closeHref; return; }
    unzoom(win, true);
    win._state = 'closed';
    playAnim(win, 'win-closing', function(){
      win.hidden = true;
      afterHide(win);
    });
  }

  function reopenWin(win){
    win._state = 'open';
    win.hidden = false;
    focusWin(win);
    playAnim(win, 'win-opening');
  }

  /* ---------- Minimize into the Dock ---------- */
  function makeDockTile(win){
    var sep = dock.querySelector('.dock-sep-min');
    if(!sep){
      sep = document.createElement('span');
      sep.className = 'dock-sep dock-sep-min';
      sep.setAttribute('aria-hidden', 'true');
      dock.appendChild(sep);
    }
    var title = titleOf(win);
    var tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'dock-item dock-min dock-min-enter';
    tile.setAttribute('data-label', title);
    tile.setAttribute('aria-label', 'Restore ' + title);
    tile.innerHTML =
      '<span class="dock-min-bar" aria-hidden="true"><i></i><i></i><i></i></span>' +
      '<span class="dock-min-badge tile ' + (win.dataset.appTile || 'app-links') + '" aria-hidden="true">' +
      '<svg class="icon"><use href="/icons.svg#' + (win.dataset.appIcon || 'doc') + '"/></svg></span>';
    tile.addEventListener('click', function(){ restoreWin(win); });
    dock.appendChild(tile);
    dock.scrollLeft = dock.scrollWidth; // the Dock scrolls sideways on phones
    requestAnimationFrame(function(){
      requestAnimationFrame(function(){ tile.classList.remove('dock-min-enter'); });
    });
    win._tile = tile;
    return tile;
  }

  function removeDockTile(win){
    var tile = win._tile;
    if(!tile) return;
    win._tile = null;
    tile.remove();
    if(!dock.querySelector('.dock-min')){
      var sep = dock.querySelector('.dock-sep-min');
      if(sep) sep.remove();
    }
  }

  function minimizeWin(win){
    if(!isOpen(win) || !dock) return;
    unzoom(win, true);
    win._state = 'minimized';
    var tile = makeDockTile(win);
    requestAnimationFrame(function(){
      ivx.genie.collapse([win], tile, function(){
        win.hidden = true;
        ivx.genie.reset([win]);
        afterHide(win);
      });
    });
  }

  function restoreWin(win){
    if(stateOf(win) !== 'minimized'){ showWin(win); return; }
    var tile = win._tile;
    win._state = 'open';
    win.hidden = false;
    focusWin(win, { noScroll: true });
    if(!desktopMode()) win.scrollIntoView({ block: 'nearest' });
    if(tile && !reduceMotion) ivx.genie.expand([win], tile);
    removeDockTile(win);
  }

  /* ---------- Zoom (the green button) ----------
     Desktop layout: grow to fill the space between the menu bar and Dock.
     Phones / single-window pages: go full screen. Both animate with FLIP. */
  function flip(win, first){
    if(reduceMotion || !win.animate) return;
    var last = win.getBoundingClientRect();
    if(!last.width || !last.height || !first.width) return;
    win.animate([
      { transformOrigin: '0 0', transform: 'translate(' + (first.left - last.left) + 'px,' + (first.top - last.top) + 'px) scale(' + (first.width / last.width) + ',' + (first.height / last.height) + ')' },
      { transformOrigin: '0 0', transform: 'none' }
    ], { duration: 320, easing: 'cubic-bezier(0.2,0.9,0.3,1)' });
  }

  function fillDesktop(win){
    var parentRect = (win.offsetParent || win.parentElement).getBoundingClientRect();
    var menubar = document.querySelector('.menubar');
    var top = (menubar ? menubar.getBoundingClientRect().bottom : 0) + 10;
    var bottom = (dock ? dock.getBoundingClientRect().top : window.innerHeight) - 10;
    win.style.left = (10 - parentRect.left) + 'px';
    win.style.top = (top - parentRect.top) + 'px';
    win.style.width = (window.innerWidth - 20) + 'px';
    win.style.height = Math.max(200, bottom - top) + 'px';
  }

  function zoomWin(win){
    var first = win.getBoundingClientRect();
    focusWin(win, { noScroll: true });
    if(desktopMode()){
      win._restoreRect = { left: win.style.left, top: win.style.top, width: win.style.width, height: win.style.height };
      fillDesktop(win);
    } else {
      root.classList.add('has-zoomed-window');
    }
    win.classList.add('is-zoomed');
    ivx.syncMenubar();
    flip(win, first);
  }

  function unzoom(win, instant){
    if(!win.classList.contains('is-zoomed')) return;
    var first = win.getBoundingClientRect();
    win.classList.remove('is-zoomed');
    if(win._restoreRect){
      var r = win._restoreRect;
      win.style.left = r.left; win.style.top = r.top; win.style.width = r.width; win.style.height = r.height;
      win._restoreRect = null;
    }
    if(!wins.some(function(w){ return w.classList.contains('is-zoomed') && !desktopMode(); })){
      root.classList.remove('has-zoomed-window');
    }
    ivx.syncMenubar();
    if(!instant) flip(win, first);
  }

  function toggleZoom(win){
    if(!isOpen(win)) return;
    if(win.classList.contains('is-zoomed')) unzoom(win);
    else zoomWin(win);
  }

  // Dragging or resizing a zoomed window keeps its size but ends "zoomed".
  function clearZoom(win){
    win.classList.remove('is-zoomed');
    win._restoreRect = null;
  }

  function resetZoom(){
    wins.forEach(function(w){ unzoom(w, true); });
    root.classList.remove('has-zoomed-window');
    ivx.syncMenubar();
  }

  /* ---------- Show (from anywhere: menus, Spotlight, Dock, icons) ---------- */
  function showWin(win){
    if(!win) return;
    var st = stateOf(win);
    if(st === 'minimized') restoreWin(win);
    else if(st === 'closed') reopenWin(win);
    else focusWin(win);
  }

  function showAll(){
    wins.forEach(function(w){
      if(stateOf(w) === 'minimized') restoreWin(w);
      else if(stateOf(w) === 'closed') reopenWin(w);
    });
  }

  /* ---------- Wire up each window ---------- */
  wins.forEach(function(win){
    var title = titleOf(win);
    win.querySelectorAll('.traffic [data-win]').forEach(function(btn){
      var action = btn.getAttribute('data-win');
      btn.setAttribute('aria-label', (action === 'close' ? 'Close ' : action === 'minimize' ? 'Minimize ' : 'Zoom ') + title);
      btn.title = action === 'close' ? 'Close' : action === 'minimize' ? 'Minimize' : 'Zoom';
      if(action === 'minimize' && !dock) btn.disabled = true;
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        if(action === 'close') closeWin(win);
        else if(action === 'minimize') minimizeWin(win);
        else toggleZoom(win);
      });
    });

    // Double-click the title bar to zoom, like macOS.
    var header = win.querySelector('.window-header');
    if(header){
      header.addEventListener('dblclick', function(e){
        if(e.target.closest('a, button')) return;
        toggleZoom(win);
      });
    }

    win.addEventListener('pointerdown', function(){
      if(!isOpen(win)) return;
      if(desktopMode()) bringToFront(win);
      setActive(win);
    });
  });

  // Keep desktop-zoomed windows filling the space when the browser resizes.
  var zoomResizeTimer;
  window.addEventListener('resize', function(){
    clearTimeout(zoomResizeTimer);
    zoomResizeTimer = setTimeout(function(){
      if(!desktopMode()) return;
      wins.forEach(function(w){ if(w.classList.contains('is-zoomed')) fillDesktop(w); });
    }, 160);
  });

  ivx.wm = {
    windows: wins,
    byId: byId,
    title: titleOf,
    state: stateOf,
    active: activeWindow,
    setActive: setActive,
    bringToFront: bringToFront,
    focus: focusWin,
    show: showWin,
    showAll: showAll,
    close: closeWin,
    minimize: minimizeWin,
    restore: restoreWin,
    toggleZoom: toggleZoom,
    clearZoom: clearZoom,
    resetZoom: resetZoom
  };

  /* =====================================================================
     DIALOGS ("About This Site", "Keyboard Shortcuts")
     ===================================================================== */
  function openDialog(labelId, buildContent){
    var backdrop = document.createElement('div');
    backdrop.className = 'dlg-backdrop';
    var dlg = document.createElement('div');
    dlg.className = 'dlg glass strong';
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-labelledby', labelId);
    dlg.innerHTML =
      '<div class="traffic">' +
      '<button type="button" class="r" data-dlg-close aria-label="Close" title="Close"></button>' +
      '<button type="button" class="y" disabled aria-hidden="true" tabindex="-1"></button>' +
      '<button type="button" class="g" disabled aria-hidden="true" tabindex="-1"></button>' +
      '</div>';
    buildContent(dlg);
    backdrop.appendChild(dlg);
    document.body.appendChild(backdrop);

    var returnFocus = document.activeElement;
    function close(){
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      if(returnFocus && returnFocus.focus && document.contains(returnFocus)) returnFocus.focus({ preventScroll: true });
    }
    function onKey(e){
      if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); close(); }
      else if(e.key === 'Tab'){
        var f = slice(dlg.querySelectorAll('button:not([disabled]), a[href]'));
        if(!f.length) return;
        if(e.shiftKey && document.activeElement === f[0]){ e.preventDefault(); f[f.length - 1].focus(); }
        else if(!e.shiftKey && document.activeElement === f[f.length - 1]){ e.preventDefault(); f[0].focus(); }
        else if(!dlg.contains(document.activeElement)){ e.preventDefault(); f[0].focus(); }
      }
    }
    document.addEventListener('keydown', onKey, true);
    backdrop.addEventListener('pointerdown', function(e){ if(e.target === backdrop) close(); });
    dlg.addEventListener('click', function(e){
      var link = e.target.closest('[data-dlg-close], [data-dlg-go]');
      if(!link) return;
      close();
      if(link.hasAttribute('data-dlg-go')) window.location.href = link.getAttribute('data-dlg-go');
    });
    var primary = dlg.querySelector('.dlg-buttons .primary') || dlg.querySelector('[data-dlg-close]');
    primary.focus({ preventScroll: true });
  }

  function aboutThisSite(){
    openDialog('dlg-about-title', function(dlg){
      var theme = ivx.currentTheme() === 'dark' ? 'Dark' : 'Light';
      var mode = ivx.themeMode() === 'auto' ? theme + ' (automatic)' : theme;
      var clock = document.getElementById('clock');
      dlg.insertAdjacentHTML('beforeend',
        '<div class="dlg-icon avatar-ring tile" aria-hidden="true">IS</div>' +
        '<h2 id="dlg-about-title">IVXNCHIS</h2>' +
        '<p class="dlg-sub">Version 27.0 · Liquid Glass</p>' +
        '<dl>' +
        '<dt>Owner</dt><dd>Ivan Solano</dd>' +
        '<dt>Location</dt><dd>Bucaramanga, Colombia</dd>' +
        '<dt>Local time</dt><dd>' + (clock ? clock.textContent : '') + '</dd>' +
        '<dt>Appearance</dt><dd>' + mode + ', glass ' + Math.round(ivx.glassTint() * 100) + '% tinted</dd>' +
        '<dt>Built with</dt><dd>HTML, CSS &amp; vanilla JavaScript</dd>' +
        '<dt>Hosted on</dt><dd>Cloudflare Workers</dd>' +
        '</dl>' +
        '<div class="dlg-buttons">' +
        '<button type="button" class="glass-btn" data-dlg-go="/about">More About Ivan…</button>' +
        '<button type="button" class="glass-btn primary" data-dlg-close>OK</button>' +
        '</div>');
    });
  }

  function keyboardShortcuts(){
    var mod = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';
    var rows = [
      isHome && ['<kbd>' + mod + '</kbd> <kbd>K</kbd>', 'Spotlight Search'],
      isHome && ['<kbd>⌃</kbd> <kbd>↑</kbd>', 'Mission Control'],
      ['<kbd>esc</kbd>', 'Close menus, panels and full-screen windows'],
      ['Double-click title bar', 'Zoom a window'],
      ['<kbd>←</kbd> <kbd>→</kbd> in the menu bar', 'Move between menus'],
      isHome && ['Right-click the desktop', 'Quick actions menu'],
      isHome && ['Drag a title bar or corner', 'Move or resize a window (wide screens)']
    ].filter(Boolean);
    openDialog('dlg-keys-title', function(dlg){
      dlg.classList.add('dlg-wide');
      dlg.insertAdjacentHTML('beforeend',
        '<h2 id="dlg-keys-title">Keyboard Shortcuts</h2>' +
        '<p class="dlg-sub">Tips for getting around the desktop</p>' +
        '<dl class="dlg-keys">' + rows.map(function(r){ return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>'; }).join('') + '</dl>' +
        '<div class="dlg-buttons"><button type="button" class="glass-btn primary" data-dlg-close>Done</button></div>');
    });
  }

  /* =====================================================================
     MENU BAR
     ===================================================================== */
  var menubar = document.querySelector('.menubar');
  var bar = document.querySelector('.menubar-left[role="menubar"]');
  if(!bar){ return; }
  var titles = slice(bar.querySelectorAll('.menu-title'));
  var dropdown = document.createElement('div');
  dropdown.className = 'mb-menu glass strong';
  dropdown.setAttribute('role', 'menu');
  dropdown.tabIndex = -1;
  dropdown.hidden = true;
  document.body.appendChild(dropdown);
  var openTitle = null;

  function go(url){ window.location.href = url; }
  function openWindowById(id){
    if(isHome) showWin(byId(id));
    else go('/#' + id);
  }
  function download(){
    var a = document.createElement('a');
    a.href = '/resume.pdf';
    a.download = 'Ivan-Solano-Resume.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  function sharePage(){
    if(navigator.share){
      navigator.share({ title: document.title, url: location.href }).catch(function(){});
    } else {
      ivx.copy(location.href, 'Link copied to clipboard', location.href);
    }
  }
  function selectAll(){
    var win = activeWindow();
    if(!win) return;
    var target = win.querySelector('.doc-page, .links-content, .contact-body, .alert') || win;
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.selectAllChildren(target);
  }
  function restart(){
    try{ sessionStorage.removeItem('ivxBooted'); }catch(e){}
    go('/');
  }
  var fsEnabled = document.fullscreenEnabled || document.webkitFullscreenEnabled;
  function isFullscreen(){ return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  function toggleFullscreen(){
    if(isFullscreen()){
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      var el = document.documentElement;
      var req = el.requestFullscreen || el.webkitRequestFullscreen;
      var p = req.call(el);
      if(p && p.catch) p.catch(function(){ ivx.toast('Full screen isn’t available here'); });
    }
  }
  function tintIs(v){ return Math.abs(ivx.glassTint() - v) < 0.05; }
  var hasHome = function(){ return isHome && ivx.home; };
  var SEP = { sep: true };

  // Built fresh each time a menu opens, so checkmarks and states are current.
  function menuModel(id){
    var active = activeWindow();
    var mod = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl+';
    switch(id){
      case 'brand': return [
        { label: 'About This Site', action: aboutThisSite },
        SEP,
        !isHome && { label: 'Home', action: function(){ go('/'); } },
        location.pathname !== '/about' && { label: 'About Ivan', action: function(){ go('/about'); } },
        hasHome() && SEP,
        hasHome() && { label: 'Spotlight Search…', shortcut: mod + 'K', action: function(){ ivx.home.openSpotlight(); } },
        hasHome() && { label: 'Notification Center', action: function(){ ivx.home.openNotif(); } },
        SEP,
        { label: 'Restart…', action: restart }
      ];
      case 'file': return [
        { label: 'Open Resume', action: function(){ openWindowById('resume'); } },
        { label: 'Open Links', action: function(){ openWindowById('links'); } },
        { label: 'Open Contact', action: function(){ openWindowById('contact'); } },
        SEP,
        { label: 'Close Window', disabled: !active || !!active.dataset.closeHref, action: function(){ closeWin(active); } },
        SEP,
        { label: 'Download Resume (PDF)', action: download },
        { label: 'Print…', action: function(){ window.print(); } },
        { label: 'Share…', action: sharePage }
      ];
      case 'edit': return [
        { label: 'Copy Email Address', action: function(){ ivx.copy('reach@ivxnchis.com', 'Email copied: reach@ivxnchis.com', 'reach@ivxnchis.com'); } },
        { label: 'Copy Discord Username', action: function(){ ivx.copy('ivxnchis', 'Discord username copied: ivxnchis', 'Discord username: ivxnchis'); } },
        { label: 'Copy Link to This Page', action: function(){ ivx.copy(location.href, 'Link copied to clipboard', location.href); } },
        SEP,
        { label: 'Select All', disabled: !active, action: selectAll }
      ];
      case 'view': return [
        { label: 'Light', radio: true, checked: ivx.themeMode() === 'light', action: function(){ ivx.setTheme('light'); } },
        { label: 'Dark', radio: true, checked: ivx.themeMode() === 'dark', action: function(){ ivx.setTheme('dark'); } },
        { label: 'Match System', radio: true, checked: ivx.themeMode() === 'auto', action: function(){ ivx.setTheme('auto'); } },
        SEP,
        { label: 'Clear Glass', radio: true, checked: tintIs(0), action: function(){ ivx.setGlassTint(0); } },
        { label: 'Standard Glass', radio: true, checked: tintIs(0.4), action: function(){ ivx.setGlassTint(0.4); } },
        { label: 'Tinted Glass', radio: true, checked: tintIs(1), action: function(){ ivx.setGlassTint(1); } },
        (hasHome() || fsEnabled) && SEP,
        hasHome() && { label: 'Mission Control', shortcut: '⌃↑', action: function(){ ivx.home.openMissionControl(); } },
        fsEnabled && { label: isFullscreen() ? 'Exit Full Screen' : 'Enter Full Screen', action: toggleFullscreen }
      ];
      case 'window':
        var list = wins.map(function(w){
          var st = stateOf(w);
          return {
            label: titleOf(w),
            mark: st === 'minimized' ? '◆' : (w === active && st === 'open') ? '✓' : '',
            note: st === 'closed' ? 'Closed' : st === 'minimized' ? 'Minimized' : '',
            action: function(){ showWin(w); }
          };
        });
        return [
          { label: 'Minimize', disabled: !active || !dock, action: function(){ minimizeWin(active); } },
          { label: active && active.classList.contains('is-zoomed') ? 'Unzoom' : 'Zoom', disabled: !active, action: function(){ toggleZoom(active); } },
          SEP,
          { label: 'Show All Windows', disabled: wins.every(isOpen), action: showAll },
          hasHome() && { label: 'Reset Window Layout', action: function(){ ivx.home.resetLayout(); } },
          list.length && SEP
        ].concat(list);
      case 'help': return [
        { label: 'Keyboard Shortcuts', action: keyboardShortcuts },
        SEP,
        { label: 'Email Ivan…', action: function(){ go('mailto:reach@ivxnchis.com'); } },
        { label: 'Message on WhatsApp', action: function(){ window.open('https://wa.link/rcedvv', '_blank', 'noopener'); } },
        location.pathname !== '/about' && SEP,
        location.pathname !== '/about' && { label: 'About Ivan', action: function(){ go('/about'); } }
      ];
    }
    return [];
  }

  function render(items){
    dropdown.innerHTML = '';
    // drop hidden entries, and separators at the ends or doubled up
    var clean = [];
    items.filter(Boolean).forEach(function(it){
      if(it.sep && (!clean.length || clean[clean.length - 1].sep)) return;
      clean.push(it);
    });
    if(clean.length && clean[clean.length - 1].sep) clean.pop();
    clean.forEach(function(it){
      if(it.sep){
        var s = document.createElement('div');
        s.className = 'mb-sep';
        s.setAttribute('role', 'separator');
        dropdown.appendChild(s);
        return;
      }
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'mb-item';
      b.tabIndex = -1;
      b.setAttribute('role', it.radio ? 'menuitemradio' : 'menuitem');
      if(it.radio) b.setAttribute('aria-checked', it.checked ? 'true' : 'false');
      if(it.disabled) b.setAttribute('aria-disabled', 'true');
      var check = document.createElement('span');
      check.className = 'mb-check';
      check.setAttribute('aria-hidden', 'true');
      check.textContent = it.mark || (it.checked ? '✓' : '');
      var label = document.createElement('span');
      label.className = 'mb-label';
      label.textContent = it.label;
      b.appendChild(check);
      b.appendChild(label);
      if(it.note || it.shortcut){
        var extra = document.createElement('span');
        extra.className = 'mb-shortcut';
        extra.textContent = it.shortcut || it.note;
        b.appendChild(extra);
      }
      if(it.note) b.setAttribute('aria-label', it.label + ', ' + it.note);
      b.addEventListener('click', function(){
        if(it.disabled) return;
        closeMenu(false);
        it.action();
      });
      dropdown.appendChild(b);
    });
  }

  function items(){ return slice(dropdown.querySelectorAll('.mb-item:not([aria-disabled="true"])')); }
  function visibleTitles(){ return titles.filter(function(t){ return t.offsetParent !== null; }); }

  function setRoving(title){
    titles.forEach(function(t){ t.tabIndex = t === title ? 0 : -1; });
  }

  function openMenu(title, focusFirst){
    if(openTitle === title) return;
    closeMenu(false);
    render(menuModel(title.getAttribute('data-menu')));
    openTitle = title;
    setRoving(title);
    title.setAttribute('aria-expanded', 'true');
    title.classList.add('open');
    dropdown.setAttribute('aria-labelledby', title.id);
    dropdown.hidden = false;
    var r = title.getBoundingClientRect();
    dropdown.style.top = (menubar.getBoundingClientRect().bottom + 4) + 'px';
    dropdown.style.left = Math.max(8, Math.min(r.left, window.innerWidth - dropdown.offsetWidth - 8)) + 'px';
    if(focusFirst && items()[0]) items()[0].focus({ preventScroll: true });
    else dropdown.focus({ preventScroll: true });
  }

  function closeMenu(returnFocus){
    if(!openTitle) return;
    var title = openTitle;
    openTitle = null;
    dropdown.hidden = true;
    dropdown.innerHTML = '';
    title.setAttribute('aria-expanded', 'false');
    title.classList.remove('open');
    if(returnFocus) title.focus({ preventScroll: true });
  }

  function stepTitle(from, dir){
    var vis = visibleTitles();
    var i = vis.indexOf(from);
    return vis[(i + dir + vis.length) % vis.length];
  }

  titles.forEach(function(title){
    title.addEventListener('click', function(){
      if(openTitle === title) closeMenu(false);
      else openMenu(title, false);
    });
    // Once one menu is open, hovering another title switches to it.
    title.addEventListener('pointerenter', function(){
      if(openTitle && openTitle !== title) openMenu(title, false);
    });
    title.addEventListener('focus', function(){ setRoving(title); });
    title.addEventListener('keydown', function(e){
      if(e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' '){
        e.preventDefault();
        openMenu(title, true);
      } else if(e.key === 'ArrowRight' || e.key === 'ArrowLeft'){
        e.preventDefault();
        var next = stepTitle(title, e.key === 'ArrowRight' ? 1 : -1);
        if(openTitle){ openMenu(next, true); }
        else next.focus();
      } else if(e.key === 'Escape' && openTitle){
        e.preventDefault();
        e.stopPropagation();
        closeMenu(true);
      }
    });
  });

  dropdown.addEventListener('keydown', function(e){
    var list = items();
    var i = list.indexOf(document.activeElement);
    if(e.key === 'ArrowDown'){ e.preventDefault(); if(list.length) list[(i + 1) % list.length].focus(); }
    else if(e.key === 'ArrowUp'){ e.preventDefault(); if(list.length) list[(i - 1 + list.length) % list.length].focus(); }
    else if(e.key === 'Home'){ e.preventDefault(); if(list[0]) list[0].focus(); }
    else if(e.key === 'End'){ e.preventDefault(); if(list.length) list[list.length - 1].focus(); }
    else if(e.key === 'ArrowRight' || e.key === 'ArrowLeft'){
      e.preventDefault();
      openMenu(stepTitle(openTitle, e.key === 'ArrowRight' ? 1 : -1), true);
    }
    else if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); closeMenu(true); }
    else if(e.key === 'Tab'){ e.preventDefault(); closeMenu(true); }
  });
  // Pointer highlights and keyboard focus stay in sync.
  dropdown.addEventListener('pointermove', function(e){
    var item = e.target.closest('.mb-item');
    if(item && item !== document.activeElement && item.getAttribute('aria-disabled') !== 'true') item.focus({ preventScroll: true });
  });

  document.addEventListener('pointerdown', function(e){
    if(openTitle && !dropdown.contains(e.target) && !bar.contains(e.target)) closeMenu(false);
  });
  window.addEventListener('resize', function(){ closeMenu(false); });
  window.addEventListener('blur', function(){ closeMenu(false); });

  // Escape also takes a phone-style full-screen window back to normal. This
  // listens on window so the page's own Escape handlers (panels) go first.
  window.addEventListener('keydown', function(e){
    if(e.key !== 'Escape' || e.defaultPrevented || openTitle) return;
    var zoomed = wins.filter(function(w){ return w.classList.contains('is-zoomed') && !desktopMode(); })[0];
    if(zoomed){ e.preventDefault(); unzoom(zoomed); }
  });

  ivx.menubar = { close: closeMenu };
})();
