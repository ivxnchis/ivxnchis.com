/* Home page: desktop windowing, boot screen, Spotlight, Mission Control,
   Notification Center, and the right-click menu. Uses helpers from site.js
   and the window manager (ivx.wm) from desktop.js. */
(function(){
  var ivx = window.ivx;
  var wm = ivx.wm;
  var root = document.documentElement;
  var main = document.querySelector('main');
  var windows = wm.windows;
  var desktopModeActive = false;
  var layoutWindows = function(){};

  // Shared by the desktop icons, Spotlight, Mission Control and the context
  // menu: opens a closed window, restores a minimized one, or brings it forward.
  function focusWindow(id){
    wm.show(document.getElementById(id));
  }

  document.querySelectorAll('.desktop-icon').forEach(function(btn){
    btn.addEventListener('click', function(){ focusWindow(btn.dataset.target); });
  });

  /* ---------------- Desktop windowing: drag, resize, side-by-side layout ---------------- */
  (function(){
    var BREAKPOINT = 900;
    if(!main || !windows.length) return;

    function updateCanvasHeight(){
      if(!desktopModeActive) return;
      var maxBottom = 0;
      windows.forEach(function(w){
        var bottom = w.offsetTop + w.offsetHeight;
        if(bottom > maxBottom) maxBottom = bottom;
      });
      main.style.minHeight = (maxBottom + 40) + 'px';
    }

    layoutWindows = function(){
      var resume = document.getElementById('resume');
      var links = document.getElementById('links');
      var contact = document.getElementById('contact');
      var hero = document.querySelector('.hero');
      var menubar = document.querySelector('.menubar');
      if(!resume || !links || !contact || !hero) return;

      // clear any explicit heights first so measurements are clean
      windows.forEach(function(w){ w.style.height = ''; });

      requestAnimationFrame(function(){
        var menubarH = menubar ? menubar.offsetHeight : 0;
        var topY = hero.offsetTop + hero.offsetHeight + 44; // clear the hero block
        var dockClearance = 175; // room for the dock, plus a safety buffer
        var availableH = Math.max(420, window.innerHeight - menubarH - topY - dockClearance);

        // Size columns to main's content box (inside its side padding) so the
        // windows fill wide screens without sliding under the desktop icons.
        var cs = getComputedStyle(main);
        var padL = parseFloat(cs.paddingLeft) || 0;
        var canvasW = main.clientWidth - padL - (parseFloat(cs.paddingRight) || 0);
        var gap = canvasW < 1000 ? 28 : 48;
        var linksWidth = Math.min(560, Math.max(340, Math.round(canvasW * 0.34)));
        var resumeWidth = Math.max(420, canvasW - linksWidth - gap);

        // Resume is the one window whose content scrolls internally.
        resume.style.left = padL + 'px';
        resume.style.top = topY + 'px';
        resume.style.width = resumeWidth + 'px';
        resume.style.height = availableH + 'px';
        wm.bringToFront(resume);

        // Links: natural height, stacked above Contact in the right-hand column.
        links.style.left = (padL + resumeWidth + gap) + 'px';
        links.style.top = topY + 'px';
        links.style.width = linksWidth + 'px';
        wm.bringToFront(links);

        requestAnimationFrame(function(){
          var linksBottom = links.offsetTop + links.offsetHeight;
          contact.style.left = (padL + resumeWidth + gap) + 'px';
          contact.style.top = (linksBottom + 24) + 'px';
          contact.style.width = linksWidth + 'px';
          wm.bringToFront(contact);
          // start on the window named in the URL (e.g. /#links), else the resume
          var initial = wm.byId(location.hash.slice(1));
          wm.focus(initial && wm.state(initial) === 'open' ? initial : resume, { noScroll: true });
          updateCanvasHeight();
        });
      });
    };

    function clearLayout(){
      windows.forEach(function(w){
        w.style.left = w.style.top = w.style.width = w.style.height = w.style.zIndex = '';
        w.classList.remove('window-active');
      });
      main.style.minHeight = '';
    }

    // Shared pointer-tracking helper for drag and resize.
    function track(e, onMove){
      function move(ev){ onMove(ev.clientX - e.clientX, ev.clientY - e.clientY); }
      function up(){
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', up);
        windows.forEach(function(w){ w.classList.remove('dragging'); });
        updateCanvasHeight();
      }
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', up);
    }

    windows.forEach(function(win){
      var header = win.querySelector('.window-header');
      header.addEventListener('pointerdown', function(e){
        // toolbar buttons are clickable, not drag handles
        if(!desktopModeActive || e.button !== 0 || e.target.closest('a, button')) return;
        e.preventDefault();
        var startLeft = win.offsetLeft, startTop = win.offsetTop;
        var moved = false;
        track(e, function(dx, dy){
          // a plain click (or the first half of a double-click) isn't a drag
          if(!moved){
            if(Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
            moved = true;
            wm.clearZoom(win);
            win.classList.add('dragging');
          }
          var maxLeft = Math.max(0, main.clientWidth - win.offsetWidth);
          win.style.left = Math.max(0, Math.min(startLeft + dx, maxLeft)) + 'px';
          win.style.top = Math.max(0, startTop + dy) + 'px';
        });
      });

      var handle = win.querySelector('.resize-handle');
      handle.addEventListener('pointerdown', function(e){
        if(!desktopModeActive || e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        wm.focus(win, { noScroll: true });
        var startW = win.offsetWidth, startH = win.offsetHeight;
        track(e, function(dx, dy){
          wm.clearZoom(win);
          win.style.width = Math.max(280, startW + dx) + 'px';
          win.style.height = Math.max(200, startH + dy) + 'px';
        });
      });
    });

    function syncMode(){
      var shouldBeDesktop = window.innerWidth >= BREAKPOINT;
      if(shouldBeDesktop !== desktopModeActive) wm.resetZoom();
      if(shouldBeDesktop && !desktopModeActive){
        desktopModeActive = true;
        document.body.classList.add('desktop-mode');
        layoutWindows();
      } else if(!shouldBeDesktop && desktopModeActive){
        desktopModeActive = false;
        document.body.classList.remove('desktop-mode');
        clearLayout();
      }
    }

    var resizeTimer;
    window.addEventListener('resize', function(){
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(syncMode, 150);
    });

    syncMode();

    if(document.fonts && document.fonts.ready){
      document.fonts.ready.then(function(){
        if(desktopModeActive) layoutWindows();
      });
    }
  })();

  /* ---------------- Share ---------------- */
  var shareBtn = document.getElementById('shareBtn');
  if(shareBtn){
    shareBtn.addEventListener('click', function(){
      var url = 'https://ivxnchis.com/#resume';
      if(navigator.share){
        navigator.share({
          title: 'Ivan Solano — Resume',
          text: 'Customer Service Supervisor & Communications Professional',
          url: url
        }).catch(function(){ /* user cancelled */ });
      } else {
        ivx.copy(url, 'Link copied to clipboard', url);
      }
    });
  }

  /* ---------------- Boot screen ---------------- */
  var bootScreen = document.getElementById('bootScreen');
  if(root.classList.contains('booting')){
    var revealed = false;
    var reveal = function(){
      if(revealed) return;
      revealed = true;
      root.classList.add('boot-fading');
      root.classList.remove('booting');
      setTimeout(function(){
        root.classList.remove('boot-fading');
        bootScreen.remove();
      }, 700);
    };
    if(document.readyState === 'complete'){ setTimeout(reveal, 1500); }
    else { window.addEventListener('load', function(){ setTimeout(reveal, 1500); }); }
    setTimeout(reveal, 2800); // don't wait forever on slow assets
  } else {
    bootScreen.remove();
  }

  /* ---------------- Overlay layers ----------------
     Closed layers are `inert`, so they're skipped by Tab and screen readers.
     Opening one remembers what had focus; closing returns focus there. */
  var layers = {
    menu: document.getElementById('contextMenu'),
    spotlight: document.getElementById('spotlight'),
    mission: document.getElementById('missionControl'),
    notif: document.getElementById('notifCenter')
  };
  var layerTriggers = {
    mission: document.getElementById('mcBtn'),
    notif: document.getElementById('notifToggle')
  };

  function isOpen(name){ return layers[name].classList.contains('active'); }

  function openLayer(name, focusEl){
    var el = layers[name];
    if(isOpen(name)) return;
    el._returnFocus = document.activeElement;
    el.inert = false;
    el.classList.add('active');
    if(layerTriggers[name]) layerTriggers[name].setAttribute('aria-expanded', 'true');
    if(focusEl) focusEl.focus({ preventScroll: true });
  }

  function closeLayer(name, restoreFocus){
    var el = layers[name];
    if(!isOpen(name)) return;
    el.classList.remove('active');
    el.inert = true;
    if(layerTriggers[name]) layerTriggers[name].setAttribute('aria-expanded', 'false');
    var back = el._returnFocus;
    el._returnFocus = null;
    if(restoreFocus !== false && back && back.focus && document.contains(back)){
      back.focus({ preventScroll: true });
    }
  }

  function closeAll(){
    Object.keys(layers).forEach(function(name){ closeLayer(name, false); });
    if(ivx.menubar) ivx.menubar.close(false);
  }

  // Keep Tab inside modal layers while they're open.
  function trapFocus(e, el){
    var focusables = Array.prototype.slice.call(el.querySelectorAll('button, input, a[href]'))
      .filter(function(n){ return n.tabIndex >= 0 && n.offsetParent !== null; });
    if(!focusables.length) return;
    var first = focusables[0], last = focusables[focusables.length - 1];
    if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
  }

  function openAndFocusWindow(id){
    closeAll();
    focusWindow(id);
  }

  /* ===================== SPOTLIGHT SEARCH ===================== */
  var spotlightInput = document.getElementById('spotlightInput');
  var spotlightResults = document.getElementById('spotlightResults');
  var spotlightMatches = [];
  var focusedIndex = -1;

  function openUrl(url){ return function(){ closeAll(); window.open(url, '_blank', 'noopener'); }; }

  var spotlightItems = [
    { name: 'Resume.pdf', icon: 'doc', cls: 'app-resume', meta: 'Preview', keywords: 'resume cv work experience pdf', action: function(){ openAndFocusWindow('resume'); } },
    { name: 'Links', icon: 'folder', cls: 'app-links', meta: 'Finder', keywords: 'links social media finder', action: function(){ openAndFocusWindow('links'); } },
    { name: 'Contact', icon: 'note', cls: 'app-notes', meta: 'Notes', keywords: 'contact email whatsapp', action: function(){ openAndFocusWindow('contact'); } },
    { name: 'About', icon: 'person', cls: 'about', meta: 'Page', keywords: 'about story bio', action: function(){ closeAll(); window.location.href = '/about'; } },
    { name: 'Instagram', icon: 'ig', cls: 'ig', meta: 'Profile', keywords: 'instagram ig social photo', action: openUrl('https://instagram.com/ivan.sln') },
    { name: 'X', icon: 'x', cls: 'x', meta: 'Profile', keywords: 'x twitter social tweet', action: openUrl('https://x.com/ivxnchis') },
    { name: 'TikTok', icon: 'tt', cls: 'tt', meta: 'Profile', keywords: 'tiktok video social', action: openUrl('https://www.tiktok.com/@ivxnchis') },
    { name: 'Discord', icon: 'dc', cls: 'dc', meta: 'Copy username', keywords: 'discord chat username', action: function(){ closeAll(); ivx.copy('ivxnchis', 'Discord username copied: ivxnchis', 'Discord username: ivxnchis'); } },
    { name: 'Spotify', icon: 'sp', cls: 'sp', meta: 'Profile', keywords: 'spotify music playlist', action: openUrl('https://open.spotify.com/user/ivansolanoc') },
    { name: 'Letterboxd', icon: 'lb', cls: 'lb', meta: 'Film log', keywords: 'letterboxd film movie review', action: openUrl('https://letterboxd.com/IVXNCHIS') },
    { name: 'WhatsApp', icon: 'wa', cls: 'wa', meta: 'Chat', keywords: 'whatsapp message chat', action: openUrl('https://wa.link/rcedvv') },
    { name: 'Email', icon: 'mail', cls: 'mail', meta: 'Mail', keywords: 'email mail contact', action: function(){ closeAll(); window.location.href = 'mailto:reach@ivxnchis.com'; } },
    { name: 'Mission Control', icon: 'grid', cls: 'app-mc', meta: 'Windows', keywords: 'mission control windows overview', action: function(){ closeLayer('spotlight', false); openMissionControl(); } },
    { name: 'Notification Center', icon: 'bell', cls: 'app-nc', meta: 'Widgets', keywords: 'notifications widget weather', action: function(){ closeLayer('spotlight', false); openNotif(); } }
  ];

  function renderSpotlight(query){
    var q = query.toLowerCase().trim();
    spotlightMatches = q ? spotlightItems.filter(function(it){
      return it.name.toLowerCase().indexOf(q) !== -1 || it.keywords.indexOf(q) !== -1;
    }) : spotlightItems.slice(0, 6);

    if(!spotlightMatches.length){
      spotlightResults.innerHTML = '<div class="spotlight-empty">No results found</div>';
      setSpotlightFocus(-1);
      return;
    }

    spotlightResults.innerHTML = spotlightMatches.map(function(it, i){
      return '<button type="button" tabindex="-1" role="option" class="spotlight-item" id="sp-opt-' + i + '" data-index="' + i + '">' +
        '<span class="finder-icon tile ' + it.cls + '"><svg class="icon" aria-hidden="true"><use href="/icons.svg#' + it.icon + '"/></svg></span>' +
        '<span>' + it.name + '</span>' +
        '<span class="si-meta">' + it.meta + '</span>' +
        '</button>';
    }).join('');
    setSpotlightFocus(0);
  }

  function setSpotlightFocus(i){
    focusedIndex = i;
    var btns = spotlightResults.querySelectorAll('.spotlight-item');
    btns.forEach(function(b, j){
      b.classList.toggle('focused', j === i);
      b.setAttribute('aria-selected', j === i ? 'true' : 'false');
    });
    if(btns[i]){
      spotlightInput.setAttribute('aria-activedescendant', btns[i].id);
      btns[i].scrollIntoView({ block: 'nearest' });
    } else {
      spotlightInput.removeAttribute('aria-activedescendant');
    }
  }

  spotlightResults.addEventListener('click', function(e){
    var btn = e.target.closest('.spotlight-item');
    if(btn) spotlightMatches[+btn.dataset.index].action();
  });

  spotlightInput.addEventListener('input', function(){ renderSpotlight(spotlightInput.value); });

  spotlightInput.addEventListener('keydown', function(e){
    var count = spotlightMatches.length;
    if(e.key === 'ArrowDown' && count){
      e.preventDefault();
      setSpotlightFocus(Math.min(focusedIndex + 1, count - 1));
    } else if(e.key === 'ArrowUp' && count){
      e.preventDefault();
      setSpotlightFocus(Math.max(focusedIndex - 1, 0));
    } else if(e.key === 'Enter' && spotlightMatches[focusedIndex]){
      e.preventDefault();
      spotlightMatches[focusedIndex].action();
    }
  });

  layers.spotlight.addEventListener('click', function(e){
    if(e.target === layers.spotlight) closeLayer('spotlight');
  });

  function openSpotlight(){
    spotlightInput.value = '';
    renderSpotlight('');
    openLayer('spotlight', spotlightInput);
  }

  /* ===================== MISSION CONTROL ===================== */
  var mcBar = document.getElementById('mcBar');

  function buildThumbs(){
    mcBar.innerHTML = '';
    windows.forEach(function(w){
      var title = wm.title(w);
      var st = wm.state(w);
      var note = st === 'closed' ? ' (Closed)' : st === 'minimized' ? ' (Minimized)' : '';
      var thumb = document.createElement('button');
      thumb.type = 'button';
      thumb.className = 'mc-thumb' + (st !== 'open' ? ' mc-hidden' : '');
      thumb.setAttribute('aria-label', (st === 'open' ? 'Focus ' : st === 'closed' ? 'Open ' : 'Restore ') + title);
      thumb.innerHTML =
        '<span class="mc-header" aria-hidden="true"><span style="background:#ff5f57"></span><span style="background:#febc2e"></span><span style="background:#28c840"></span></span>' +
        '<span class="mc-preview" aria-hidden="true"><strong></strong></span>' +
        '<span class="mc-label" aria-hidden="true"></span>';
      thumb.querySelector('strong').textContent = title;
      thumb.querySelector('.mc-preview').appendChild(document.createTextNode(
        w.querySelector('.doc-page') ? 'Document preview…' : w.id === 'links' ? 'List view…' : 'Note…'
      ));
      thumb.querySelector('.mc-label').textContent = title + note;
      thumb.addEventListener('click', function(){ openAndFocusWindow(w.id); });
      mcBar.appendChild(thumb);
    });
  }

  function openMissionControl(){
    buildThumbs();
    openLayer('mission', mcBar.querySelector('button'));
  }

  function toggleMissionControl(){
    if(isOpen('mission')) closeLayer('mission');
    else openMissionControl();
  }

  document.getElementById('mcBtn').addEventListener('click', toggleMissionControl);

  layers.mission.addEventListener('click', function(e){
    if(e.target === layers.mission || e.target === mcBar || e.target.classList.contains('mc-dock-hint')) closeLayer('mission');
  });

  /* ===================== NOTIFICATION CENTER ===================== */
  var weather = {
    widget: document.getElementById('weatherWidget'),
    temp: document.getElementById('wxTemp'),
    cond: document.getElementById('wxCond'),
    range: document.getElementById('wxRange'),
    fetchedAt: 0
  };

  function describeWeather(code){
    if(code === 0) return '☀️ Clear';
    if(code === 1) return '🌤️ Mainly clear';
    if(code === 2) return '⛅ Partly cloudy';
    if(code === 3) return '☁️ Overcast';
    if(code === 45 || code === 48) return '🌫️ Fog';
    if(code >= 51 && code <= 57) return '🌦️ Drizzle';
    if(code >= 61 && code <= 67) return '🌧️ Rain';
    if(code >= 71 && code <= 77) return '❄️ Snow';
    if(code >= 80 && code <= 82) return '🌦️ Showers';
    if(code === 85 || code === 86) return '🌨️ Snow showers';
    if(code >= 95) return '⛈️ Thunderstorm';
    return '';
  }

  function loadWeather(){
    // Live conditions for Bucaramanga from Open-Meteo (free, no key), refreshed every 15 min.
    if(Date.now() - weather.fetchedAt < 15 * 60 * 1000 || !window.fetch) return;
    weather.fetchedAt = Date.now();
    weather.widget.hidden = false;
    fetch('https://api.open-meteo.com/v1/forecast?latitude=7.1193&longitude=-73.1227' +
          '&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min' +
          '&timezone=America%2FBogota&forecast_days=1')
      .then(function(r){ if(!r.ok) throw new Error(r.status); return r.json(); })
      .then(function(d){
        weather.temp.textContent = Math.round(d.current.temperature_2m) + '°';
        weather.cond.textContent = describeWeather(d.current.weather_code);
        weather.range.textContent = 'H:' + Math.round(d.daily.temperature_2m_max[0]) + '° L:' + Math.round(d.daily.temperature_2m_min[0]) + '°';
      })
      .catch(function(){
        weather.widget.hidden = true;
        weather.fetchedAt = 0;
      });
  }

  /* Appearance widget: Light / Dark / Auto + the Liquid Glass slider */
  var themeButtons = Array.prototype.slice.call(layers.notif.querySelectorAll('[data-theme-set]'));
  var tintInput = document.getElementById('glassTint');
  var tintOut = document.getElementById('glassTintOut');

  function describeTint(v){
    return v < 0.15 ? 'Clear' : v > 0.85 ? 'Tinted' : Math.round(v * 100) + '%';
  }
  function syncAppearance(){
    var mode = ivx.themeMode();
    themeButtons.forEach(function(b){
      b.setAttribute('aria-checked', b.dataset.themeSet === mode ? 'true' : 'false');
    });
    var v = ivx.glassTint();
    tintInput.value = Math.round(v * 100);
    tintOut.textContent = describeTint(v);
    tintInput.setAttribute('aria-valuetext', describeTint(v));
  }
  themeButtons.forEach(function(b){
    b.addEventListener('click', function(){
      ivx.setTheme(b.dataset.themeSet);
      syncAppearance();
    });
  });
  tintInput.addEventListener('input', function(){
    ivx.setGlassTint(tintInput.value / 100);
    syncAppearance();
  });

  function openNotif(){
    loadWeather();
    syncAppearance();
    openLayer('notif', document.getElementById('ncClose'));
  }

  layerTriggers.notif.addEventListener('click', function(){
    if(isOpen('notif')) closeLayer('notif');
    else openNotif();
  });
  document.getElementById('ncClose').addEventListener('click', function(){ closeLayer('notif'); });

  layers.notif.querySelectorAll('[data-nc-action]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var action = btn.dataset.ncAction;
      closeLayer('notif', false);
      if(action === 'spotlight') openSpotlight();
      else if(action === 'mission') openMissionControl();
      else if(action === 'email') window.location.href = 'mailto:reach@ivxnchis.com';
    });
  });

  // Dismiss on a pointer press elsewhere. Using pointerdown (not click) means
  // the click that *opens* a layer from a menu can't immediately close it.
  document.addEventListener('pointerdown', function(e){
    if(isOpen('notif') && !layers.notif.contains(e.target) && !layerTriggers.notif.contains(e.target)){
      closeLayer('notif', false);
    }
    if(isOpen('menu') && !layers.menu.contains(e.target)){
      closeLayer('menu', false);
    }
  });

  /* ===================== CONTEXT MENU ===================== */
  var menu = layers.menu;
  var menuItems = Array.prototype.slice.call(menu.querySelectorAll('.ctx-item'));
  var themeItem = document.getElementById('ctxTheme');

  function showMenu(x, y){
    themeItem.textContent = ivx.currentTheme() === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    openLayer('menu', menuItems[0]);
    // keep inside the viewport (offset sizes ignore the open animation's scale)
    var w = menu.offsetWidth, h = menu.offsetHeight;
    if(x + w > window.innerWidth - 8) menu.style.left = Math.max(8, window.innerWidth - w - 8) + 'px';
    if(y + h > window.innerHeight - 8) menu.style.top = Math.max(8, window.innerHeight - h - 8) + 'px';
  }

  document.addEventListener('contextmenu', function(e){
    var t = e.target;
    // Leave the browser's own menu for links, buttons, fields, the resume
    // text (so "Copy" works), and whenever text is selected.
    var selection = window.getSelection && String(window.getSelection());
    if(t.closest('a, button, input, textarea, .doc-page') || selection){
      return;
    }
    e.preventDefault();
    closeAll();
    showMenu(e.clientX, e.clientY);
  });

  menu.addEventListener('keydown', function(e){
    var i = menuItems.indexOf(document.activeElement);
    if(e.key === 'ArrowDown'){ e.preventDefault(); menuItems[(i + 1) % menuItems.length].focus(); }
    else if(e.key === 'ArrowUp'){ e.preventDefault(); menuItems[(i - 1 + menuItems.length) % menuItems.length].focus(); }
    else if(e.key === 'Home'){ e.preventDefault(); menuItems[0].focus(); }
    else if(e.key === 'End'){ e.preventDefault(); menuItems[menuItems.length - 1].focus(); }
    else if(e.key === 'Tab'){ e.preventDefault(); closeLayer('menu'); }
  });

  menuItems.forEach(function(item){
    item.addEventListener('click', function(){
      var action = item.dataset.action;
      closeLayer('menu', false);
      switch(action){
        case 'refresh': location.reload(); break;
        case 'spotlight': openSpotlight(); break;
        case 'mission': openMissionControl(); break;
        case 'notif': openNotif(); break;
        case 'resume':
        case 'links':
        case 'contact': focusWindow(action); break;
        case 'showall': wm.showAll(); break;
        case 'theme': ivx.toggleTheme(); break;
      }
    });
  });

  /* Hooks for the menu bar (desktop.js) */
  ivx.home = {
    openSpotlight: function(){ closeAll(); openSpotlight(); },
    openMissionControl: function(){ closeAll(); openMissionControl(); },
    openNotif: function(){ closeAll(); openNotif(); },
    resetLayout: function(){
      wm.resetZoom();
      wm.showAll();
      if(desktopModeActive) layoutWindows();
    }
  };

  /* ===================== KEYBOARD ===================== */
  document.addEventListener('keydown', function(e){
    // Cmd/Ctrl+K toggles Spotlight
    if((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')){
      e.preventDefault();
      if(isOpen('spotlight')) closeLayer('spotlight');
      else { closeAll(); openSpotlight(); }
      return;
    }
    // Ctrl+↑ toggles Mission Control
    if(e.ctrlKey && e.key === 'ArrowUp' && !e.target.closest('input, textarea')){
      e.preventDefault();
      if(isOpen('mission')) closeLayer('mission');
      else { closeAll(); openMissionControl(); }
      return;
    }
    if(e.key === 'Escape'){
      // close the topmost open layer
      var order = ['menu', 'spotlight', 'mission', 'notif'];
      for(var i = 0; i < order.length; i++){
        if(isOpen(order[i])){ e.preventDefault(); closeLayer(order[i]); return; }
      }
    }
    if(e.key === 'Tab'){
      if(isOpen('spotlight')) trapFocus(e, layers.spotlight);
      else if(isOpen('mission')) trapFocus(e, layers.mission);
    }
  });
})();
