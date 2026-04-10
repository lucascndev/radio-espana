// ===== Constants =====
const VOLUME_STEP = 0.1;
const DEBOUNCE_MS = 500;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 1500;
const FOOTBALL_DATA_API_KEY = "YOUR_API_KEY_HERE";

const STATIONS = [
  { id: "cadenaser", name: "Cadena SER",  url: "https://23603.live.streamtheworld.com/CADENASER.mp3",           type: "audio/mpeg",                    logo: "logos/cadena_ser.png" },
  { id: "cope",      name: "COPE",        url: "https://flucast11-h-cloud.flumotion.com/cope/net1.mp3",         type: "audio/mpeg",                    logo: "logos/cope.png" },
  { id: "marca",     name: "Radio MARCA", url: "https://sonic.mediatelekom.net/9316/stream",                    type: "audio/mpeg",                    logo: "logos/marca.png" },
  { id: "ondacero",  name: "Onda Cero",   url: "https://atres-live.ondacero.es/live/ondacero/bitrate_1.m3u8",   type: "application/vnd.apple.mpegurl", logo: "logos/ondacero.svg" },
  { id: "rne",       name: "RNE Radio 1", url: "https://dispatcher.rndfnk.com/crtve/rne1/main/mp3/high",       type: "audio/mpeg",                    logo: "logos/RNE_2026.svg.png" },
  { id: "los40",     name: "Los 40",      url: "https://25693.live.streamtheworld.com/LOS40AAC_SC",             type: "audio/aac",                     logo: "logos/los40.png" },
];

// ===== SVG Icon Templates =====
const SVG_OPEN = '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
const SVG_SPEAKER = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>';

const VOLUME_ICONS = {
  muted:  `${SVG_OPEN}${SVG_SPEAKER}<line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`,
  low:    `${SVG_OPEN}${SVG_SPEAKER}<path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`,
  high:   `${SVG_OPEN}${SVG_SPEAKER}<path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>`,
};

// ===== State =====
let currentIndex = -1;
let hlsInstance = null;
let isSwitching = false;
let retryCount = 0;
let retryTimeout = null;
let isMuted = false;
let previousVolume = 1;

// ===== DOM References =====
const audio = document.getElementById("audio-player");
const stationList = document.querySelector(".station-list");
const stopBtn = document.getElementById("stop-btn");
const headerSubtitle = document.getElementById("header-subtitle");
const offlineBanner = document.getElementById("offline-banner");
const errorModal = document.getElementById("error-modal");
const errorMsg = document.getElementById("error-msg");
const retryBtn = document.getElementById("retry-btn");
const volDownBtn = document.getElementById("vol-down-btn");
const volUpBtn = document.getElementById("vol-up-btn");
const muteBtn = document.getElementById("mute-btn");
const volIndicator = document.getElementById("vol-indicator");
const clockEl = document.getElementById("digital-clock");

/** Collected button elements, one per station (populated during init). */
const buttons = [];

// ===== Utilities =====

/** Sort the last-played station to the top of the list. */
function promoteLastPlayed() {
  const lastId = localStorage.getItem("lastPlayedStationId");
  if (!lastId) return;

  const idx = STATIONS.findIndex((s) => s.id === lastId);
  if (idx > 0) {
    const fav = STATIONS.splice(idx, 1)[0];
    fav.isFav = true;
    STATIONS.unshift(fav);
  }
}

/** Trigger a short haptic buzz when supported. */
function triggerHaptic() {
  if ("vibrate" in navigator) {
    navigator.vibrate(50);
  }
}

/** Clamp a number between min and max. */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// ===== Clock =====

function updateClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  clockEl.textContent = `${hh}:${mm}`;
}

// ===== Connectivity =====

function setOfflineVisible(visible) {
  offlineBanner.classList.toggle("visible", visible);
}

// ===== Volume =====

function updateVolumeUI() {
  if (audio.volume === 0 || isMuted) {
    muteBtn.innerHTML = VOLUME_ICONS.muted;
    volIndicator.textContent = "0%";
  } else {
    muteBtn.innerHTML = audio.volume < 0.5 ? VOLUME_ICONS.low : VOLUME_ICONS.high;
    volIndicator.textContent = `${Math.round(audio.volume * 100)}%`;
  }
}

