import {
  VIDEO_PROJECT_LIMITS,
  VIDEO_PROJECT_SCHEMA_VERSION,
  VIDEO_TICKS_PER_SECOND,
  type PrimarySequenceClip,
  type ValidationIssue,
  type VideoProjectDocumentV1,
  type VideoProjectValidation,
} from "./types.js";
import {
  clipDurationUS,
  isPrimarySequenceClip,
  projectDurationUS,
} from "./timeline.js";

const ROOT_FIELDS = [
  "schema_version",
  "editing_mode",
  "title",
  "timebase",
  "sources",
  "primary_sequence",
  "visual_tracks",
  "audio_tracks",
  "caption_tracks",
  "variants",
  "markers",
  "export_defaults",
] as const;

const EASINGS = [
  "hold",
  "linear",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "focus-spring",
] as const;
const VARIANTS = ["portrait", "feed-portrait", "square", "landscape"] as const;
const COLOR = /^#[0-9a-f]{3,8}$/iu;

function issue(path: string, code: string, message: string): ValidationIssue {
  return { path, code, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integer(
  value: unknown,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): boolean {
  return (
    Number.isInteger(value) &&
    Number(value) >= minimum &&
    Number(value) <= maximum
  );
}

function finite(value: unknown, minimum: number, maximum: number): boolean {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function knownFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: ValidationIssue[],
): void {
  const fields = new Set(allowed);
  for (const field of Object.keys(value)) {
    if (!fields.has(field)) {
      issues.push(
        issue(`${path}.${field}`, "unknown-field", "Unknown persisted field."),
      );
    }
  }
}

function requiredString(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  maximum = 500,
): void {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    issues.push(
      issue(path, "string", `Value must contain 1–${maximum} characters.`),
    );
  }
}

function uniqueID(
  value: unknown,
  path: string,
  ids: Set<string>,
  issues: ValidationIssue[],
): void {
  requiredString(value, path, issues, 200);
  if (typeof value !== "string" || !value) return;
  if (ids.has(value))
    issues.push(issue(path, "item-id", "Persisted IDs must be unique."));
  ids.add(value);
}

function validateLocator(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!isRecord(value)) {
    issues.push(issue(path, "locator", "Source locator must be an object."));
    return;
  }
  if (value.type === "local-opfs") {
    knownFields(value, ["type", "path"], path, issues);
    requiredString(value.path, `${path}.path`, issues, 2_000);
  } else if (value.type === "openpost-media") {
    knownFields(value, ["type", "media_id"], path, issues);
    requiredString(value.media_id, `${path}.media_id`, issues, 200);
  } else {
    issues.push(
      issue(`${path}.type`, "locator", "Source locator type is invalid."),
    );
  }
}

function validateProvenance(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issues.push(
      issue(path, "provenance", "Stock provenance must be an object."),
    );
    return;
  }
  const fields = [
    "provider",
    "external_id",
    "source_url",
    "creator_name",
    "creator_url",
    "license_name",
    "license_url",
    "attribution_text",
  ];
  knownFields(value, fields, path, issues);
  for (const field of fields) {
    if (typeof value[field] !== "string") {
      issues.push(
        issue(
          `${path}.${field}`,
          "string",
          "Provenance values must be strings.",
        ),
      );
    }
  }
  for (const field of ["source_url", "creator_url", "license_url"]) {
    try {
      const parsed = new URL(String(value[field]));
      if (parsed.protocol !== "https:") throw new Error("not HTTPS");
    } catch {
      issues.push(
        issue(`${path}.${field}`, "url", "Provenance URLs must use HTTPS."),
      );
    }
  }
}

function validateSource(
  value: unknown,
  sourceID: string,
  issues: ValidationIssue[],
): void {
  const path = `$.sources.${sourceID}`;
  if (!isRecord(value)) {
    issues.push(issue(path, "type", "Source must be an object."));
    return;
  }
  knownFields(
    value,
    [
      "id",
      "kind",
      "locator",
      "original_name",
      "mime_type",
      "size_bytes",
      "duration_us",
      "width",
      "height",
      "rotation",
      "video_codec",
      "audio_codec",
      "content_hash",
      "provenance",
    ],
    path,
    issues,
  );
  if (value.id !== sourceID) {
    issues.push(
      issue(`${path}.id`, "source-id", "Source key and ID must match."),
    );
  }
  if (
    ![
      "video",
      "audio",
      "image",
      "recording-screen",
      "recording-camera",
      "recording-microphone",
      "recording-system-audio",
    ].includes(String(value.kind))
  ) {
    issues.push(
      issue(`${path}.kind`, "source-kind", "Source kind is not supported."),
    );
  }
  validateLocator(value.locator, `${path}.locator`, issues);
  requiredString(value.original_name, `${path}.original_name`, issues);
  requiredString(value.mime_type, `${path}.mime_type`, issues, 200);
  for (const field of [
    "size_bytes",
    "duration_us",
    "width",
    "height",
  ] as const) {
    if (!integer(value[field])) {
      issues.push(
        issue(
          `${path}.${field}`,
          "number",
          `${field} must be a non-negative integer.`,
        ),
      );
    }
  }
  if (!integer(value.rotation, -360, 360)) {
    issues.push(
      issue(
        `${path}.rotation`,
        "number",
        "Rotation must be an integer from -360 to 360.",
      ),
    );
  }
  if (
    value.content_hash !== undefined &&
    (typeof value.content_hash !== "string" ||
      !/^[a-f0-9]{64}$/iu.test(value.content_hash))
  ) {
    issues.push(
      issue(
        `${path}.content_hash`,
        "hash",
        "Content hash must be SHA-256 hex.",
      ),
    );
  }
  validateProvenance(value.provenance, `${path}.provenance`, issues);
}

