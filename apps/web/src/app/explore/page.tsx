"use client";

import { useEffect, useRef, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export default function ExplorePage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const registryWindow = window as unknown as {
      __BLOCKLAND_API__?: string;
      __BLOCKLAND_CARTO_BASEMAPS_KEY__?: string;
    };
    registryWindow.__BLOCKLAND_API__ = API_URL;
    registryWindow.__BLOCKLAND_CARTO_BASEMAPS_KEY__ = process.env.NEXT_PUBLIC_CARTO_BASEMAPS_KEY || "";

    async function boot() {
      const response = await fetch("/mark2-body.html");
      if (!response.ok) throw new Error("Unable to load the public registry.");
      const html = await response.text();
      if (cancelled || !containerRef.current) return;
      containerRef.current.innerHTML = html;
      await loadScript("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js");
      await loadScript("/mark2-app.js");
      if (!cancelled) setReady(true);
    }

    boot().catch((error: Error) => {
      console.error("Unable to start the public registry.", error);
      if (!cancelled) setReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  return <>
    {!ready && <div className="registry-loading">Loading BlockLand registry…</div>}
    <div ref={containerRef} />
  </>;
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.body.appendChild(script);
  });
}