function saveVolume() {
  isMuted = audio.volume === 0;
  updateVolumeUI();
  localStorage.setItem("userVolume", audio.volume);
}

function loadSavedVolume() {
  const saved = localStorage.getItem("userVolume");
  audio.volume = saved !== null ? parseFloat(saved) : 1;
  updateVolumeUI();
}

function adjustVolume(delta) {
  triggerHaptic();
  audio.volume = clamp(Math.round((audio.volume + delta) * 10) / 10, 0, 1);
  saveVolume();
}

function toggleMute() {
  triggerHaptic();
  if (isMuted) {
    audio.volume = previousVolume > 0 ? previousVolume : 1;
    isMuted = false;
  } else {
    previousVolume = audio.volume;
    audio.volume = 0;
    isMuted = true;
  }
  updateVolumeUI();
  localStorage.setItem("userVolume", audio.volume);
}

// ===== Station UI =====

function buildStationButtons() {
  STATIONS.forEach((station, index) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "station-btn";
    btn.id = `station-${index}`;
    btn.setAttribute("aria-label", `Escuchar ${station.name}`);

    const starHtml = station.isFav ? 
      '<span class="last-played-badge"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg> Última vez</span>' : "";

    btn.innerHTML = `
      <img class="station-logo" src="${station.logo}" alt="${station.name}">
      <span class="station-text">
        <span class="station-name">${station.name}${starHtml}</span>
        <span class="status-text" aria-live="polite"></span>
        <div class="playing-indicator"><div></div><div></div><div></div><div></div></div>
      </span>`;

    btn.addEventListener("click", () => {
      if (!isSwitching) playStation(index);
    });

    stationList.appendChild(btn);
    buttons.push(btn);
  });
}

function resetAllButtons() {
  buttons.forEach((btn) => {
    btn.classList.remove("playing", "loading");
    btn.querySelector(".status-text").textContent = "";
  });
  headerSubtitle.textContent = "Pulsa una emisora para escuchar";
}

function setStopBtnEnabled(enabled) {
  stopBtn.classList.toggle("disabled", !enabled);
  stopBtn.disabled = !enabled;
}

function setButtonState(btn, state, statusText) {
  btn.classList.remove("playing", "loading");
  if (state) btn.classList.add(state);
  btn.querySelector(".status-text").textContent = statusText;
}

// ===== Error UI =====

function showError(message) {
  errorMsg.textContent = message;
  errorModal.classList.add("visible");
}

function hideError() {
  errorModal.classList.remove("visible");
}

// ===== Audio Core =====

function destroyHls() {
  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }
}

function resetAudioElement() {
  while (audio.firstChild) audio.removeChild(audio.firstChild);
  audio.removeAttribute("src");
}

function stopAudioCore() {
  if (retryTimeout) clearTimeout(retryTimeout);
  audio.pause();
  destroyHls();
  resetAudioElement();
  audio.load();
  clearMediaSession();
}

function stopAll() {
  triggerHaptic();
  stopAudioCore();
  resetAllButtons();
  setStopBtnEnabled(false);
  hideError();
  currentIndex = -1;
  retryCount = 0;
}

// ===== Stream Playback =====

function isHlsStream(station) {
  return station.url.endsWith(".m3u8") || station.type === "application/vnd.apple.mpegurl";
}

function startStream(index) {
  const station = STATIONS[index];
  resetAudioElement();

  if (isHlsStream(station)) {
    startHlsStream(station);
  } else {
    startDirectStream(station);
  }
}

function startHlsStream(station) {
  if (Hls.isSupported()) {
    hlsInstance = new Hls({ maxRetries: 0 }); // retries handled manually
    hlsInstance.loadSource(station.url);
    hlsInstance.attachMedia(audio);
    hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
      audio.play().catch(handlePlayError);
    });
    hlsInstance.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) handlePlayError(data);
    });
  } else if (audio.canPlayType("application/vnd.apple.mpegurl")) {
    // Native HLS support (Safari / iOS)
    audio.src = station.url;
    audio.load();
    audio.play().catch(handlePlayError);
  } else {
    showError("Esta emisora no es compatible con su dispositivo.");
  }
}