function validateKeyframes(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    issues.push(issue(path, "keyframes", "Keyframes must be an array."));
    return;
  }
  let previous = -1;
  for (const [index, candidate] of value.entries()) {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(candidate)) {
      issues.push(issue(itemPath, "keyframe", "Keyframe must be an object."));
      continue;
    }
    knownFields(candidate, ["time_us", "value", "easing"], itemPath, issues);
    if (!integer(candidate.time_us) || Number(candidate.time_us) <= previous) {
      issues.push(
        issue(
          `${itemPath}.time_us`,
          "keyframe-time",
          "Keyframe times must be increasing integers.",
        ),
      );
    }
    previous = Number(candidate.time_us);
    if (!finite(candidate.value, -1_000_000, 1_000_000)) {
      issues.push(
        issue(
          `${itemPath}.value`,
          "keyframe-value",
          "Keyframe value must be finite.",
        ),
      );
    }
    if (!EASINGS.includes(candidate.easing as (typeof EASINGS)[number])) {
      issues.push(
        issue(`${itemPath}.easing`, "easing", "Keyframe easing is invalid."),
      );
    }
  }
}

function validateCrop(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!isRecord(value)) {
    issues.push(issue(path, "crop", "Crop rectangle is required."));
    return;
  }
  knownFields(value, ["x", "y", "width", "height"], path, issues);
  for (const field of ["x", "y", "width", "height"]) {
    if (!finite(value[field], 0, 1)) {
      issues.push(
        issue(
          `${path}.${field}`,
          "crop",
          "Crop values must be between 0 and 1.",
        ),
      );
    }
  }
  if (
    Number(value.width) <= 0 ||
    Number(value.height) <= 0 ||
    Number(value.x) + Number(value.width) > 1.000001 ||
    Number(value.y) + Number(value.height) > 1.000001
  ) {
    issues.push(
      issue(path, "crop", "Crop rectangle must fit inside the source."),
    );
  }
}

function validatePresentation(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!isRecord(value)) {
    issues.push(issue(path, "presentation", "Video presentation is required."));
    return;
  }
  const fields = [
    "position_x",
    "position_y",
    "scale",
    "rotation",
    "opacity",
    "crop",
    "flip_x",
    "flip_y",
    "corner_radius",
    "border_width",
    "border_color",
    "shadow_blur",
    "shadow_opacity",
    "background_color",
    "keyframes",
  ];
  knownFields(value, fields, path, issues);
  for (const [field, minimum, maximum] of [
    ["position_x", -10, 10],
    ["position_y", -10, 10],
    ["scale", 0.01, 100],
    ["rotation", -36_000, 36_000],
    ["opacity", 0, 1],
    ["corner_radius", 0, 10_000],
    ["border_width", 0, 1_000],
    ["shadow_blur", 0, 1_000],
    ["shadow_opacity", 0, 1],
  ] as const) {
    if (!finite(value[field], minimum, maximum)) {
      issues.push(
        issue(
          `${path}.${field}`,
          "presentation-number",
          "Presentation value is out of range.",
        ),
      );
    }
  }
  if (typeof value.flip_x !== "boolean" || typeof value.flip_y !== "boolean") {
    issues.push(
      issue(path, "presentation-boolean", "Flip values must be boolean."),
    );
  }
  for (const field of ["border_color", "background_color"]) {
    if (typeof value[field] !== "string" || !COLOR.test(value[field])) {
      issues.push(
        issue(
          `${path}.${field}`,
          "color",
          "Color must be a hexadecimal CSS color.",
        ),
      );
    }
  }
  validateCrop(value.crop, `${path}.crop`, issues);
  if (value.keyframes !== undefined) {
    if (!isRecord(value.keyframes)) {
      issues.push(
        issue(
          `${path}.keyframes`,
          "keyframes",
          "Presentation keyframes must be an object.",
        ),
      );
    } else {
      const keys = [
        "position_x",
        "position_y",
        "scale",
        "rotation",
        "opacity",
        "crop_x",
        "crop_y",
        "crop_width",
        "crop_height",
      ];
      knownFields(value.keyframes, keys, `${path}.keyframes`, issues);
      for (const [property, keyframes] of Object.entries(value.keyframes)) {
        validateKeyframes(keyframes, `${path}.keyframes.${property}`, issues);
      }
    }
  }
}

function validatePresentationOverride(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!isRecord(value)) {
    issues.push(
      issue(
        path,
        "presentation-override",
        "Presentation override must be an object.",
      ),
    );
    return;
  }
  const fields = [
    "position_x",
    "position_y",
    "scale",
    "rotation",
    "opacity",
    "crop",
    "flip_x",
    "flip_y",
    "corner_radius",
    "border_width",
    "border_color",
    "shadow_blur",
    "shadow_opacity",
    "background_color",
    "visible",
    "keyframes",
  ];
  knownFields(value, fields, path, issues);
  for (const [field, minimum, maximum] of [
    ["position_x", -10, 10],
    ["position_y", -10, 10],
    ["scale", 0.01, 100],
    ["rotation", -36_000, 36_000],
    ["opacity", 0, 1],
    ["corner_radius", 0, 10_000],
    ["border_width", 0, 1_000],
    ["shadow_blur", 0, 1_000],
    ["shadow_opacity", 0, 1],
  ] as const) {
    if (value[field] !== undefined && !finite(value[field], minimum, maximum)) {
      issues.push(
        issue(
          `${path}.${field}`,
          "presentation-number",
          "Presentation override is out of range.",
        ),
      );
    }
  }
  for (const field of ["flip_x", "flip_y", "visible"]) {
    if (value[field] !== undefined && typeof value[field] !== "boolean") {
      issues.push(
        issue(
          `${path}.${field}`,
          "presentation-boolean",
          "Presentation override must be boolean.",
        ),
      );
    }
  }
  for (const field of ["border_color", "background_color"]) {
    if (
      value[field] !== undefined &&
      (typeof value[field] !== "string" || !COLOR.test(value[field]))
    ) {
      issues.push(
        issue(
          `${path}.${field}`,
          "color",
          "Color must be a hexadecimal CSS color.",
        ),
      );
    }
  }
  if (value.crop !== undefined)
    validateCrop(value.crop, `${path}.crop`, issues);
  if (value.keyframes !== undefined) {
    if (!isRecord(value.keyframes)) {
      issues.push(
        issue(
          `${path}.keyframes`,
          "keyframes",
          "Override keyframes must be an object.",
        ),
      );
    } else {
      const keys = [
        "position_x",
        "position_y",
        "scale",
        "rotation",
        "opacity",
        "crop_x",
        "crop_y",
        "crop_width",
        "crop_height",
      ];
      knownFields(value.keyframes, keys, `${path}.keyframes`, issues);
      for (const [property, keyframes] of Object.entries(value.keyframes)) {
        validateKeyframes(keyframes, `${path}.keyframes.${property}`, issues);
      }
    }
  }
}

