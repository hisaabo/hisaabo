import React from "react";
import type { EndpointParam } from "../content/types";

interface Props {
  params: EndpointParam[];
  title?: string;
}

export function ParamTable({ params, title = "Parameters" }: Props) {
  if (params.length === 0) return null;

  return (
    <div className="mb-7">
      <h3 className="section-label mb-3">{title}</h3>
      <div
        className="rounded-lg overflow-hidden"
        style={{ border: "1px solid var(--border-mid)" }}
      >
        <table className="w-full param-table">
          <thead>
            <tr style={{ background: "rgba(20, 20, 36, 0.9)" }}>
              <th className="text-left" style={{ width: "180px" }}>Name</th>
              <th className="text-left" style={{ width: "130px" }}>Type</th>
              <th className="text-left" style={{ width: "72px" }}>Req.</th>
              <th className="text-left">Description</th>
            </tr>
          </thead>
          <tbody>
            {params.map((param) => (
              <tr key={param.name} style={{ background: "rgba(15, 15, 26, 0.6)" }}>
                {/* Name */}
                <td>
                  <div className="flex items-start gap-1">
                    <code
                      className="mono text-[12.5px] font-medium"
                      style={{ color: "#67e8f9" }}
                    >
                      {param.name}
                    </code>
                    {param.required && (
                      <span
                        className="text-[10px] font-bold leading-none mt-0.5 flex-shrink-0"
                        style={{ color: "var(--red)" }}
                        title="Required"
                      >
                        *
                      </span>
                    )}
                  </div>
                  {param.default !== undefined && (
                    <div className="mt-1">
                      <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                        default:{" "}
                        <code
                          className="mono"
                          style={{ color: "var(--text-tertiary)", fontSize: "11px" }}
                        >
                          {String(param.default)}
                        </code>
                      </span>
                    </div>
                  )}
                </td>

                {/* Type */}
                <td>
                  <code
                    className="mono text-[12px]"
                    style={{ color: "#86efac" }}
                  >
                    {param.type}
                  </code>
                </td>

                {/* Required indicator */}
                <td>
                  {param.required ? (
                    <span
                      className="text-[10px] font-semibold"
                      style={{ color: "#f87171" }}
                    >
                      required
                    </span>
                  ) : (
                    <span
                      className="text-[10px]"
                      style={{ color: "var(--text-muted)" }}
                    >
                      optional
                    </span>
                  )}
                </td>

                {/* Description */}
                <td>
                  <span
                    className="text-[13px] leading-relaxed"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {param.description}
                  </span>
                  {param.enumValues && param.enumValues.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {param.enumValues.map((v) => (
                        <code
                          key={v}
                          className="mono text-[11px] px-1.5 py-0.5 rounded"
                          style={{
                            background: "rgba(167, 139, 250, 0.08)",
                            color: "#c4b5fd",
                            border: "1px solid rgba(167, 139, 250, 0.15)",
                          }}
                        >
                          {v}
                        </code>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