function startDirectStream(station) {
  const source = document.createElement("source");
  source.src = station.url;
  source.type = station.type;
  audio.appendChild(source);
  audio.load();
  audio.play().catch(handlePlayError);
}

function playStation(index) {
  if (!navigator.onLine) {
    setOfflineVisible(true);
    return;
  }

  // Ignore if already playing this station
  if (index === currentIndex && !audio.paused) return;

  triggerHaptic();

  // Debounce rapid taps
  isSwitching = true;
  buttons.forEach((b) => b.classList.add("disabled"));
  setTimeout(() => {
    isSwitching = false;
    buttons.forEach((b) => b.classList.remove("disabled"));
  }, DEBOUNCE_MS);

  stopAudioCore();
  hideError();
  resetAllButtons();

  const btn = buttons[index];
  setButtonState(btn, "loading", "Conectando...");
  headerSubtitle.textContent = `Conectando a ${STATIONS[index].name}...`;

  setStopBtnEnabled(true);
  currentIndex = index;
  localStorage.setItem("lastPlayedStationId", STATIONS[index].id);
  updateMediaSession(STATIONS[index].name);

  startStream(index);
}

// ===== Error Handling with Retries =====

function handlePlayError(err) {
  console.error("Play error:", err);
  if (currentIndex < 0) return;

  if (!navigator.onLine) {
    stopAudioCore();
    resetAllButtons();
    setStopBtnEnabled(false);
    return; // offline banner is already visible
  }

  if (retryCount < MAX_RETRIES) {
    retryCount++;
    const btn = buttons[currentIndex];
    setButtonState(btn, "loading", `Reconectando (${retryCount})...`);
    headerSubtitle.textContent = "Intentando reconectar...";

    const delay = retryCount * RETRY_BACKOFF_MS;
    if (retryTimeout) clearTimeout(retryTimeout);
    retryTimeout = setTimeout(() => {
      if (currentIndex >= 0) startStream(currentIndex);
    }, delay);
  } else {
    const name = STATIONS[currentIndex].name;
    stopAudioCore();
    resetAllButtons();
    setStopBtnEnabled(false);
    showError(`No se puede escuchar ${name}. Compruebe su conexion y pulse Reintentar.`);
  }
}

// ===== Audio Event Listeners =====

function markAsPlaying() {
  if (currentIndex < 0) return;
  retryCount = 0;

  const btn = buttons[currentIndex];
  setButtonState(btn, "playing", "Sonando...");
  headerSubtitle.textContent = `Escuchando: ${STATIONS[currentIndex].name}`;
  updateMediaSession(STATIONS[currentIndex].name);
}

audio.addEventListener("playing", markAsPlaying);

audio.addEventListener("timeupdate", () => {
  if (currentIndex < 0) return;
  const btn = buttons[currentIndex];
  if (btn.classList.contains("loading") && !audio.paused && audio.currentTime > 0.5) {
    markAsPlaying();
  }
});

audio.addEventListener("error", () => handlePlayError("Native audio error"));

// ===== Media Session API =====

function updateMediaSession(stationName) {
  if (!("mediaSession" in navigator)) return;

  navigator.mediaSession.metadata = new MediaMetadata({
    title: stationName,
    artist: "Radio en Directo",
    album: "Radio Espana",
  });

  navigator.mediaSession.setActionHandler("play", () => {
    if (audio.paused && currentIndex >= 0) audio.play();
  });

  navigator.mediaSession.setActionHandler("pause", () => {
    if (!audio.paused) {
      audio.pause();
      const btn = buttons[currentIndex];
      if (btn) setButtonState(btn, "loading", "En pausa");
    }
  });

  navigator.mediaSession.setActionHandler("stop", stopAll);
}

function clearMediaSession() {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = null;
  navigator.mediaSession.setActionHandler("play", null);
  navigator.mediaSession.setActionHandler("pause", null);
  navigator.mediaSession.setActionHandler("stop", null);
}