function validateVariantMap(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  validateValue: (
    value: unknown,
    path: string,
    issues: ValidationIssue[],
  ) => void,
): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issues.push(
      issue(path, "variant-overrides", "Variant overrides must be an object."),
    );
    return;
  }
  for (const [variantID, override] of Object.entries(value)) {
    if (!VARIANTS.includes(variantID as (typeof VARIANTS)[number])) {
      issues.push(
        issue(
          `${path}.${variantID}`,
          "variant",
          "Variant override key is invalid.",
        ),
      );
      continue;
    }
    validateValue(override, `${path}.${variantID}`, issues);
  }
}

function validateTextStyle(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!isRecord(value)) {
    issues.push(issue(path, "text-style", "Text style is required."));
    return;
  }
  knownFields(
    value,
    [
      "font_family",
      "font_size",
      "font_weight",
      "color",
      "align",
      "background_color",
      "outline_color",
      "outline_width",
      "shadow_blur",
      "animation",
    ],
    path,
    issues,
  );
  requiredString(value.font_family, `${path}.font_family`, issues, 200);
  if (
    !finite(value.font_size, 1, 1_000) ||
    !integer(value.font_weight, 100, 1_000) ||
    !finite(value.outline_width, 0, 100) ||
    !finite(value.shadow_blur, 0, 1_000)
  ) {
    issues.push(issue(path, "text-style", "Text style values are invalid."));
  }
  for (const field of ["color", "background_color", "outline_color"]) {
    if (typeof value[field] !== "string" || !COLOR.test(value[field])) {
      issues.push(
        issue(
          `${path}.${field}`,
          "color",
          "Text colors must be hexadecimal CSS colors.",
        ),
      );
    }
  }
  if (
    !["left", "center", "right"].includes(String(value.align)) ||
    !["none", "fade", "rise", "pop", "typewriter"].includes(
      String(value.animation),
    )
  ) {
    issues.push(
      issue(path, "text-style", "Text alignment or animation is invalid."),
    );
  }
}

function validateShapeStyle(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!isRecord(value)) {
    issues.push(issue(path, "shape-style", "Shape style is required."));
    return;
  }
  knownFields(
    value,
    ["kind", "fill", "stroke", "stroke_width", "blur"],
    path,
    issues,
  );
  if (
    ![
      "rectangle",
      "ellipse",
      "arrow",
      "highlight",
      "click-pulse",
      "redaction",
      "progress",
    ].includes(String(value.kind)) ||
    !finite(value.stroke_width, 0, 1_000) ||
    !finite(value.blur, 0, 1_000)
  ) {
    issues.push(issue(path, "shape-style", "Shape settings are invalid."));
  }
  for (const field of ["fill", "stroke"]) {
    if (typeof value[field] !== "string" || !COLOR.test(value[field])) {
      issues.push(
        issue(
          `${path}.${field}`,
          "color",
          "Shape colors must be hexadecimal CSS colors.",
        ),
      );
    }
  }
}

function validateVisualOverride(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!isRecord(value)) {
    issues.push(
      issue(path, "visual-override", "Visual override must be an object."),
    );
    return;
  }
  knownFields(value, ["visible", "presentation"], path, issues);
  if (value.visible !== undefined && typeof value.visible !== "boolean") {
    issues.push(
      issue(`${path}.visible`, "boolean", "Visual visibility must be boolean."),
    );
  }
  if (value.presentation !== undefined) {
    validatePresentationOverride(
      value.presentation,
      `${path}.presentation`,
      issues,
    );
  }
}

function validateCaptionStyle(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  partial = false,
): void {
  if (!isRecord(value)) {
    issues.push(
      issue(path, "caption-style", "Caption style must be an object."),
    );
    return;
  }
  const fields = [
    "preset",
    "font_family",
    "font_size",
    "font_weight",
    "color",
    "emphasis_color",
    "background_color",
    "position",
    "max_lines",
  ];
  knownFields(value, fields, path, issues);
  if (!partial || value.preset !== undefined) {
    if (!["clean", "bold", "karaoke", "boxed"].includes(String(value.preset))) {
      issues.push(
        issue(`${path}.preset`, "caption-style", "Caption preset is invalid."),
      );
    }
  }
  if (!partial || value.font_family !== undefined) {
    requiredString(value.font_family, `${path}.font_family`, issues, 200);
  }
  for (const [field, minimum, maximum] of [
    ["font_size", 1, 1_000],
    ["font_weight", 100, 1_000],
    ["max_lines", 1, 3],
  ] as const) {
    if (
      (!partial || value[field] !== undefined) &&
      !integer(value[field], minimum, maximum)
    ) {
      issues.push(
        issue(
          `${path}.${field}`,
          "caption-style",
          "Caption style value is invalid.",
        ),
      );
    }
  }
  for (const field of ["color", "emphasis_color", "background_color"]) {
    if (
      (!partial || value[field] !== undefined) &&
      (typeof value[field] !== "string" || !COLOR.test(value[field]))
    ) {
      issues.push(
        issue(
          `${path}.${field}`,
          "color",
          "Caption colors must be hexadecimal CSS colors.",
        ),
      );
    }
  }
  if (
    (!partial || value.position !== undefined) &&
    !["top", "middle", "bottom"].includes(String(value.position))
  ) {
    issues.push(
      issue(
        `${path}.position`,
        "caption-style",
        "Caption position is invalid.",
      ),
    );
  }
}

