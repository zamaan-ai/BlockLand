export function isDistrictApproximateLocation(metadata: unknown): boolean {
  return typeof metadata === "object"
    && metadata !== null
    && "locationPrecision" in metadata
    && metadata.locationPrecision === "DISTRICT_APPROXIMATE";
}

export default function PlotLocationNote({ metadata }: { metadata?: unknown }) {
  if (typeof metadata !== "object" || metadata === null || !("locationPrecision" in metadata)) return null;
  if (metadata.locationPrecision === "DISTRICT_APPROXIMATE") {
    return <small className="plot-location-note">Approximate district location · illustrative pin, not an exact plot boundary</small>;
  }
  if (metadata.locationPrecision === "PLOT_COORDINATE") {
    return <small className="plot-location-note">Demo plot coordinate · boundary not surveyed</small>;
  }
  return null;
}
