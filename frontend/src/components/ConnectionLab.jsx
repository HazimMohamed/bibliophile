import React, { useEffect, useMemo, useState } from 'react';

export default function ConnectionLab({
  runtimeApiBase,
  probes,
  probeResults,
  busyProbeKey,
  onRunProbe,
}) {
  const [activeKey, setActiveKey] = useState(() => probes[0]?.key ?? null);

  useEffect(() => {
    if (!probes.some((probe) => probe.key === activeKey)) {
      setActiveKey(probes[0]?.key ?? null);
    }
  }, [activeKey, probes]);

  const activeProbe = useMemo(
    () => probes.find((probe) => probe.key === activeKey) ?? probes[0] ?? null,
    [activeKey, probes]
  );

  if (!activeProbe) return null;

  const latestResult = probeResults[activeProbe.key] ?? '';
  const isBusy = busyProbeKey === activeProbe.key;
  const statusTone = isBusy ? 'is-busy' : latestResult ? 'is-active' : 'is-idle';
  const statusText = isBusy ? 'Running probe' : latestResult ? 'Has result' : 'Ready';

  return (
    <section className="connection-lab" aria-label="Connection diagnostics">
      <div className="connection-lab__top">
        <div>
          <div className="connection-lab__kicker">Connection Lab</div>
          <div className="connection-lab__title">Network probes</div>
        </div>
        <div className={`connection-lab__pill ${statusTone}`}>{statusText}</div>
      </div>

      <div className="connection-lab__runtime">
        <div className="connection-lab__label">Runtime API Base</div>
        <code className="connection-lab__code">{runtimeApiBase}</code>
      </div>

      <div className="connection-lab__tabs" role="tablist" aria-label="Probe targets">
        {probes.map((probe) => (
          <button
            key={probe.key}
            className={`connection-lab__tab ${activeProbe.key === probe.key ? 'is-active' : ''}`}
            type="button"
            role="tab"
            aria-selected={activeProbe.key === probe.key}
            onClick={() => setActiveKey(probe.key)}
          >
            {probe.tabLabel}
          </button>
        ))}
      </div>

      <div className="connection-lab__panel" role="tabpanel">
        <div className="connection-lab__panel-head">
          <div>
            <div className="connection-lab__label">{activeProbe.title}</div>
            <code className="connection-lab__code">{activeProbe.url}</code>
          </div>
          <button
            className={`connection-lab__action connection-lab__action--${activeProbe.tone}`}
            type="button"
            onClick={() => onRunProbe(activeProbe)}
            disabled={Boolean(busyProbeKey)}
          >
            {isBusy ? 'Testing…' : activeProbe.actionLabel}
          </button>
        </div>

        <div className="connection-lab__result">
          <div className="connection-lab__label">Latest Result</div>
          <p className={`connection-lab__result-text ${latestResult ? '' : 'is-empty'}`}>
            {latestResult || 'No probe run yet for this target.'}
          </p>
        </div>
      </div>
    </section>
  );
}