function validateAudioSettings(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!isRecord(value)) {
    issues.push(issue(path, "audio", "Clip audio settings are required."));
    return;
  }
  knownFields(
    value,
    [
      "muted",
      "gain_db",
      "gain_db_keyframes",
      "fade_in_us",
      "fade_out_us",
      "duck_others",
    ],
    path,
    issues,
  );
  if (
    typeof value.muted !== "boolean" ||
    typeof value.duck_others !== "boolean"
  ) {
    issues.push(
      issue(path, "audio-boolean", "Audio switches must be boolean."),
    );
  }
  if (!finite(value.gain_db, -96, 24)) {
    issues.push(
      issue(`${path}.gain_db`, "gain", "Gain must be between -96 and 24 dB."),
    );
  }
  validateKeyframes(
    value.gain_db_keyframes,
    `${path}.gain_db_keyframes`,
    issues,
  );
  if (!integer(value.fade_in_us) || !integer(value.fade_out_us)) {
    issues.push(
      issue(
        path,
        "fade",
        "Audio fades must be non-negative integer microseconds.",
      ),
    );
  }
}

function validateTransition(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issues.push(issue(path, "transition", "Transition must be an object."));
    return;
  }
  knownFields(value, ["type", "duration_us", "easing"], path, issues);
  if (
    ![
      "cut",
      "cross-dissolve",
      "dip-black",
      "dip-white",
      "slide",
      "push",
      "zoom-blur",
    ].includes(String(value.type)) ||
    !integer(value.duration_us) ||
    !EASINGS.includes(value.easing as (typeof EASINGS)[number])
  ) {
    issues.push(issue(path, "transition", "Transition settings are invalid."));
  }
}

function validateEffects(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!Array.isArray(value)) {
    issues.push(issue(path, "effects", "Effects must be an array."));
    return;
  }
  for (const [index, effect] of value.entries()) {
    const effectPath = `${path}[${index}]`;
    if (!isRecord(effect)) {
      issues.push(issue(effectPath, "effect", "Effect must be an object."));
      continue;
    }
    knownFields(effect, ["type", "value", "keyframes"], effectPath, issues);
    if (
      ![
        "exposure",
        "contrast",
        "saturation",
        "temperature",
        "tint",
        "blur",
        "vignette",
      ].includes(String(effect.type)) ||
      !finite(effect.value, -100, 100)
    ) {
      issues.push(issue(effectPath, "effect", "Effect settings are invalid."));
    }
    if (effect.type !== "blur" && effect.keyframes !== undefined) {
      issues.push(
        issue(
          `${effectPath}.keyframes`,
          "effect-keyframes",
          "Only blur supports effect keyframes.",
        ),
      );
    }
    validateKeyframes(effect.keyframes, `${effectPath}.keyframes`, issues);
  }
}

function validateClip(
  value: unknown,
  index: number,
  sources: Record<string, unknown>,
  ids: Set<string>,
  issues: ValidationIssue[],
): void {
  const path = `$.primary_sequence[${index}]`;
  if (!isRecord(value)) {
    issues.push(issue(path, "type", "Primary item must be an object."));
    return;
  }
  if (value.kind === "gap") {
    knownFields(value, ["id", "kind", "duration_us"], path, issues);
    requiredString(value.id, `${path}.id`, issues, 200);
    if (!integer(value.duration_us, 1, VIDEO_PROJECT_LIMITS.maxDurationUS)) {
      issues.push(
        issue(
          `${path}.duration_us`,
          "gap-duration",
          "Gap duration must be positive.",
        ),
      );
    }
  } else {
    knownFields(
      value,
      [
        "kind",
        "id",
        "source_id",
        "mode",
        "source_in_us",
        "source_out_us",
        "freeze_duration_us",
        "speed",
        "video",
        "audio",
        "effects",
        "transition_in",
        "transition_out",
        "variant_overrides",
      ],
      path,
      issues,
    );
    if (value.kind !== undefined && value.kind !== "clip") {
      issues.push(
        issue(`${path}.kind`, "item-kind", "Primary item kind is invalid."),
      );
    }
    requiredString(value.id, `${path}.id`, issues, 200);
    if (typeof value.source_id !== "string" || !sources[value.source_id]) {
      issues.push(
        issue(
          `${path}.source_id`,
          "source-reference",
          "Clip source does not exist.",
        ),
      );
    }
    if (!["source", "freeze"].includes(String(value.mode))) {
      issues.push(issue(`${path}.mode`, "clip-mode", "Clip mode is invalid."));
    }
    if (
      !integer(value.source_in_us) ||
      !integer(value.source_out_us) ||
      Number(value.source_out_us) < Number(value.source_in_us)
    ) {
      issues.push(issue(path, "source-range", "Clip source range is invalid."));
    }
    if (!finite(value.speed, 0.25, 4)) {
      issues.push(
        issue(
          `${path}.speed`,
          "speed",
          "Clip speed must be between 0.25× and 4×.",
        ),
      );
    }
    if (value.mode === "freeze" && !integer(value.freeze_duration_us, 1)) {
      issues.push(
        issue(
          `${path}.freeze_duration_us`,
          "freeze",
          "Freeze duration must be positive.",
        ),
      );
    }
    validatePresentation(value.video, `${path}.video`, issues);
    validateAudioSettings(value.audio, `${path}.audio`, issues);
    validateEffects(value.effects, `${path}.effects`, issues);
    validateTransition(value.transition_in, `${path}.transition_in`, issues);
    validateTransition(value.transition_out, `${path}.transition_out`, issues);
    validateVariantMap(
      value.variant_overrides,
      `${path}.variant_overrides`,
      issues,
      validatePresentationOverride,
    );
  }
  if (typeof value.id === "string") {
    if (ids.has(value.id)) {
      issues.push(
        issue(`${path}.id`, "item-id", "Primary item IDs must be unique."),
      );
    }
    ids.add(value.id);
  }
}

