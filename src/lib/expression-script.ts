export const LEGACY_EXPRESSION_DIALECT = "bebas-v1" as const;
export const EXPRESSION_DIALECT = "bebas-v2" as const;
export const SUPPORTED_EXPRESSION_DIALECTS = [
  LEGACY_EXPRESSION_DIALECT,
  EXPRESSION_DIALECT,
] as const;
export type ExpressionDialect = (typeof SUPPORTED_EXPRESSION_DIALECTS)[number];
export const MAX_EXPRESSION_SEGMENTS = 50;

export type ExpressionTag =
  | "whispers"
  | "laughs"
  | "sighs"
  | "excited"
  | "angry"
  | "gasp"
  | "shouts"
  | "crying"
  | "panicked"
  | "curious"
  | "sarcastic"
  | "warm"
  | "calm"
  | "reassuring"
  | "persuasive";

export interface ExpressionDefinition {
  tag: ExpressionTag;
  label: string;
  kind: "delivery" | "event";
  controlInstruction: string | null;
  nativeToken: "[laughing]" | "[sigh]" | null;
  support: "control" | "native" | "experimental";
}

export interface ExpressionSegment {
  index: number;
  tags: ExpressionTag[];
  text: string;
  controlInstruction: string | null;
  targetText: string;
  pauseAfterMs: number;
}

export interface ExpressionIssue {
  code:
    | "unknown-tag"
    | "malformed-tag"
    | "dangling-tag"
    | "duplicate-tag"
    | "long-event-segment"
    | "long-expression-segment"
    | "too-many-segments";
  severity: "error" | "warning";
  position: number;
  token: string;
  message: string;
}

export interface CompiledExpressionScript {
  dialect: ExpressionDialect;
  segments: ExpressionSegment[];
  issues: ExpressionIssue[];
  plainText: string;
  tagCount: number;
  hasBracketTokens: boolean;
  hasExpressionTags: boolean;
  isValid: boolean;
}

export const EXPRESSION_DEFINITIONS: readonly ExpressionDefinition[] = [
  {
    tag: "whispers",
    label: "Berbisik",
    kind: "delivery",
    controlInstruction:
      "Speak in a soft, intimate whisper at a slow, controlled pace.",
    nativeToken: null,
    support: "control",
  },
  {
    tag: "laughs",
    label: "Tertawa",
    kind: "event",
    controlInstruction: null,
    nativeToken: "[laughing]",
    support: "native",
  },
  {
    tag: "sighs",
    label: "Menghela napas",
    kind: "event",
    controlInstruction: null,
    nativeToken: "[sigh]",
    support: "native",
  },
  {
    tag: "excited",
    label: "Antusias",
    kind: "delivery",
    controlInstruction:
      "Use an excited, upbeat, energetic delivery at a slightly faster pace.",
    nativeToken: null,
    support: "control",
  },
  {
    tag: "angry",
    label: "Marah",
    kind: "delivery",
    controlInstruction:
      "Use an angry, forceful tone with sharp articulation and strong emphasis.",
    nativeToken: null,
    support: "control",
  },
  {
    tag: "gasp",
    label: "Terkejut",
    kind: "event",
    controlInstruction:
      "Begin with a brief surprised gasp, then speak with a shocked tone.",
    nativeToken: null,
    support: "experimental",
  },
  {
    tag: "shouts",
    label: "Berteriak",
    kind: "delivery",
    controlInstruction:
      "Shout with very high energy, strong projection, and emphatic delivery.",
    nativeToken: null,
    support: "control",
  },
  {
    tag: "crying",
    label: "Menangis",
    kind: "delivery",
    controlInstruction:
      "Use a tearful, deeply emotional voice with a subtle trembling quality.",
    nativeToken: null,
    support: "control",
  },
  {
    tag: "panicked",
    label: "Panik",
    kind: "delivery",
    controlInstruction:
      "Use a panicked, urgent delivery at a fast pace with tense breathing.",
    nativeToken: null,
    support: "control",
  },
  {
    tag: "curious",
    label: "Penasaran",
    kind: "delivery",
    controlInstruction:
      "Use a curious, inquisitive tone with natural rising intonation.",
    nativeToken: null,
    support: "control",
  },
  {
    tag: "sarcastic",
    label: "Sarkastik",
    kind: "delivery",
    controlInstruction:
      "Use a dry, sarcastic delivery with restrained, slightly mocking emphasis.",
    nativeToken: null,
    support: "control",
  },
  {
    tag: "warm",
    label: "Hangat",
    kind: "delivery",
    controlInstruction:
      "Use a warm, friendly, approachable delivery with gentle enthusiasm.",
    nativeToken: null,
    support: "control",
  },
  {
    tag: "calm",
    label: "Tenang",
    kind: "delivery",
    controlInstruction:
      "Use a calm, steady, relaxed delivery at an unhurried natural pace.",
    nativeToken: null,
    support: "control",
  },
  {
    tag: "reassuring",
    label: "Meyakinkan",
    kind: "delivery",
    controlInstruction:
      "Use a reassuring, trustworthy delivery with gentle confidence and clear articulation.",
    nativeToken: null,
    support: "control",
  },
  {
    tag: "persuasive",
    label: "Persuasif",
    kind: "delivery",
    controlInstruction:
      "Use a persuasive, confident sales delivery with purposeful emphasis and a clear call to action.",
    nativeToken: null,
    support: "control",
  },
] as const;

const LEGACY_EXPRESSION_TAGS = new Set<ExpressionTag>([
  "whispers",
  "laughs",
  "sighs",
  "excited",
  "angry",
  "gasp",
  "shouts",
  "crying",
  "panicked",
  "curious",
  "sarcastic",
]);

