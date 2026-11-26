/* Spiluter site: navigation slab, scroll reveals, screen tour, hero trace,
   and the pulsar explorer. No dependencies. */
(function () {
  "use strict";
  document.documentElement.classList.remove("no-js");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const SHOCK = css("--shock") || "#ff6f24";
  const ACID = css("--acid") || "#1f8bff";

  /* ── navigation: the paper slab slides from the previous tab to this one ── */
  (function nav() {
    const navEl = document.querySelector(".site-nav");
    if (!navEl) return;
    const active = navEl.querySelector("a.active");
    const ind = document.createElement("span");
    ind.className = "nav-ind";
    navEl.prepend(ind);
    const KEY = "spiluter.nav.from";
    const place = (el) => {
      if (!el) return;
      ind.style.width = `${el.offsetWidth}px`;
      ind.style.transform = `translateX(${el.offsetLeft}px)`;
    };
    let from = null;
    try { from = sessionStorage.getItem(KEY); } catch (_e) { /* private mode */ }
    const fromEl = from ? navEl.querySelector(`a[data-page="${from}"]`) : null;
    if (fromEl && fromEl !== active && !reduceMotion) {
      place(fromEl);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        ind.classList.add("slide");
        place(active);
      }));
    } else {
      place(active);
      requestAnimationFrame(() => ind.classList.add("slide"));
    }
    try { if (active) sessionStorage.setItem(KEY, active.dataset.page); } catch (_e) { /* ignore */ }
    // Start the slide on click so it is already moving when the next page arrives.
    navEl.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", () => {
        if (a === active) return;
        place(a);
        navEl.querySelectorAll("a").forEach((x) => x.classList.toggle("active", x === a));
      });
    });
    window.addEventListener("resize", () => place(navEl.querySelector("a.active")));
    // Back/forward cache restores the page as it was left: put the slab back.
    window.addEventListener("pageshow", (e) => {
      if (!e.persisted) return;
      navEl.querySelectorAll("a").forEach((x) => x.classList.toggle("active", x === active));
      place(active);
    });
  })();

  /* ── reveal on scroll ── */
  (function reveal() {
    const els = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window) || reduceMotion) {
      els.forEach((el) => el.classList.add("in"));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        en.target.classList.add("in");
        io.unobserve(en.target);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    els.forEach((el) => io.observe(el));
  })();

  /* ── screen tour (home) ── */
  (function tour() {
    const tourEl = document.querySelector(".tour");
    if (!tourEl) return;
    const tabs = Array.from(tourEl.querySelectorAll(".tour-tab"));
    const stage = tourEl.querySelector(".tour-stage");
    const panes = Array.from(tourEl.querySelectorAll(".tour-pane"));
    const select = (tab) => {
      tabs.forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
      panes.forEach((p) => { p.hidden = p.dataset.pane !== tab.dataset.pane; });
      stage.dataset.accent = tab.dataset.accent;
    };
    tabs.forEach((tab, i) => {
      tab.addEventListener("click", () => select(tab));
      tab.addEventListener("keydown", (e) => {
        const step = (e.key === "ArrowDown" || e.key === "ArrowRight") ? 1
          : (e.key === "ArrowUp" || e.key === "ArrowLeft") ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        const next = tabs[(i + step + tabs.length) % tabs.length];
        next.focus();
        select(next);
      });
    });
    // Synth pane: section buttons swap the screenshot.
    tourEl.querySelectorAll(".subtabs").forEach((group) => {
      // The image node is replaced on every switch (to replay its entrance),
      // so keep hold of the one currently in the page.
      let img = tourEl.querySelector(group.dataset.target);
      const note = tourEl.querySelector(group.dataset.note);
      group.querySelectorAll(".subtab").forEach((btn) => {
        btn.addEventListener("click", () => {
          group.querySelectorAll(".subtab").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
          const fresh = img.cloneNode();
          fresh.src = btn.dataset.src;
          fresh.alt = btn.dataset.alt;
          img.replaceWith(fresh);
          img = fresh;
          if (note) note.textContent = btn.dataset.caption;
        });
      });
    });
  })();

  /* ── canvas helpers ── */
  function fit(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return { w, h, dpr, ctx: canvas.getContext("2d") };
  }

  /* ── pulsar maths shared by the hero trace and the explorer ── */
  const SHAPES = {
    sine: (p) => Math.sin(2 * Math.PI * p),
    triangle: (p) => { const q = (p + 0.25) % 1; return 1 - 4 * Math.abs(q - 0.5); },
    saw: (p) => 2 * (p % 1) - 1,
    square: (p) => ((p % 1) < 0.5 ? 1 : -1)
  };
  const WINDOWS = {
    soft: (x) => Math.exp(-0.5 * Math.pow((x - 0.5) / 0.17, 2)),
    round: (x) => 0.5 - 0.5 * Math.cos(2 * Math.PI * x),
    pluck: (x) => Math.exp(-5 * x) * Math.min(1, x * 60),
    hard: (x) => Math.min(1, x * 80, (1 - x) * 80)
  };
  // One pulse period, x in 0..1: a windowed burst of the pulsaret, then silence.
  function pulsarAt(x, o) {
    if (x >= o.duty) return 0;
    const g = x / o.duty;
    const cycles = Math.max(0.5, (o.formant / o.pitch) * o.duty);
    return SHAPES[o.shape](g * cycles) * WINDOWS[o.window](g);
  }

  /* ── hero: a slow pulsar train drifting behind the headline ── */
  (function hero() {
    const canvas = document.querySelector(".hero-canvas");
    if (!canvas) return;
    let raf = 0;
    const draw = (ms) => {
      const { w, h, ctx } = fit(canvas);
      const t = ms / 1000;
      ctx.clearRect(0, 0, w, h);
      const periods = 9;
      const o = {
        pitch: 1, shape: "sine", window: "soft",
        duty: 0.34 + 0.2 * Math.sin(t * 0.21),
        formant: 5 + 3.2 * Math.sin(t * 0.13)
      };
      const mid = h * 0.3, amp = h * 0.16;
      ctx.lineWidth = Math.max(1, w / 900);
      ctx.strokeStyle = SHOCK;
      ctx.shadowColor = SHOCK;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      for (let px = 0; px <= w; px += 2) {
        const pos = (px / w) * periods + t * 0.12;
        const idx = Math.floor(pos);
        const on = (idx % 7) !== 5; // one masked pulse now and then
        const y = on ? pulsarAt(pos - idx, o) : 0;
        if (px === 0) ctx.moveTo(px, mid - y * amp); else ctx.lineTo(px, mid - y * amp);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      // fade the trace out to the left and bottom so the text stays readable
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, "rgba(11,11,13,1)");
      g.addColorStop(0.45, "rgba(11,11,13,.55)");
      g.addColorStop(1, "rgba(11,11,13,0)");
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";
      if (!reduceMotion) raf = requestAnimationFrame(draw);
    };
    const io = new IntersectionObserver(([en]) => {
      cancelAnimationFrame(raf);
      if (en.isIntersecting) raf = requestAnimationFrame(draw);
    });
    io.observe(canvas);
  })();

  /* ── pulsar explorer ── */
  (function explorer() {
    const root = document.querySelector(".explorer");
    if (!root) return;
    const canvas = root.querySelector("canvas");
    const hearEl = root.querySelector("[data-hear]");
    const spanEl = root.querySelector("[data-span]");
    const listenBtn = root.querySelector(".listen");
    const state = { pitch: 8, formant: 220, duty: 0.4, shape: "sine", window: "soft", mask: "off" };
    const MASKS = { off: [1], "3:1": [1, 1, 1, 0], "2:2": [1, 1, 0, 0], "1:3": [1, 0, 0, 0] };
    const log = (min, max) => ({
      to: (v) => min * Math.pow(max / min, v / 1000),
      from: (x) => 1000 * Math.log(x / min) / Math.log(max / min)
    });
    const SCALES = { pitch: log(1, 440), formant: log(40, 3000), duty: { to: (v) => v / 100, from: (x) => x * 100 } };
    const fmt = {
      pitch: (v) => (v < 20 ? `${v.toFixed(1)} per sec` : `${Math.round(v)} Hz`),
      formant: (v) => `${Math.round(v)} Hz`,
      duty: (v) => `${Math.round(v * 100)}%`
    };

    function draw() {
      const { w, h, dpr, ctx } = fit(canvas);
      const pattern = MASKS[state.mask];
      const periods = pattern.length > 1 ? 8 : 4;
      ctx.clearRect(0, 0, w, h);
      const top = 30 * dpr, bottom = h - 26 * dpr, mid = (top + bottom) / 2, amp = (bottom - top) / 2 - 4 * dpr;
      // period grid + the "on" part of each period
      for (let k = 0; k < periods; k += 1) {
        const x0 = (k / periods) * w;
        const on = pattern[k % pattern.length] === 1;
        ctx.fillStyle = on ? "rgba(31,139,255,.10)" : "rgba(255,255,255,.02)";
        ctx.fillRect(x0, top, (w / periods) * state.duty, bottom - top);
        ctx.fillStyle = "rgba(233,227,214,.16)";
        ctx.fillRect(x0, top - 6 * dpr, dpr, bottom - top + 12 * dpr);
      }
      ctx.fillStyle = "rgba(233,227,214,.12)";
      ctx.fillRect(0, mid, w, dpr);
      // labels under the first period
      ctx.font = `${10 * dpr}px Menlo, monospace`;
      ctx.fillStyle = "rgba(154,153,164,.95)";
      const pw = w / periods;
      ctx.fillText("PULSARET", 4 * dpr, h - 8 * dpr);
      if (state.duty < 0.8 && pw * (1 - state.duty) > 56 * dpr) ctx.fillText("SILENCE", pw * state.duty + 4 * dpr, h - 8 * dpr);
      // the wave
      ctx.strokeStyle = SHOCK;
      ctx.lineWidth = 1.6 * dpr;
      ctx.lineJoin = "round";
      ctx.shadowColor = SHOCK;
      ctx.shadowBlur = 8 * dpr;
      ctx.beginPath();
      const stepPx = 1;
      for (let px = 0; px <= w; px += stepPx) {
        const pos = (px / w) * periods;
        const k = Math.min(periods - 1, Math.floor(pos));
        const y = pattern[k % pattern.length] ? pulsarAt(pos - k, state) : 0;
        if (px === 0) ctx.moveTo(px, mid - y * amp); else ctx.lineTo(px, mid - y * amp);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      const spanMs = (periods / state.pitch) * 1000;
      spanEl.textContent = spanMs >= 1000 ? `${(spanMs / 1000).toFixed(2)} s shown` : `${spanMs.toFixed(spanMs < 20 ? 1 : 0)} ms shown`;
      const rate = state.pitch;
      let hear;
      if (rate < 12) hear = "a <b>rhythm</b> of separate ticks, each one coloured by the formant";
      else if (rate < 30) hear = "a <b>flutter</b>: too fast to count, too slow to be a note";
      else hear = `a <b>note</b> at ${Math.round(rate)} Hz with a resonance near ${Math.round(state.formant)} Hz`;
      if (pattern.length > 1 && rate >= 30) hear += `, plus an undertone two octaves below from the burst pattern`;
      hearEl.innerHTML = `You would hear ${hear}.`;
    }

    /* audio: one burst pattern rendered into a looping buffer */
    let ac = null, gain = null, src = null, playing = false, rebuildTimer = 0;
    function render() {
      const pattern = MASKS[state.mask];
      const sr = ac.sampleRate;
      const periodLen = Math.max(8, Math.round(sr / state.pitch));
      const buf = ac.createBuffer(1, periodLen * pattern.length, sr);
      const data = buf.getChannelData(0);
      const edge = Math.min(48, Math.floor(periodLen * state.duty / 4)); // soften hard edges
      for (let k = 0; k < pattern.length; k += 1) {
        if (!pattern[k]) continue;
        const onLen = Math.floor(periodLen * state.duty);
        for (let i = 0; i < onLen; i += 1) {
          let y = pulsarAt(i / periodLen, state);
          if (edge > 0) y *= Math.min(1, i / edge, (onLen - 1 - i) / edge);
          data[k * periodLen + i] = y * 0.5;
        }
      }
      return buf;
    }
    function startSource() {
      const next = ac.createBufferSource();
      next.buffer = render();
      next.loop = true;
      next.connect(gain);
      next.start();
      if (src) { const old = src; try { old.stop(ac.currentTime + 0.03); } catch (_e) { /* already stopped */ } }
      src = next;
    }
    function setPlaying(on) {
      playing = on;
      listenBtn.setAttribute("aria-pressed", String(on));
      listenBtn.textContent = on ? "Stop" : "Listen";
      if (on) {
        if (!ac) {
          ac = new (window.AudioContext || window.webkitAudioContext)();
          gain = ac.createGain();
          gain.gain.value = 0;
          gain.connect(ac.destination);
        }
        ac.resume();
        startSource();
        gain.gain.setTargetAtTime(0.5, ac.currentTime, 0.03);
      } else if (ac) {
        gain.gain.setTargetAtTime(0, ac.currentTime, 0.03);
        const old = src; src = null;
        if (old) { try { old.stop(ac.currentTime + 0.25); } catch (_e) { /* already stopped */ } }
      }
    }
    function changed() {
      draw();
      if (!playing) return;
      clearTimeout(rebuildTimer);
      rebuildTimer = setTimeout(startSource, 40);
    }

    root.querySelectorAll("input[type=range]").forEach((input) => {
      const key = input.dataset.key;
      const out = root.querySelector(`[data-val="${key}"]`);
      const sync = () => {
        state[key] = SCALES[key].to(Number(input.value));
        out.textContent = fmt[key](state[key]);
        const frac = (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min));
        input.style.setProperty("--fill", `${(frac * 100).toFixed(1)}%`);
      };
      input.value = String(SCALES[key].from(state[key]));
      sync();
      input.addEventListener("input", () => { sync(); changed(); });
    });
    root.querySelectorAll(".opts").forEach((group) => {
      const key = group.dataset.key;
      group.querySelectorAll(".opt").forEach((btn) => {
        btn.classList.toggle("on", btn.dataset.value === state[key]);
        btn.setAttribute("aria-pressed", String(btn.dataset.value === state[key]));
        btn.addEventListener("click", () => {
          state[key] = btn.dataset.value;
          group.querySelectorAll(".opt").forEach((b) => {
            b.classList.toggle("on", b === btn);
            b.setAttribute("aria-pressed", String(b === btn));
          });
          changed();
        });
      });
    });
    listenBtn.addEventListener("click", () => setPlaying(!playing));
    document.addEventListener("visibilitychange", () => { if (document.hidden && playing) setPlaying(false); });
    window.addEventListener("pagehide", () => { if (playing) setPlaying(false); });
    window.addEventListener("resize", draw);
    draw();
  })();

  /* ── small static figures on the pulsar page ── */
  document.querySelectorAll("canvas[data-fig]").forEach((canvas) => {
    const kind = canvas.dataset.fig;
    const paint = () => {
      const { w, h, dpr, ctx } = fit(canvas);
      ctx.clearRect(0, 0, w, h);
      const line = (color, fn, y0, amp, width) => {
        ctx.strokeStyle = color; ctx.lineWidth = (width || 1.5) * dpr; ctx.lineJoin = "round";
        ctx.shadowColor = color; ctx.shadowBlur = 6 * dpr;
        ctx.beginPath();
        for (let px = 0; px <= w; px += 1) {
          const y = y0 - fn(px / w) * amp;
          if (px === 0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
        }
        ctx.stroke(); ctx.shadowBlur = 0;
      };
      if (kind === "formants") {
        // three streams on one clock, each with its own formant
        const rows = [
          { c: SHOCK, f: 3 }, { c: css("--ok") || "#8fe39b", f: 6 }, { c: css("--ice") || "#cfe6ff", f: 11 }
        ];
        rows.forEach((r, i) => {
          const y0 = h * (0.22 + i * 0.28);
          line(r.c, (x) => {
            const pos = x * 4; const k = Math.floor(pos);
            return pulsarAt(pos - k, { pitch: 1, formant: r.f / 0.45, duty: 0.45, shape: "sine", window: "soft" });
          }, y0, h * 0.11);
        });
        for (let k = 1; k < 4; k += 1) { ctx.fillStyle = "rgba(233,227,214,.14)"; ctx.fillRect((k / 4) * w, 0, dpr, h); }
      } else if (kind === "windows") {
        const names = ["soft", "round", "pluck", "hard"];
        names.forEach((n, i) => {
          const x0 = i / 4, x1 = (i + 1) / 4;
          line(ACID, (x) => (x >= x0 + 0.02 && x <= x1 - 0.02 ? WINDOWS[n]((x - x0 - 0.02) / (0.25 - 0.04)) : 0), h * 0.86, h * 0.62, 1.2);
          line(SHOCK, (x) => {
            if (x < x0 + 0.02 || x > x1 - 0.02) return 0;
            const g = (x - x0 - 0.02) / (0.25 - 0.04);
            return Math.sin(2 * Math.PI * g * 5) * WINDOWS[n](g);
          }, h * 0.55, h * 0.3, 1.4);
        });
      } else if (kind === "masks") {
        const rows = [
          { label: "ALL PULSES", on: () => true },
          { label: "BURST 3 ON · 1 OFF", on: (k) => (k % 4) !== 3 },
          { label: "STOCHASTIC", on: (k) => [1, 0, 1, 1, 0, 0, 1, 1, 1, 0, 1, 0, 0, 1, 1, 1][k % 16] === 1 }
        ];
        const n = 16;
        rows.forEach((r, i) => {
          const y0 = h * (0.3 + i * 0.3);
          ctx.font = `${9.5 * dpr}px Menlo, monospace`;
          ctx.fillStyle = "rgba(154,153,164,.95)";
          ctx.fillText(r.label, 8 * dpr, y0 - h * 0.15);
          for (let k = 0; k < n; k += 1) {
            const on = r.on(k);
            ctx.fillStyle = on ? SHOCK : "rgba(233,227,214,.10)";
            const bw = (w - 16 * dpr) / n;
            ctx.fillRect(8 * dpr + k * bw, on ? y0 - h * 0.11 : y0 - 2 * dpr, bw * 0.34, on ? h * 0.11 : 2 * dpr);
          }
        });
      }
    };
    paint();
    window.addEventListener("resize", paint);
  });
})();

/* ── documentation: highlight the section being read in the contents list ── */
(function () {
  "use strict";
  const toc = document.querySelector(".doc-toc");
  if (!toc || !("IntersectionObserver" in window)) return;
  const links = new Map();
  toc.querySelectorAll("a[href^='#']").forEach((a) => links.set(a.getAttribute("href").slice(1), a));
  const visible = new Set();
  const order = Array.from(links.keys());
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) visible.add(en.target.id); else visible.delete(en.target.id); });
    const current = order.find((id) => visible.has(id));
    if (!current) return;
    links.forEach((a, id) => a.classList.toggle("on", id === current));
  }, { rootMargin: "-80px 0px -55% 0px" });
  order.forEach((id) => { const el = document.getElementById(id); if (el) io.observe(el); });
})();