function validateTracks(
  value: Record<string, unknown>,
  sources: Record<string, unknown>,
  ids: Set<string>,
  issues: ValidationIssue[],
): void {
  const visual = Array.isArray(value.visual_tracks) ? value.visual_tracks : [];
  const audio = Array.isArray(value.audio_tracks) ? value.audio_tracks : [];
  const captions = Array.isArray(value.caption_tracks)
    ? value.caption_tracks
    : [];
  if (
    !Array.isArray(value.visual_tracks) ||
    !Array.isArray(value.audio_tracks) ||
    !Array.isArray(value.caption_tracks)
  ) {
    issues.push(
      issue(
        "$",
        "track-type",
        "Visual, audio, and caption tracks must be arrays.",
      ),
    );
  }
  if (visual.length > VIDEO_PROJECT_LIMITS.maxVisualTracks) {
    issues.push(
      issue(
        "$.visual_tracks",
        "limit",
        "A project can contain up to four visual tracks.",
      ),
    );
  }
  if (audio.length > VIDEO_PROJECT_LIMITS.maxAudioTracks) {
    issues.push(
      issue(
        "$.audio_tracks",
        "limit",
        "A project can contain up to eight audio tracks.",
      ),
    );
  }
  if (captions.length > VIDEO_PROJECT_LIMITS.maxCaptionTracks) {
    issues.push(
      issue(
        "$.caption_tracks",
        "limit",
        "A project can contain up to two caption tracks.",
      ),
    );
  }
  let itemCount = 0;
  for (const [trackIndex, candidate] of visual.entries()) {
    const path = `$.visual_tracks[${trackIndex}]`;
    if (!isRecord(candidate)) {
      issues.push(issue(path, "track", "Visual track must be an object."));
      continue;
    }
    knownFields(
      candidate,
      ["id", "name", "locked", "hidden", "items"],
      path,
      issues,
    );
    uniqueID(candidate.id, `${path}.id`, ids, issues);
    requiredString(candidate.name, `${path}.name`, issues, 200);
    if (
      typeof candidate.locked !== "boolean" ||
      typeof candidate.hidden !== "boolean"
    ) {
      issues.push(
        issue(path, "track-state", "Visual track state must be boolean."),
      );
    }
    if (!Array.isArray(candidate.items)) {
      issues.push(
        issue(`${path}.items`, "items", "Visual track items must be an array."),
      );
      continue;
    }
    itemCount += candidate.items.length;
    for (const [itemIndex, item] of candidate.items.entries()) {
      const itemPath = `${path}.items[${itemIndex}]`;
      if (!isRecord(item)) {
        issues.push(issue(itemPath, "item", "Visual item must be an object."));
        continue;
      }
      const common = [
        "id",
        "type",
        "timeline_start_us",
        "duration_us",
        "visible",
        "variant_overrides",
      ];
      const type = String(item.type);
      const specific =
        type === "media" || type === "camera"
          ? ["source_id", "source_in_us", "speed", "presentation"]
          : type === "text"
            ? ["text", "style", "presentation"]
            : ["shape", "presentation"];
      knownFields(item, [...common, ...specific], itemPath, issues);
      if (!["media", "camera", "text", "shape", "annotation"].includes(type)) {
        issues.push(
          issue(
            `${itemPath}.type`,
            "item-type",
            "Visual item type is invalid.",
          ),
        );
      }
      uniqueID(item.id, `${itemPath}.id`, ids, issues);
      if (!integer(item.timeline_start_us) || !integer(item.duration_us, 1)) {
        issues.push(
          issue(
            itemPath,
            "timeline-range",
            "Visual item range must be positive.",
          ),
        );
      }
      if (typeof item.visible !== "boolean") {
        issues.push(
          issue(
            `${itemPath}.visible`,
            "boolean",
            "Visual visibility must be boolean.",
          ),
        );
      }
      if (
        "source_id" in item &&
        (typeof item.source_id !== "string" || !sources[item.source_id])
      ) {
        issues.push(
          issue(
            `${itemPath}.source_id`,
            "source-reference",
            "Visual source does not exist.",
          ),
        );
      }
      if (type === "media" || type === "camera") {
        if (!integer(item.source_in_us) || !finite(item.speed, 0.25, 4)) {
          issues.push(
            issue(
              itemPath,
              "source-range",
              "Visual media source timing is invalid.",
            ),
          );
        }
      } else if (type === "text") {
        requiredString(item.text, `${itemPath}.text`, issues, 20_000);
        validateTextStyle(item.style, `${itemPath}.style`, issues);
      } else if (type === "shape" || type === "annotation") {
        validateShapeStyle(item.shape, `${itemPath}.shape`, issues);
      }
      validatePresentation(
        item.presentation,
        `${itemPath}.presentation`,
        issues,
      );
      validateVariantMap(
        item.variant_overrides,
        `${itemPath}.variant_overrides`,
        issues,
        validateVisualOverride,
      );
    }
  }
  for (const [trackIndex, candidate] of audio.entries()) {
    const path = `$.audio_tracks[${trackIndex}]`;
    if (!isRecord(candidate)) {
      issues.push(issue(path, "track", "Audio track must be an object."));
      continue;
    }
    knownFields(
      candidate,
      ["id", "name", "role", "muted", "items"],
      path,
      issues,
    );
    uniqueID(candidate.id, `${path}.id`, ids, issues);
    requiredString(candidate.name, `${path}.name`, issues, 200);
    if (
      !["voice", "music", "system", "effects", "other"].includes(
        String(candidate.role),
      ) ||
      typeof candidate.muted !== "boolean"
    ) {
      issues.push(
        issue(path, "audio-track", "Audio track settings are invalid."),
      );
    }
    if (!Array.isArray(candidate.items)) {
      issues.push(
        issue(`${path}.items`, "items", "Audio track items must be an array."),
      );
      continue;
    }
    itemCount += candidate.items.length;
    for (const [itemIndex, item] of candidate.items.entries()) {
      const itemPath = `${path}.items[${itemIndex}]`;
      if (!isRecord(item)) {
        issues.push(issue(itemPath, "item", "Audio item must be an object."));
        continue;
      }
      knownFields(
        item,
        [
          "id",
          "source_id",
          "timeline_start_us",
          "source_in_us",
          "duration_us",
          "speed",
          "gain_db",
          "gain_db_keyframes",
          "fade_in_us",
          "fade_out_us",
          "muted",
          "duck_others",
        ],
        itemPath,
        issues,
      );
      if (typeof item.source_id !== "string" || !sources[item.source_id]) {
        issues.push(
          issue(
            `${itemPath}.source_id`,
            "source-reference",
            "Audio source does not exist.",
          ),
        );
      }
      uniqueID(item.id, `${itemPath}.id`, ids, issues);
      if (!integer(item.timeline_start_us) || !integer(item.duration_us, 1)) {
        issues.push(
          issue(
            itemPath,
            "timeline-range",
            "Audio item range must be positive.",
          ),
        );
      }
      if (!finite(item.speed, 0.25, 4) || !finite(item.gain_db, -96, 24)) {
        issues.push(
          issue(
            itemPath,
            "audio-value",
            "Audio item speed or gain is invalid.",
          ),
        );
      }
      if (
        !integer(item.source_in_us) ||
        !integer(item.fade_in_us) ||
        !integer(item.fade_out_us) ||
        typeof item.muted !== "boolean" ||
        typeof item.duck_others !== "boolean"
      ) {
        issues.push(
          issue(
            itemPath,
            "audio-value",
            "Audio timing or switches are invalid.",
          ),
        );
      }
      validateKeyframes(
        item.gain_db_keyframes,
        `${itemPath}.gain_db_keyframes`,
        issues,
      );
    }
  }
  if (itemCount > VIDEO_PROJECT_LIMITS.maxTimelineItems) {
    issues.push(
      issue(
        "$",
        "timeline-limit",
        "The project contains more than 2,000 timeline items.",
      ),
    );
  }
  let cueCount = 0;
  for (const [trackIndex, candidate] of captions.entries()) {
    const path = `$.caption_tracks[${trackIndex}]`;
    if (!isRecord(candidate)) {
      issues.push(issue(path, "track", "Caption track must be an object."));
      continue;
    }
    knownFields(
      candidate,
      [
        "id",
        "name",
        "language",
        "visible",
        "style",
        "cues",
        "variant_overrides",
      ],
      path,
      issues,
    );
    uniqueID(candidate.id, `${path}.id`, ids, issues);
    requiredString(candidate.name, `${path}.name`, issues, 200);
    requiredString(candidate.language, `${path}.language`, issues, 100);
    if (typeof candidate.visible !== "boolean") {
      issues.push(
        issue(
          `${path}.visible`,
          "boolean",
          "Caption visibility must be boolean.",
        ),
      );
    }
    validateCaptionStyle(candidate.style, `${path}.style`, issues);
    validateVariantMap(
      candidate.variant_overrides,
      `${path}.variant_overrides`,
      issues,
      (override, overridePath, overrideIssues) =>
        validateCaptionStyle(override, overridePath, overrideIssues, true),
    );
    if (!Array.isArray(candidate.cues)) {
      issues.push(
        issue(`${path}.cues`, "cues", "Caption cues must be an array."),
      );
      continue;
    }
    cueCount += candidate.cues.length;
    for (const [cueIndex, cue] of candidate.cues.entries()) {
      const cuePath = `${path}.cues[${cueIndex}]`;
      if (!isRecord(cue)) {
        issues.push(issue(cuePath, "cue", "Caption cue must be an object."));
        continue;
      }
      knownFields(
        cue,
        [
          "id",
          "start_us",
          "end_us",
          "text",
          "words",
          "speaker",
          "review_required",
        ],
        cuePath,
        issues,
      );
      uniqueID(cue.id, `${cuePath}.id`, ids, issues);
      if (typeof cue.text !== "string" || cue.text.length > 20_000) {
        issues.push(
          issue(`${cuePath}.text`, "string", "Caption text is invalid."),
        );
      }
      if (
        cue.speaker !== undefined &&
        (typeof cue.speaker !== "string" || cue.speaker.length > 200)
      ) {
        issues.push(
          issue(`${cuePath}.speaker`, "string", "Caption speaker is invalid."),
        );
      }
      if (
        cue.review_required !== undefined &&
        typeof cue.review_required !== "boolean"
      ) {
        issues.push(
          issue(
            `${cuePath}.review_required`,
            "boolean",
            "Review state must be boolean.",
          ),
        );
      }
      if (
        !integer(cue.start_us) ||
        !integer(cue.end_us, 1) ||
        Number(cue.end_us) <= Number(cue.start_us)
      ) {
        issues.push(
          issue(
            cuePath,
            "caption-range",
            "Caption cue range must be positive.",
          ),
        );
      }
      if (!Array.isArray(cue.words)) {
        issues.push(
          issue(`${cuePath}.words`, "words", "Caption words must be an array."),
        );
      } else {
        for (const [wordIndex, word] of cue.words.entries()) {
          const wordPath = `${cuePath}.words[${wordIndex}]`;
          if (!isRecord(word)) {
            issues.push(
              issue(wordPath, "word", "Caption word must be an object."),
            );
            continue;
          }
          knownFields(
            word,
            ["text", "start_us", "end_us", "confidence", "emphasis"],
            wordPath,
            issues,
          );
          requiredString(word.text, `${wordPath}.text`, issues, 2_000);
          if (
            !integer(word.start_us) ||
            !integer(word.end_us, 1) ||
            Number(word.end_us) <= Number(word.start_us)
          ) {
            issues.push(
              issue(
                wordPath,
                "word-range",
                "Caption word range must be positive.",
              ),
            );
          }
          if (word.confidence !== undefined && !finite(word.confidence, 0, 1)) {
            issues.push(
              issue(
                `${wordPath}.confidence`,
                "confidence",
                "Confidence must be between 0 and 1.",
              ),
            );
          }
          if (
            word.emphasis !== undefined &&
            typeof word.emphasis !== "boolean"
          ) {
            issues.push(
              issue(
                `${wordPath}.emphasis`,
                "boolean",
                "Word emphasis must be boolean.",
              ),
            );
          }
        }
      }
    }
  }
  if (cueCount > VIDEO_PROJECT_LIMITS.maxCaptionCues) {
    issues.push(
      issue(
        "$.caption_tracks",
        "caption-limit",
        "The project contains more than 5,000 caption cues.",
      ),
    );
  }
}