const definitionByTag = new Map(
  EXPRESSION_DEFINITIONS.map((definition) => [definition.tag, definition]),
);
const bracketToken = /\[([^\]\r\n]*)\]/g;

export function expressionDefinition(tag: ExpressionTag) {
  return definitionByTag.get(tag)!;
}

export function compileExpressionScript(
  script: string,
  dialect: ExpressionDialect = EXPRESSION_DIALECT,
): CompiledExpressionScript {
  const segments: ExpressionSegment[] = [];
  const issues: ExpressionIssue[] = [];
  const matchedRanges: Array<[number, number]> = [];
  let pendingTags: ExpressionTag[] = [];
  let tagCount = 0;
  let cursor = 0;

  function appendText(rawText: string, sourcePosition: number) {
    const text = rawText.trim();
    if (!text) return;
    const definitions = pendingTags.map(expressionDefinition);
    const instructions = definitions
      .map((definition) => definition.controlInstruction)
      .filter((instruction): instruction is string => Boolean(instruction));
    const nativeTokens = definitions
      .map((definition) => definition.nativeToken)
      .filter((token): token is "[laughing]" | "[sigh]" => Boolean(token));
    segments.push({
      index: segments.length,
      tags: [...pendingTags],
      text,
      controlInstruction: instructions.length ? instructions.join(" ") : null,
      targetText: [...nativeTokens, text].join(" "),
      pauseAfterMs: 0,
    });
    const eventTags = definitions
      .filter((definition) => definition.kind === "event")
      .map((definition) => definition.tag);
    const sentenceCount = text.match(/[.!?](?:[\"'”’)]|\s|$)/g)?.length ?? 0;
    if (eventTags.length && (sentenceCount > 1 || text.length > 160)) {
      issues.push({
        code: "long-event-segment",
        severity: "warning",
        position: sourcePosition,
        token: eventTags.map((tag) => `[${tag}]`).join(" "),
        message: `${eventTags.map((tag) => `[${tag}]`).join(" ")} adalah event singkat. Batasi ke satu frasa atau kalimat, lalu pasang tag delivery untuk bagian berikutnya.`,
      });
    } else if (pendingTags.length && (sentenceCount > 2 || text.length > 300)) {
      issues.push({
        code: "long-expression-segment",
        severity: "warning",
        position: sourcePosition,
        token: pendingTags.map((tag) => `[${tag}]`).join(" "),
        message: "Segmen ekspresi cukup panjang. Tambahkan tag baru saat fungsi atau emosi kalimat berubah agar penyampaian tidak datar.",
      });
    }
    pendingTags = [];
  }

  for (const match of script.matchAll(bracketToken)) {
    const position = match.index ?? 0;
    appendText(script.slice(cursor, position), cursor);
    matchedRanges.push([position, position + match[0].length]);
    cursor = position + match[0].length;
    const normalized = match[1].trim().toLowerCase();
    const definition = definitionByTag.get(normalized as ExpressionTag);
    const supportedByDialect =
      definition &&
      (dialect === EXPRESSION_DIALECT || LEGACY_EXPRESSION_TAGS.has(definition.tag));
    if (!definition || !supportedByDialect) {
      issues.push({
        code: "unknown-tag",
        severity: "error",
        position,
        token: match[0],
        message: `Tag ${match[0]} tidak didukung oleh ${dialect}.`,
      });
      pendingTags = [];
      continue;
    }
    tagCount += 1;
    if (pendingTags.includes(definition.tag)) {
      issues.push({
        code: "duplicate-tag",
        severity: "warning",
        position,
        token: match[0],
        message: `Tag ${match[0]} ditulis dua kali pada segmen yang sama.`,
      });
      continue;
    }
    pendingTags.push(definition.tag);
  }
  appendText(script.slice(cursor), cursor);

  if (pendingTags.length) {
    issues.push({
      code: "dangling-tag",
      severity: "error",
      position: script.length,
      token: `[${pendingTags.at(-1)}]`,
      message: "Tag ekspresi terakhir tidak diikuti teks yang akan diucapkan.",
    });
  }

  const masked = [...script];
  for (const [start, end] of matchedRanges) {
    for (let index = start; index < end; index += 1) masked[index] = " ";
  }
  for (let index = 0; index < masked.length; index += 1) {
    if (masked[index] !== "[" && masked[index] !== "]") continue;
    issues.push({
      code: "malformed-tag",
      severity: "error",
      position: index,
      token: masked[index],
      message: "Tag ekspresi memiliki tanda kurung siku yang tidak lengkap.",
    });
  }

  const plainText = segments.map((segment) => segment.text).join(" ").trim();
  for (let index = 0; index < segments.length - 1; index += 1) {
    const text = segments[index].text;
    segments[index].pauseAfterMs = /[!?][\"'”’)]?$/.test(text)
      ? 280
      : /[.][\"'”’)]?$/.test(text)
        ? 220
        : /[,;:][\"'”’)]?$/.test(text)
          ? 140
          : 180;
  }
  if (segments.length > MAX_EXPRESSION_SEGMENTS) {
    issues.push({
      code: "too-many-segments",
      severity: "error",
      position: script.length,
      token: String(segments.length),
      message: `Naskah ekspresif dibatasi ${MAX_EXPRESSION_SEGMENTS} segmen per pekerjaan.`,
    });
  }
  const hasBracketTokens = matchedRanges.length > 0 || issues.some(
    (issue) => issue.code === "malformed-tag",
  );
  return {
    dialect,
    segments,
    issues,
    plainText,
    tagCount,
    hasBracketTokens,
    hasExpressionTags: tagCount > 0,
    isValid: !issues.some((issue) => issue.severity === "error"),
  };
}
