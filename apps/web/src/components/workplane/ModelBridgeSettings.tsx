"use client";

import { useEffect, useState } from "react";
import { SKETCHFORGE_MCP_ROUTE } from "@/lib/sketchforgeMcpProtocol";
import { readModelsEnabled, writeModelsEnabled } from "@/lib/modelBridge";

type ModelSession = {
  ready: boolean;
  port: number;
  pairingCode: string;
  command: string;
  args: string[];
};

type PageStatus = {
  ready?: boolean;
  pairingCode?: string;
  port?: number;
  editors?: unknown[];
};

function desktopModels(): { session: () => Promise<ModelSession> } | null {
  return (window as Window & { peakcadModels?: { session: () => Promise<ModelSession> } }).peakcadModels ?? null;
}

export function ModelBridgeSettings() {
  const [enabled, setEnabled] = useState(true);
  const [status, setStatus] = useState<PageStatus | null>(null);
  const [session, setSession] = useState<ModelSession | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setEnabled(readModelsEnabled());
    const onChange = () => setEnabled(readModelsEnabled());
    window.addEventListener("peakcad:models-enabled", onChange);
    return () => window.removeEventListener("peakcad:models-enabled", onChange);
  }, []);

  useEffect(() => {
    let stopped = false;
    const load = async () => {
      const desktop = desktopModels();
      if (desktop) {
        try {
          const next = await desktop.session();
          if (!stopped) setSession(next);
        } catch {
          if (!stopped) setSession(null);
        }
      }
      try {
        const response = await fetch(SKETCHFORGE_MCP_ROUTE);
        const payload = (await response.json().catch(() => null)) as PageStatus | null;
        if (!stopped) setStatus(response.ok ? payload : null);
      } catch {
        if (!stopped) setStatus(null);
      }
    };
    void load();
    return () => {
      stopped = true;
    };
  }, [enabled]);

  const setup = session
    ? `${session.command}\n${session.args.join(" ")}`
    : "node scripts/sketchforge-mcp-server.mjs";
  const ready = Boolean(session?.ready || status?.ready || (status?.editors && !("error" in (status ?? {}))));
  const pairingCode = session?.pairingCode || status?.pairingCode;

  const copySetup = async () => {
    try {
      await navigator.clipboard.writeText(setup);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="model-bridge-settings">
      <div className="workspace-section-heading">
        <strong>AI models</strong>
        <span>{enabled ? (ready ? "Ready for a model on this computer." : "Open a project. Mintr will listen on this computer.") : "Models are turned off."}</span>
      </div>
      <p>
        Claude, Cursor, and Codex connect with the MCP server below. The model sees object ids and the view. The design stays in this project, and each change can be undone from History.
      </p>
      <label className="workspace-select">
        <span>Allow models to use Mintr</span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => {
            const next = event.currentTarget.checked;
            writeModelsEnabled(next);
            setEnabled(next);
          }}
        />
      </label>
      <code>{setup}</code>
      <div className="dashboard-confirm-actions" style={{ padding: 0 }}>
        <button type="button" className="dashboard-confirm-save" onClick={() => void copySetup()}>{copied ? "Copied" : "Copy setup"}</button>
        <button type="button" className="dashboard-confirm-cancel" onClick={() => setShowCode((current) => !current)}>
          {showCode ? "Hide pairing code" : "Connect a model on the web"}
        </button>
      </div>
      {showCode && pairingCode ? (
        <p>
          Pairing code {pairingCode}. Give it to a connector that can reach this Mintr. It works until you quit Mintr. A model on the web still needs a connector on this computer; the design is not uploaded.
        </p>
      ) : null}
      {showCode && !pairingCode ? (
        <p>The pairing code appears while the desktop app is open.</p>
      ) : null}
    </div>
  );
}