function validateVariants(value: unknown, issues: ValidationIssue[]): void {
  if (!Array.isArray(value)) {
    issues.push(issue("$.variants", "type", "Variants must be an array."));
    return;
  }
  const missing = new Set<string>(VARIANTS);
  for (const [index, variant] of value.entries()) {
    const path = `$.variants[${index}]`;
    if (!isRecord(variant)) {
      issues.push(issue(path, "variant", "Variant must be an object."));
      continue;
    }
    knownFields(
      variant,
      ["id", "name", "width", "height", "safe_area", "background_color"],
      path,
      issues,
    );
    if (!missing.delete(String(variant.id))) {
      issues.push(
        issue(`${path}.id`, "variant", "Variant ID is invalid or duplicated."),
      );
    }
    requiredString(variant.name, `${path}.name`, issues, 200);
    if (!integer(variant.width, 1, 1920) || !integer(variant.height, 1, 1920)) {
      issues.push(
        issue(path, "variant-size", "Variant dimensions are invalid."),
      );
    }
    if (!isRecord(variant.safe_area)) {
      issues.push(
        issue(`${path}.safe_area`, "safe-area", "Safe area is required."),
      );
    } else {
      knownFields(
        variant.safe_area,
        ["top", "right", "bottom", "left"],
        `${path}.safe_area`,
        issues,
      );
      for (const edge of ["top", "right", "bottom", "left"]) {
        if (!integer(variant.safe_area[edge])) {
          issues.push(
            issue(
              `${path}.safe_area.${edge}`,
              "safe-area",
              "Safe-area values must be non-negative.",
            ),
          );
        }
      }
      if (
        Number(variant.safe_area.left) + Number(variant.safe_area.right) >=
          Number(variant.width) ||
        Number(variant.safe_area.top) + Number(variant.safe_area.bottom) >=
          Number(variant.height)
      ) {
        issues.push(
          issue(
            `${path}.safe_area`,
            "safe-area",
            "Safe area must leave a visible canvas.",
          ),
        );
      }
    }
    if (
      typeof variant.background_color !== "string" ||
      !COLOR.test(variant.background_color)
    ) {
      issues.push(
        issue(
          `${path}.background_color`,
          "color",
          "Variant background must be a hexadecimal CSS color.",
        ),
      );
    }
  }
  if (missing.size) {
    issues.push(
      issue("$.variants", "variant", "All four social variants are required."),
    );
  }
}

