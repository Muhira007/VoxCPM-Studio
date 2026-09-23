import { AlertTriangle, AudioWaveform, CheckCircle2 } from "lucide-react";
import {
  expressionDefinition,
  type CompiledExpressionScript,
} from "@/lib/expression-script";

export function ExpressionPreview({
  compiled,
}: {
  compiled: CompiledExpressionScript;
}) {
  if (!compiled.hasBracketTokens) return null;
  const errors = compiled.issues.filter((issue) => issue.severity === "error");

  return (
    <section className="expression-preview" aria-label="Preview ekspresi suara">
      <div className="expression-heading">
        <div>
          <AudioWaveform size={17} />
          <strong>Ekspresi suara</strong>
        </div>
        <span className={`expression-status ${errors.length ? "invalid" : "valid"}`}>
          {errors.length ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
          {errors.length
            ? `${errors.length} masalah`
            : `${compiled.segments.length} segmen siap`}
        </span>
      </div>
      <p className="expression-summary">
        Dialek <strong>{compiled.dialect}</strong> · {compiled.tagCount} tag. Tag
        diterjemahkan menjadi instruksi VoxCPM dan tidak ikut dibacakan.
      </p>
      {compiled.issues.length > 0 && (
        <ul className="expression-issues">
          {compiled.issues.map((issue, index) => (
            <li key={`${issue.position}-${issue.code}-${index}`} className={issue.severity}>
              {issue.message}
            </li>
          ))}
        </ul>
      )}
      {compiled.segments.length > 0 && (
        <ol className="expression-segments">
          {compiled.segments.map((segment) => (
            <li key={`${segment.index}-${segment.text}`}>
              <div className="expression-segment-top">
                <span className="segment-number">{segment.index + 1}</span>
                <div className="expression-tags">
                  {segment.tags.length ? (
                    segment.tags.map((tag) => (
                      <span key={tag}>[{tag}] · {expressionDefinition(tag).label}</span>
                    ))
                  ) : (
                    <span className="natural">Natural</span>
                  )}
                </div>
              </div>
              <p>{segment.text}</p>
              {(segment.controlInstruction || segment.targetText !== segment.text) && (
                <small>
                  VoxCPM: {segment.controlInstruction ?? segment.targetText.slice(0, segment.targetText.indexOf(" "))}
                </small>
              )}
              {segment.pauseAfterMs > 0 && (
                <small>Jeda setelah segmen: {segment.pauseAfterMs} ms</small>
              )}
            </li>
          ))}
        </ol>
      )}
      {compiled.isValid && compiled.hasExpressionTags && (
        <p className="expression-pending">
          Setiap segmen akan diproses terpisah, lalu dinormalisasi dan digabung
          kembali menjadi satu WAV.
        </p>
      )}
    </section>
  );
}
