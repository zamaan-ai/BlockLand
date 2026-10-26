import PlotLocationNote from "./PlotLocationNote";
import type { MapPlot } from "../lib/dashboard";

export default function MapPlotDirectory({
  plots,
  audience,
}: {
  plots: MapPlot[];
  audience: "landowner" | "buyer" | "officer";
}) {
  const descriptions = {
    landowner: "All seven plots currently shown on the public map. These are registry records, not automatically plots owned by your account.",
    buyer: "All seven plots shown on the public map, with registry status and recorded restrictions to help with due diligence.",
    officer: "All seven mapped registry records, including current land status, transfer activity, and restrictions.",
  };

  return (
    <section className="dashboard-panel" id="map-plots">
      <div className="dashboard-panel-heading">
        <h2>All 7 plots on the map</h2>
        <span>{plots.length} registry records</span>
      </div>
      <p>{descriptions[audience]}</p>
      {plots.map((plot) => {
        const encumbrances = plot.encumbrances || [];
        const disputes = plot.disputes || [];
        const transfers = plot.transfers || [];
        return <article className="dashboard-row" key={plot.plotId}>
          <div>
            <b>{plot.plotId} · {plot.title}</b>
            <span>{[plot.village, plot.district, plot.state].filter(Boolean).join(", ")} · {plot.area} acres · {plot.status.replaceAll("_", " ")}</span>
            <span>{plot.description}</span>
            {encumbrances.length > 0 && <span>Restrictions: {encumbrances.map((item) => item.type.replaceAll("_", " ")).join(", ")}</span>}
            {disputes.length > 0 && <span>Open disputes: {disputes.length}</span>}
            {transfers.length > 0 && <span>Active transfers: {transfers.map((item) => item.status.replaceAll("_", " ")).join(", ")}</span>}
            <PlotLocationNote metadata={plot.metadata} />
          </div>
          {audience === "buyer" && <a href={`/land/${encodeURIComponent(plot.plotId)}/verify`}>Verification report</a>}
        </article>
      })}
      {plots.length === 0 && <p className="dashboard-empty">The map plot records could not be loaded.</p>}
    </section>
  );
}