function validateMarkers(
  value: unknown,
  ids: Set<string>,
  issues: ValidationIssue[],
): void {
  if (!Array.isArray(value)) {
    issues.push(issue("$.markers", "type", "Markers must be an array."));
    return;
  }
  for (const [index, marker] of value.entries()) {
    const path = `$.markers[${index}]`;
    if (!isRecord(marker)) {
      issues.push(issue(path, "marker", "Marker must be an object."));
      continue;
    }
    knownFields(marker, ["id", "time_us", "label", "color"], path, issues);
    uniqueID(marker.id, `${path}.id`, ids, issues);
    requiredString(marker.label, `${path}.label`, issues, 500);
    if (!integer(marker.time_us)) {
      issues.push(
        issue(`${path}.time_us`, "marker", "Marker time must be non-negative."),
      );
    }
    if (typeof marker.color !== "string" || !COLOR.test(marker.color)) {
      issues.push(
        issue(
          `${path}.color`,
          "color",
          "Marker color must be a hexadecimal CSS color.",
        ),
      );
    }
  }
}

function validateExportDefaults(
  value: unknown,
  issues: ValidationIssue[],
): void {
  const path = "$.export_defaults";
  if (!isRecord(value)) {
    issues.push(
      issue(path, "export-defaults", "Export defaults are required."),
    );
    return;
  }
  knownFields(
    value,
    [
      "variant_ids",
      "format",
      "video_codec",
      "audio_codec",
      "frame_rate",
      "video_bitrate",
      "audio_bitrate",
      "loudness_normalization",
    ],
    path,
    issues,
  );
  if (
    !Array.isArray(value.variant_ids) ||
    value.variant_ids.some((id) => !VARIANTS.includes(id))
  ) {
    issues.push(
      issue(`${path}.variant_ids`, "variants", "Export variants are invalid."),
    );
  } else if (new Set(value.variant_ids).size !== value.variant_ids.length) {
    issues.push(
      issue(
        `${path}.variant_ids`,
        "variants",
        "Export variants must be unique.",
      ),
    );
  }
  if (
    !["mp4", "webm"].includes(String(value.format)) ||
    !["avc", "vp9"].includes(String(value.video_codec)) ||
    !["aac", "opus"].includes(String(value.audio_codec))
  ) {
    issues.push(issue(path, "codec", "Export format or codec is invalid."));
  }
  if (!isRecord(value.frame_rate)) {
    issues.push(
      issue(
        `${path}.frame_rate`,
        "frame-rate",
        "Export frame rate is required.",
      ),
    );
  } else {
    knownFields(
      value.frame_rate,
      ["numerator", "denominator"],
      `${path}.frame_rate`,
      issues,
    );
    if (
      ![24, 25, 30, 50, 60].includes(Number(value.frame_rate.numerator)) ||
      ![1, 1001].includes(Number(value.frame_rate.denominator))
    ) {
      issues.push(
        issue(
          `${path}.frame_rate`,
          "frame-rate",
          "Export frame rate is invalid.",
        ),
      );
    }
  }
  if (!integer(value.video_bitrate, 1) || !integer(value.audio_bitrate, 1)) {
    issues.push(
      issue(path, "bitrate", "Export bitrates must be positive integers."),
    );
  }
  if (typeof value.loudness_normalization !== "boolean") {
    issues.push(
      issue(
        `${path}.loudness_normalization`,
        "boolean",
        "Loudness normalization must be boolean.",
      ),
    );
  }
}

