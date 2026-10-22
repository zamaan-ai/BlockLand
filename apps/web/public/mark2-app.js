// BlockLand Mark 2 — Live Map + Interactions
(() => {
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  // ---------- Toast ----------
  const toastEl = $("#toast");
  const notify = (msg, ms = 2800) => {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.remove("show"), ms);
  };

  const menuToggle = document.querySelector(".menu-toggle");
  const topbarNav = document.querySelector(".topbar nav");
  if (menuToggle && topbarNav) {
    menuToggle.addEventListener("click", () => {
      const isOpen = topbarNav.classList.toggle("open");
      menuToggle.setAttribute("aria-expanded", String(isOpen));
    });
    topbarNav.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        if (window.innerWidth <= 900) {
          topbarNav.classList.remove("open");
          menuToggle.setAttribute("aria-expanded", "false");
        }
      });
    });
  }

  // ---------- API integration ----------

  // ---------- Auth session ----------
  const TOKEN_KEY = "bl_access";
  const USER_KEY = "bl_user";

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  }
  function getUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || "null"); } catch { return null; }
  }
  function setSession(accessToken, user) {
    localStorage.setItem(TOKEN_KEY, accessToken);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    updateAuthUI();
  }
  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    updateAuthUI();
  }
  function authHeaders(json = true) {
    const h = {};
    if (json) h["Content-Type"] = "application/json";
    const t = getToken();
    if (t) h["Authorization"] = "Bearer " + t;
    return h;
  }
  function updateAuthUI() {
    const user = getUser();
    const profile = document.querySelector("a.profile");
    const wallet = document.getElementById("walletBtn");
    if (profile) {
      if (user) {
        const dashboardPath = user.role === "ADMIN" ? "/admin"
          : user.role === "GOVERNMENT" ? "/government"
          : "/dashboard";
        profile.textContent = "Dashboard";
        profile.href = dashboardPath;
        profile.onclick = null;
      } else {
        profile.innerHTML = 'Create profile <span>↗</span>';
        profile.href = "#portal";
        profile.onclick = (e) => {
          e.preventDefault();
          openAuthModal("register");
        };
      }
    }
    if (wallet && !wallet._blBound) {
      wallet._blBound = true;
      wallet.addEventListener("click", () => {
        if (getUser()) notify("Signed in as " + getUser().email);
        else openAuthModal("login");
      });
    }
  }

  let authMode = "login";
  function openAuthModal(mode) {
    authMode = mode || "login";
    const modal = $("#authModal");
    if (!modal) return;
    $("#authModalTitle").textContent = authMode === "login" ? "Sign in" : "Create profile";
    $("#authModalSub").textContent = authMode === "login" ? "Use your BlockLand account" : "Register to request visits and save activity";
    const nameLabel = $("#authName")?.closest("label");
    if (nameLabel) nameLabel.style.display = authMode === "register" ? "" : "none";
    $("#authSubmitBtn").textContent = authMode === "login" ? "Sign in" : "Register";
    $("#authToggleMode").textContent = authMode === "login" ? "Need an account? Register" : "Already have an account? Sign in";
    openModal("#authModal");
  }

  async function apiPost(path, body) {
    const res = await fetch(API_BASE + path, {
      method: "POST",
      headers: authHeaders(true),
      credentials: "include",
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || json.message || "Request failed (" + res.status + ")");
    return json;
  }


  const API_BASE = (typeof window !== "undefined" && window.__BLOCKLAND_API__) || "http://localhost:4001";

  function mapStatus(apiStatus) {
    const s = String(apiStatus || "").toUpperCase();
    if (s === "VERIFIED") return { status: "verified", statusLabel: "✓ Government verified" };
    if (s === "PENDING") return { status: "submitted", statusLabel: "Owner submitted" };
    if (s === "TRANSFERRED") return { status: "blockchain", statusLabel: "◈ Blockchain recorded" };
    if (s === "REJECTED") return { status: "submitted", statusLabel: "Rejected" };
    return { status: "submitted", statusLabel: String(apiStatus || "Unknown") };
  }

  function demoImageUrl(value) {
    return typeof value === "string" && /^\/images\/demo-(?:plots|projects)\/[a-z0-9-]+\.svg$/i.test(value)
      ? value
      : "";
  }

  function landToPlot(land) {
    const st = mapStatus(land.status);
    const hasChain = !!(land.blockchainTxHash || land.tokenId);
    if (hasChain && st.status === "verified") {
      st.status = "blockchain";
      st.statusLabel = "◈ Blockchain recorded";
    }
    // Prefer blockchain badge when verified + on-chain (Mark2 style: both can show; map uses one)
    if (land.status === "VERIFIED" && hasChain) {
      st.status = "verified";
      st.statusLabel = "✓ Government verified";
    }
    return {
      id: land.plotId,
      title: land.title,
      location: [land.village, land.district || land.state].filter(Boolean).join(", "),
      lat: land.latitude != null ? Number(land.latitude) : null,
      lng: land.longitude != null ? Number(land.longitude) : null,
      approximateLocation: land.metadata?.locationPrecision === "DISTRICT_APPROXIMATE",
      status: st.status,
      statusLabel: st.statusLabel,
      area: land.area != null ? `${land.area} acres` : "",
      imageUrl: demoImageUrl(land.metadata?.imageUrl),
      raw: land,
    };
  }

  async function fetchLandsFromApi() {
    const res = await fetch(`${API_BASE}/api/v1/lands`, { credentials: "include" });
    if (!res.ok) throw new Error("Registry API returned " + res.status);
    const json = await res.json();
    const list = json?.data?.lands || json?.data || [];
    if (!Array.isArray(list)) throw new Error("Registry API returned an invalid land list");
    return list.map(landToPlot);
  }

  const LIVE_REFRESH_MS = 60_000;
  let LIVE_LANDS = [];

  function setMapLiveStatus(state, message) {
    const status = $("#mapLiveStatus");
    if (!status) return;
    status.dataset.state = state;
    const label = status.querySelector("span");
    if (label) label.textContent = message;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
  }

  function renderLiveLandCards(plots) {
    const list = $(".land-list");
    if (!list) return;
    const cards = plots.map((plot) => {
      const hasCoordinates = Number.isFinite(plot.lat) && Number.isFinite(plot.lng);
      const location = plot.location || "Location not provided";
      const image = plot.imageUrl
        ? `<img class="land-image" src="${escapeHtml(plot.imageUrl)}" alt="Illustrative demo image for ${escapeHtml(plot.title)}" loading="lazy" />`
        : "";
      const directionButton = hasCoordinates
        ? plot.approximateLocation
          ? `<span class="land-location-note">Approximate district pin</span>`
          : `<button class="button ghost small" data-direction data-lat="${plot.lat}" data-lng="${plot.lng}">Directions</button>`
        : `<span class="land-location-note">Map pin unavailable</span>`;
      return `
        <article class="land-card compact" data-plot="${escapeHtml(plot.id)}">
          ${image}
          <div class="status-row">
            <span class="status ${escapeHtml(plot.status)}">${escapeHtml(plot.statusLabel)}</span>
            <button class="save-btn" aria-label="Save ${escapeHtml(plot.id)}">♡</button>
          </div>
          <p class="mono">${escapeHtml(plot.id)}${plot.area ? ` · ${escapeHtml(plot.area)}` : ""}</p>
          <h3>${escapeHtml(plot.title)}</h3>
          <p class="location">${escapeHtml(location)}</p>
          ${plot.approximateLocation ? '<p class="land-location-note">Approximate district location · illustrative, not an exact plot boundary</p>' : ""}
          <div class="card-actions">
            <a href="/land/${encodeURIComponent(plot.id)}/verify" class="button small">Verify record →</a>
            <button class="button ghost small" data-open-modal="#visitModal">Request visit</button>
            ${directionButton}
          </div>
        </article>`;
    }).join("");
    list.innerHTML = `${cards || '<p class="land-empty">No parcels are currently listed in the registry.</p>'}<a class="view-more" href="#explore">Browse all verified land <span>→</span></a>`;
  }

  async function refreshLiveRegistry() {
    setMapLiveStatus("loading", "Refreshing registry…");
    try {
      const plots = await fetchLandsFromApi();
      LIVE_LANDS = plots;
      PLOTS.splice(0, PLOTS.length, ...plots.filter((plot) => Number.isFinite(plot.lat) && Number.isFinite(plot.lng)));
      renderLiveLandCards(plots);
      renderMapMarkers();
      setMapLiveStatus("live", `Live registry · ${plots.length} parcels · updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
      return true;
    } catch (error) {
      console.warn("[BlockLand] Live registry refresh failed:", error);
      setMapLiveStatus(LIVE_LANDS.length ? "stale" : "offline", LIVE_LANDS.length ? "Showing last registry update" : "Registry unavailable · showing sample map");
      return false;
    }
  }

  async function fetchProjectsFromApi() {
    try {
      const res = await fetch(`${API_BASE}/api/v1/projects`, { credentials: "include" });
      if (!res.ok) throw new Error("API " + res.status);
      const json = await res.json();
      return json?.data?.projects || [];
    } catch (e) {
      console.warn("[BlockLand] API projects unavailable:", e.message);
      return [];
    }
  }

  
  function renderLandCardsFromApi(plots) {
    const byId = Object.fromEntries(plots.map((p) => [p.id, p]));
    document.querySelectorAll("[data-plot]").forEach((el) => {
      const id = el.getAttribute("data-plot");
      const p = byId[id];
      if (!p) return;
      const h3 = el.querySelector("h3");
      const meta = el.querySelector(".mono, .plot-meta, p.mono");
      const badge = el.querySelector(".badge, .status-pill, .pill");
      if (h3) h3.textContent = p.title;
      if (meta) meta.textContent = `${p.id} · ${p.area || ""}`.trim();
      if (badge) badge.textContent = p.statusLabel;
    });
    // Update featured explore list items that match by title fragment
    document.querySelectorAll(".land-card h3").forEach((h3) => {
      const match = plots.find((p) => h3.textContent && p.title.includes(h3.textContent.slice(0, 12)));
      // already handled via data-plot when present
    });
  }


  function renderProjectsFromApi(projects) {
    const section = document.getElementById("projects");
    if (!section || !projects.length) return;
    const cards = section.querySelectorAll(".project, .project-card, .card");
    projects.slice(0, 4).forEach((project, i) => {
      const card = Array.from(cards).find((item) => item.querySelector("h3")?.textContent?.trim() === project.title) || cards[i];
      if (!card) return;
      const title = card.querySelector("h3, .project-title, strong");
      const desc = card.querySelector("p, .project-desc");
      const status = card.querySelector(".badge, .status, .pill");
      const imageUrl = demoImageUrl(project.coverImageUrl || project.imageUrl);
      if (title) title.textContent = project.title;
      if (desc) desc.textContent = project.description || "";
      if (status && project.status) status.textContent = project.status === "ACTIVE" ? "Active" : project.status === "PLANNING" ? "Planned" : project.status;
      if (imageUrl && !card.querySelector(".project-image")) {
        const image = document.createElement("img");
        image.className = "project-image";
        image.src = imageUrl;
        image.alt = "";
        image.loading = "lazy";
        card.prepend(image);
      }
    });
  }


  // ---------- Sample plots ----------
  const PLOTS = [
    {
      id: "BL-00372",
      title: "2.4 acres near Financial District",
      location: "Nanakramguda, Hyderabad",
      lat: 17.4412,
      lng: 78.3489,
      status: "verified",
      statusLabel: "✓ Government verified",
      area: "2.4 acres",
    },
    {
      id: "BL-00841",
      title: "Greenfield parcel, Sector 79",
      location: "Gurugram",
      lat: 28.4089,
      lng: 77.0677,
      status: "blockchain",
      statusLabel: "◈ Blockchain recorded",
      area: "1.2 acres",
    },
    {
      id: "BL-01120",
      title: "ORR frontage plot",
      location: "Bengaluru",
      lat: 12.9716,
      lng: 77.5946,
      status: "verified",
      statusLabel: "✓ Government verified",
      area: "3.1 acres",
    },
  ];

  const DEFAULT_CENTER = [17.4412, 78.3489]; // Hyderabad Financial District
  const DEFAULT_ZOOM = 13;

  // ---------- Leaflet Map ----------
  let map, markersLayer, routeLayer, activeMarker;
  let streetsLayer, satelliteLayer, hybridLayer;

  function renderMapMarkers() {
    if (!markersLayer) return;
    markersLayer.clearLayers();
    PLOTS.forEach((plot) => {
      if (!Number.isFinite(plot.lat) || !Number.isFinite(plot.lng)) return;
      const icon = L.divIcon({
        className: "",
        html: `<div class="plot-marker ${escapeHtml(plot.status)}"><span>${escapeHtml(plot.id)}</span><small>${escapeHtml(plot.statusLabel.replace(/^[^ ]+ /, ""))}</small></div>`,
        iconSize: [110, 40],
        iconAnchor: [55, 40],
      });

      const marker = L.marker([plot.lat, plot.lng], { icon }).addTo(markersLayer);
      const popupHtml = `
        <strong>${escapeHtml(plot.id)}</strong>
        ${escapeHtml(plot.title)}<br>
        <small>${escapeHtml(plot.location)} · ${escapeHtml(plot.area)}</small>
        ${plot.approximateLocation ? '<br><small>Approximate district location · illustrative pin</small>' : ""}
        <div class="status ${escapeHtml(plot.status)}">${escapeHtml(plot.statusLabel)}</div>
        <div class="popup-actions">
          <a href="/land/${encodeURIComponent(plot.id)}/verify" class="button small">Verify record</a>
          ${plot.approximateLocation ? "" : `<button class="button ghost small popup-dir" data-lat="${plot.lat}" data-lng="${plot.lng}">Directions</button>
          <button class="button ghost small popup-sv" data-lat="${plot.lat}" data-lng="${plot.lng}">Street View</button>`}
        </div>
      `;
      marker.bindPopup(popupHtml);
      marker.on("popupopen", () => {
        setTimeout(() => {
          $$(".popup-dir").forEach((btn) => {
            btn.onclick = () => openDirectionsTo(+btn.dataset.lat, +btn.dataset.lng);
          });
          $$(".popup-sv").forEach((btn) => {
            btn.onclick = () => openStreetView(+btn.dataset.lat, +btn.dataset.lng);
          });
        }, 50);
      });
    });
  }

  function initMap() {
    map = L.map("map", {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
    });

    const cartoKey = window.__BLOCKLAND_CARTO_BASEMAPS_KEY__?.trim();
    const cartoTileUrl = (style) =>
      `https://{s}.basemaps.cartocdn.com/rastertiles/${style}/{z}/{x}/{y}{r}.png${cartoKey ? `?key=${encodeURIComponent(cartoKey)}` : ""}`;

    // Base layers — keyed CARTO tiles + Esri satellite
    streetsLayer = L.tileLayer(cartoTileUrl("voyager"), {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 20,
    });

    satelliteLayer = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        attribution: "Tiles &copy; Esri",
        maxZoom: 19,
      }
    );

    // Hybrid = satellite + labels
    const labelsLayer = L.tileLayer(cartoTileUrl("voyager_only_labels"), { subdomains: "abcd", maxZoom: 20, opacity: 0.85 });
    hybridLayer = L.layerGroup([
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        attribution: "Tiles &copy; Esri", maxZoom: 19
      }),
      labelsLayer
    ]);

    streetsLayer.addTo(map);

    // Markers layer
    markersLayer = L.layerGroup().addTo(map);
    routeLayer = L.layerGroup().addTo(map);

    renderMapMarkers();
    const locatedPlots = PLOTS.filter((plot) => Number.isFinite(plot.lat) && Number.isFinite(plot.lng));
    if (LIVE_LANDS.length && locatedPlots.length > 1) {
      map.fitBounds(locatedPlots.map((plot) => [plot.lat, plot.lng]), { padding: [36, 36], maxZoom: 12 });
    }

    // Basemap switcher
    function setBasemap(name) {
      [streetsLayer, satelliteLayer, hybridLayer].forEach((l) => {
        if (map.hasLayer(l)) map.removeLayer(l);
      });
      if (name === "streets") streetsLayer.addTo(map);
      else if (name === "satellite") satelliteLayer.addTo(map);
      else hybridLayer.addTo(map);
    }
    $$("#basemapTabs button").forEach((btn) => {
      btn.addEventListener("click", () => {
        $$("#basemapTabs button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        setBasemap(btn.dataset.layer);
      });
    });

    // Toolbar buttons
    $("#btnLocate")?.addEventListener("click", locateUser);
    $("#btnDirections")?.addEventListener("click", () => {
      const panel = $("#directionsPanel");
      panel.hidden = !panel.hidden;
      if (!panel.hidden) $("#dirTo").focus();
    });
    $("#btnStreetView")?.addEventListener("click", () => {
      const c = map.getCenter();
      openStreetView(c.lat, c.lng);
    });
    $("#btnReset")?.addEventListener("click", () => {
      const locatedPlots = PLOTS.filter((plot) => Number.isFinite(plot.lat) && Number.isFinite(plot.lng));
      if (locatedPlots.length > 1) {
        map.fitBounds(locatedPlots.map((plot) => [plot.lat, plot.lng]), { padding: [36, 36], maxZoom: 12 });
      } else {
        map.setView(locatedPlots.length ? [locatedPlots[0].lat, locatedPlots[0].lng] : DEFAULT_CENTER, DEFAULT_ZOOM);
      }
      routeLayer.clearLayers();
      notify("Map view reset");
    });

    // Map search
    $("#mapSearchBtn")?.addEventListener("click", () => doMapSearch());
    $("#mapSearch")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doMapSearch();
    });

    // Directions panel
    $("#closeDirections")?.addEventListener("click", () => {
      $("#directionsPanel").hidden = true;
    });
    $("#getDirectionsBtn")?.addEventListener("click", getRoute);

    // Hero / global search also pans map when relevant
    $("#searchButton")?.addEventListener("click", () => {
      const q = $("#search").value.trim();
      if (q) {
        // Try to find matching plot first
        const match = PLOTS.find(
          (p) =>
            p.id.toLowerCase().includes(q.toLowerCase()) ||
            p.location.toLowerCase().includes(q.toLowerCase()) ||
            p.title.toLowerCase().includes(q.toLowerCase())
        );
        if (match) {
          map.setView([match.lat, match.lng], 15);
          notify(`Showing ${match.id} on map`);
          document.getElementById("explore")?.scrollIntoView({ behavior: "smooth" });
        } else {
          geocodeAndFly(q);
        }
      } else {
        notify("Enter a city, plot ID or landmark");
      }
    });
  }

  // ---------- Geocoding (Nominatim) ----------
  async function geocode(query) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
    const res = await fetch(url, {
      headers: { "Accept-Language": "en", "User-Agent": "BlockLand-Demo/2.0" },
    });
    const data = await res.json();
    if (data && data[0]) {
      return { lat: +data[0].lat, lng: +data[0].lon, display: data[0].display_name };
    }
    return null;
  }

  async function doMapSearch() {
    const q = $("#mapSearch").value.trim();
    if (!q) return notify("Enter a place to search");
    notify("Searching…");
    try {
      const result = await geocode(q);
      if (result) {
        map.setView([result.lat, result.lng], 15);
        L.popup()
          .setLatLng([result.lat, result.lng])
          .setContent(`<strong>${result.display}</strong>`)
          .openOn(map);
        notify(`Found: ${result.display.split(",")[0]}`);
      } else {
        notify("No results found");
      }
    } catch (err) {
      notify("Search failed — check connection");
      console.error(err);
    }
  }

  async function geocodeAndFly(q) {
    notify("Searching map…");
    try {
      const result = await geocode(q);
      if (result) {
        map.setView([result.lat, result.lng], 14);
        document.getElementById("explore")?.scrollIntoView({ behavior: "smooth" });
        notify(`Showing ${result.display.split(",")[0]}`);
      } else {
        notify(`No map results for “${q}”`);
      }
    } catch {
      notify("Map search unavailable");
    }
  }

  // ---------- Directions (OSRM) ----------
  function openDirectionsTo(lat, lng) {
    const panel = $("#directionsPanel");
    panel.hidden = false;
    $("#dirTo").value = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    $("#dirFrom").value = "";
    $("#dirFrom").focus();
    map.setView([lat, lng], 14);
  }

  async function getRoute() {
    const fromRaw = $("#dirFrom").value.trim();
    const toRaw = $("#dirTo").value.trim();
    if (!fromRaw || !toRaw) return notify("Enter both start and destination");

    const resultEl = $("#dirResult");
    resultEl.innerHTML = "Calculating route…";

    try {
      let from = parseCoords(fromRaw);
      let to = parseCoords(toRaw);

      if (!from) {
        const g = await geocode(fromRaw);
        if (!g) throw new Error("Could not find starting point");
        from = [g.lat, g.lng];
      }
      if (!to) {
        const g = await geocode(toRaw);
        if (!g) throw new Error("Could not find destination");
        to = [g.lat, g.lng];
      }

      // OSRM public server: lon,lat order
      const url = `https://router.project-osrm.org/route/v1/driving/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson&steps=true`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.code !== "Ok" || !data.routes?.[0]) {
        throw new Error("No route found");
      }

      const route = data.routes[0];
      const coords = route.geometry.coordinates.map((c) => [c[1], c[0]]);

      routeLayer.clearLayers();
      const poly = L.polyline(coords, { color: "#1a5f9e", weight: 5, opacity: 0.85 }).addTo(routeLayer);
      map.fitBounds(poly.getBounds(), { padding: [40, 40] });

      // Start / end markers
      L.circleMarker(from, { radius: 7, color: "#0d7a4f", fillColor: "#0d7a4f", fillOpacity: 1 }).addTo(routeLayer);
      L.circleMarker(to, { radius: 7, color: "#c0392b", fillColor: "#c0392b", fillOpacity: 1 }).addTo(routeLayer);

      const distKm = (route.distance / 1000).toFixed(1);
      const mins = Math.round(route.duration / 60);
      let html = `<div class="route-summary">${distKm} km · ~${mins} min drive</div><ol>`;
      const steps = route.legs?.[0]?.steps || [];
      steps.slice(0, 12).forEach((s) => {
        if (s.maneuver?.instruction || s.name) {
          html += `<li>${s.maneuver?.instruction || s.name || "Continue"}</li>`;
        }
      });
      if (steps.length > 12) html += `<li>… +${steps.length - 12} more steps</li>`;
      html += "</ol>";
      resultEl.innerHTML = html;
      notify(`Route ready · ${distKm} km`);
    } catch (err) {
      resultEl.innerHTML = `<span style="color:#c0392b">${err.message || "Route failed"}</span>`;
      notify("Could not calculate route");
      console.error(err);
    }
  }

  function parseCoords(str) {
    const m = str.match(/^\s*(-?\d+\.?\d*)\s*[, ]\s*(-?\d+\.?\d*)\s*$/);
    if (m) return [+m[1], +m[2]];
    return null;
  }

  // ---------- Street View ----------
  function openStreetView(lat, lng) {
    // Opens Google Street View at the location (works without API key)
    const url = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
    window.open(url, "_blank", "noopener");
    notify("Opening Street View…");
  }

  // ---------- Geolocation ----------
  function locateUser() {
    if (!navigator.geolocation) return notify("Geolocation not supported");
    notify("Locating you…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        map.setView([latitude, longitude], 15);
        L.circleMarker([latitude, longitude], {
          radius: 8,
          color: "#1a5f9e",
          fillColor: "#3b82f6",
          fillOpacity: 0.9,
        }).addTo(map).bindPopup("You are here").openPopup();
        notify("Location found");
      },
      () => notify("Unable to get your location")
    );
  }

  // ---------- UI: Search tabs, save, modals (from Mark 2) ----------
  const openModal = (id) => {
    const m = typeof id === "string" ? $(id) : id;
    if (m) {
      m.hidden = false;
      document.body.style.overflow = "hidden";
      m.setAttribute("aria-hidden", "false");
    }
  };
  const closeModal = (modal) => {
    const m = modal || document.querySelector(".modal:not([hidden])");
    if (!m) return;
    m.hidden = true;
    m.setAttribute("aria-hidden", "true");
    document.body.style.overflow = document.querySelector(".modal:not([hidden])") ? "hidden" : "";
  };

  $$(".search-tabs button").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".search-tabs button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab || btn.textContent.trim().toLowerCase();
      $("#search").placeholder = `Search ${tab} by city, ID or landmark`;
    });
  });

  $$(".save-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const on = btn.textContent === "♥";
      btn.textContent = on ? "♡" : "♥";
      notify(on ? "Removed from saved" : "Saved to your list");
    });
  });

  // Directions buttons on land cards
  $$("[data-action='directions']").forEach((btn) => {
    btn.addEventListener("click", () => {
      openDirectionsTo(+btn.dataset.lat, +btn.dataset.lng);
      document.getElementById("explore")?.scrollIntoView({ behavior: "smooth" });
    });
  });

  // Plot page buttons
  $("#plotDirectionsBtn")?.addEventListener("click", () => {
    openDirectionsTo(17.4412, 78.3489);
    document.getElementById("explore")?.scrollIntoView({ behavior: "smooth" });
  });
  $("#plotStreetViewBtn")?.addEventListener("click", () => openStreetView(17.4412, 78.3489));

  document.addEventListener("click", (event) => {
    const closeTarget = event.target.closest("[data-close]");
    if (closeTarget) {
      const modal = closeTarget.closest(".modal");
      if (modal) {
        closeModal(modal);
      }
      return;
    }

    const modalTrigger = event.target.closest("[data-open-modal]");
    if (modalTrigger) {
      event.preventDefault();
      openModal(modalTrigger.dataset.openModal);
      return;
    }

    const scrollTarget = event.target.closest("[data-scroll-to]");
    if (scrollTarget) {
      event.preventDefault();
      const id = scrollTarget.dataset.scrollTo;
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    const directionBtn = event.target.closest("[data-direction]");
    if (directionBtn) {
      event.preventDefault();
      const lat = Number(directionBtn.dataset.lat);
      const lng = Number(directionBtn.dataset.lng);
      openDirectionsTo(lat, lng);
      document.getElementById("explore")?.scrollIntoView({ behavior: "smooth" });
      return;
    }

    const streetViewBtn = event.target.closest("[data-street-view]");
    if (streetViewBtn) {
      event.preventDefault();
      openStreetView(Number(streetViewBtn.dataset.lat), Number(streetViewBtn.dataset.lng));
      return;
    }

    const saveButton = event.target.closest(".save-btn");
    if (saveButton) {
      event.preventDefault();
      const active = saveButton.textContent === "♥";
      saveButton.textContent = active ? "♡" : "♥";
      notify(active ? "Removed from saved" : "Saved to your list");
    }
  });

  $$(".modal").forEach((modal) => {
    modal.addEventListener("click", (e) => {
      const target = e.target;
      if (target instanceof HTMLElement && (target.matches("[data-close]") || target.classList.contains("modal-backdrop"))) {
        closeModal(modal);
      }
    });
  });

  $("#requestVisitBtn")?.addEventListener("click", () => openModal("#visitModal"));
  $("#sidebarVisitBtn")?.addEventListener("click", () => openModal("#visitModal"));
  $$("[data-action='site-visit']").forEach((btn) => {
    btn.addEventListener("click", () => openModal("#visitModal"));
  });
  $("#contactDealerBtn")?.addEventListener("click", () => openModal("#dealerModal"));
  $("#chatDealerBtn")?.addEventListener("click", () => notify("Chat started with Vikram Krishna (demo)"));
  $("#writeReviewBtn")?.addEventListener("click", () => openModal("#reviewModal"));

  $("#visitForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const preferred = fd.get("date") || fd.get("preferredAt") || "";
    const time = fd.get("time") || "";
    let preferredAt = preferred ? String(preferred) : undefined;
    if (preferredAt && time) preferredAt = preferredAt + "T" + String(time);
    try {
      await apiPost("/api/v1/engagement/site-visits", {
        plotId: fd.get("plotId") || "BL-00372",
        name: fd.get("name") || getUser()?.name || "Guest",
        email: fd.get("email") || getUser()?.email,
        phone: fd.get("phone") || undefined,
        preferredAt,
        notes: fd.get("notes") || fd.get("message") || undefined,
      });
      closeModal($("#visitModal"));
      notify("Site visit requested — saved to registry");
      e.target.reset();
    } catch (err) {
      notify(err.message || "Could not request visit");
    }
  });
  $("#dealerForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await apiPost("/api/v1/engagement/enquiries", {
        plotId: fd.get("plotId") || "BL-00372",
        name: fd.get("name") || getUser()?.name || "Guest",
        email: fd.get("email") || getUser()?.email,
        phone: fd.get("phone") || undefined,
        message: fd.get("message") || fd.get("notes") || "Interested in this plot",
      });
      closeModal($("#dealerModal"));
      notify("Enquiry sent to the listing contact");
      e.target.reset();
    } catch (err) {
      notify(err.message || "Could not send enquiry");
    }
  });
  $("#reviewForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await apiPost("/api/v1/engagement/reviews", {
        plotId: fd.get("plotId") || "BL-00372",
        authorName: fd.get("name") || getUser()?.name || "Anonymous",
        rating: Number(fd.get("rating") || 5),
        comment: fd.get("comment") || fd.get("review") || fd.get("message"),
      });
      closeModal($("#reviewModal"));
      notify("Review submitted");
      e.target.reset();
    } catch (err) {
      notify(err.message || "Could not submit review");
    }
  });

  /* wallet bound in updateAuthUI */

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") $$(".modal:not([hidden])").forEach(closeModal);
  });

  // ---------- Boot ----------
  async function boot() {
    
  $("#authToggleMode")?.addEventListener("click", () => {
    openAuthModal(authMode === "login" ? "register" : "login");
  });
  $("#authForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const email = String(fd.get("email") || "");
    const password = String(fd.get("password") || "");
    const name = String(fd.get("name") || "");
    try {
      if (authMode === "register") {
        const json = await apiPost("/api/v1/auth/register", { email, password, name: name || email.split("@")[0] });
        setSession(json.data.accessToken, json.data.user);
        notify("Welcome, " + (json.data.user.name || email));
      } else {
        const json = await apiPost("/api/v1/auth/login", { email, password });
        setSession(json.data.accessToken, json.data.user);
        notify("Signed in as " + (json.data.user.email || email));
      }
      closeModal($("#authModal"));
      e.target.reset();
    } catch (err) {
      notify(err.message || "Auth failed");
    }
  });
  document.querySelectorAll('a.profile').forEach((a) => {
    a.addEventListener("click", (e) => {
      if (!getUser()) {
        e.preventDefault();
        openAuthModal("register");
      }
    });
  });
  updateAuthUI();

    await refreshLiveRegistry();
    const projects = await fetchProjectsFromApi();
    if (projects.length) renderProjectsFromApi(projects);
    initMap();
    window.setInterval(refreshLiveRegistry, LIVE_REFRESH_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