// ===== Service Worker =====

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.warn("SW registration failed:", err);
    });
  }
}

// ===== Real Madrid Match Ticker =====

async function fetchRealMadridNextMatch() {
  const tickerEl = document.getElementById("match-ticker");
  if (!tickerEl) return;

  const cacheKey = "real_madrid_next_match";
  const cacheTimeKey = "real_madrid_next_match_time";
  
  // Custom Date formatter (Spanish)
  const formatMatchDate = (isoString) => {
    const d = new Date(isoString);
    const options = { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' };
    let formatted = d.toLocaleDateString("es-ES", options);
    // Capitalize first letter of weekday
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
  };

  const renderTicker = (match) => {
    const isHome = match.homeTeam.id === 86; // Real Madrid ID is 86
    const opponent = isHome ? match.awayTeam.name : match.homeTeam.name;
    const locationStr = isHome ? "Local" : "Visitante";
    const compName = match.competition.name || "Partido";
    
    tickerEl.innerHTML = `
      <div class="ticker-content">
        <span class="ticker-comp">${compName}</span>
        <span class="ticker-teams">Real Madrid vs ${opponent.replace(" CF", "").replace(" FC", "")}</span>
        <span class="ticker-date">${formatMatchDate(match.utcDate)} (${locationStr})</span>
      </div>
    `;
    tickerEl.classList.add("visible");
  };

  try {
    const now = Date.now();
    const cachedData = localStorage.getItem(cacheKey);
    const cachedTime = localStorage.getItem(cacheTimeKey);

    // Use cache if less than 24 hours (86400000 ms) old
    if (cachedData && cachedTime && (now - parseInt(cachedTime)) < 86400000) {
      renderTicker(JSON.parse(cachedData));
      return;
    }

    // If running logically on local dev, use direct API, otherwise fetch our GitHub Action generated data file.
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    
    let fetchUrl, fetchHeaders;
    if (isLocal) {
      fetchUrl = "https://api.football-data.org/v4/teams/86/matches?status=SCHEDULED";
      fetchHeaders = { "X-Auth-Token": FOOTBALL_DATA_API_KEY };
    } else {
      // In production (GitHub Pages), the GitHub Action silently generates this static JSON file to bypass CORS completely
      fetchUrl = "data/schedule.json?t=" + Date.now();
      fetchHeaders = {};
    }

    const response = await fetch(fetchUrl, { headers: fetchHeaders });

    if (!response.ok) throw new Error("API request failed");
    
    const data = await response.json();
    if (data.matches && data.matches.length > 0) {
      const nextMatch = data.matches[0];
      
      // Save cache
      localStorage.setItem(cacheKey, JSON.stringify(nextMatch));
      localStorage.setItem(cacheTimeKey, now.toString());
      
      renderTicker(nextMatch);
    }
  } catch (error) {
    console.warn("Failed to fetch Real Madrid match schedule", error);
    // Fail silently so we don't disrupt the radio app
  }
}

// ===== Initialization =====

function init() {
  registerServiceWorker();
  promoteLastPlayed();
  loadSavedVolume();
  buildStationButtons();
  updateClock();
  setInterval(updateClock, 1000);

  // Connectivity handlers
  window.addEventListener("online", () => {
    setOfflineVisible(false);
    fetchRealMadridNextMatch(); // Try fetching again if we just came online
  });
  window.addEventListener("offline", () => setOfflineVisible(true));
  if (!navigator.onLine) setOfflineVisible(true); else fetchRealMadridNextMatch();

  // Volume controls
  volDownBtn.addEventListener("click", () => adjustVolume(-VOLUME_STEP));
  volUpBtn.addEventListener("click", () => adjustVolume(VOLUME_STEP));
  muteBtn.addEventListener("click", toggleMute);

  // Stop button
  stopBtn.addEventListener("click", () => {
    if (!stopBtn.disabled) stopAll();
  });

  // Retry button
  retryBtn.addEventListener("click", () => {
    triggerHaptic();
    hideError();
    if (currentIndex >= 0) {
      retryCount = 0;
      playStation(currentIndex);
    }
  });
}

init();