function validateTransitionBounds(
  document: VideoProjectDocumentV1,
  issues: ValidationIssue[],
): void {
  for (let index = 1; index < document.primary_sequence.length; index++) {
    const previous = document.primary_sequence[index - 1]!;
    const current = document.primary_sequence[index]!;
    if (!isPrimarySequenceClip(previous) || !isPrimarySequenceClip(current))
      continue;
    const requested = Math.max(
      previous.transition_out?.duration_us ?? 0,
      current.transition_in?.duration_us ?? 0,
    );
    const maximum = Math.min(
      clipDurationUS(previous) / 2,
      clipDurationUS(current) / 2,
    );
    if (requested > maximum) {
      issues.push(
        issue(
          `$.primary_sequence[${index}]`,
          "transition-overlap",
          "Transition exceeds the adjacent clip overlap.",
        ),
      );
    }
  }
}

export function validateVideoProject(value: unknown): VideoProjectValidation {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    return {
      valid: false,
      issues: [issue("$", "type", "The project must be a JSON object.")],
    };
  }
  knownFields(value, ROOT_FIELDS, "$", issues);
  if (value.schema_version !== VIDEO_PROJECT_SCHEMA_VERSION) {
    issues.push(
      issue(
        "$.schema_version",
        "schema-version",
        "Unsupported project schema version.",
      ),
    );
  }
  if (
    value.editing_mode !== undefined &&
    value.editing_mode !== "quick-cut" &&
    value.editing_mode !== "editor"
  ) {
    issues.push(
      issue(
        "$.editing_mode",
        "editing-mode",
        "Editing mode must be quick-cut or editor.",
      ),
    );
  }
  if (
    typeof value.title !== "string" ||
    !value.title.trim() ||
    value.title.length > 200
  ) {
    issues.push(
      issue("$.title", "title", "Title must contain 1–200 characters."),
    );
  }
  if (!isRecord(value.timebase)) {
    issues.push(issue("$.timebase", "type", "Timebase is required."));
  } else {
    knownFields(
      value.timebase,
      ["ticks_per_second", "fps_numerator", "fps_denominator"],
      "$.timebase",
      issues,
    );
    if (
      value.timebase.ticks_per_second !== VIDEO_TICKS_PER_SECOND ||
      ![24, 25, 30, 50, 60].includes(Number(value.timebase.fps_numerator)) ||
      ![1, 1001].includes(Number(value.timebase.fps_denominator))
    ) {
      issues.push(
        issue(
          "$.timebase",
          "timebase",
          "Project timebase or frame rate is invalid.",
        ),
      );
    }
  }
  if (!isRecord(value.sources)) {
    issues.push(issue("$.sources", "type", "Sources must be an object."));
  }
  const sources = isRecord(value.sources) ? value.sources : {};
  if (Object.keys(sources).length > VIDEO_PROJECT_LIMITS.maxSources) {
    issues.push(
      issue(
        "$.sources",
        "limit",
        `A project can contain up to ${VIDEO_PROJECT_LIMITS.maxSources} sources.`,
      ),
    );
  }
  for (const [sourceID, source] of Object.entries(sources)) {
    validateSource(source, sourceID, issues);
  }
  const primary = Array.isArray(value.primary_sequence)
    ? value.primary_sequence
    : [];
  if (!Array.isArray(value.primary_sequence)) {
    issues.push(
      issue("$.primary_sequence", "type", "Primary sequence must be an array."),
    );
  }
  const ids = new Set<string>();
  primary.forEach((item, index) =>
    validateClip(item, index, sources, ids, issues),
  );
  validateTracks(value, sources, ids, issues);
  validateVariants(value.variants, issues);
  validateMarkers(value.markers, ids, issues);
  validateExportDefaults(value.export_defaults, issues);

  try {
    if (
      new TextEncoder().encode(JSON.stringify(value)).byteLength >
      VIDEO_PROJECT_LIMITS.maxDocumentBytes
    ) {
      issues.push(
        issue(
          "$",
          "document-size",
          "The serialized project document exceeds 5 MiB.",
        ),
      );
    }
  } catch {
    issues.push(
      issue("$", "serialization", "The project could not be serialized."),
    );
  }

  if (issues.length === 0) {
    const document = value as unknown as VideoProjectDocumentV1;
    validateTransitionBounds(document, issues);
    if (projectDurationUS(document) > VIDEO_PROJECT_LIMITS.maxDurationUS) {
      issues.push(
        issue(
          "$",
          "duration",
          "The final project duration cannot exceed 2 hours.",
        ),
      );
    }
  }
  return issues.length
    ? { valid: false, issues }
    : {
        valid: true,
        issues: [],
        document: value as unknown as VideoProjectDocumentV1,
      };
}

export function assertValidVideoProject(
  value: unknown,
): VideoProjectDocumentV1 {
  const result = validateVideoProject(value);
  if (!result.valid || !result.document) {
    const summary = result.issues
      .slice(0, 5)
      .map((entry) => `${entry.path}: ${entry.message}`)
      .join("; ");
    throw new Error(`Invalid OpenPost Video Editor project: ${summary}`);
  }
  return result.document;
}
