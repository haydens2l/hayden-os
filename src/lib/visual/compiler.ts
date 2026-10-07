export type StyleProfile = {
  visual_medium: string | null;
  style_name: string | null;
  style_description: string | null;
  texture: string | null;
  colour_philosophy: string | null;
  lighting_philosophy: string | null;
  camera_language: string | null;
  lens_language: string | null;
  composition_language: string | null;
  character_design: string | null;
  negative_style_constraints: string | null;
  humour_language: string | null;
};

export type ShotSlice = {
  scene_number: number;
  role: string | null;
  story_purpose: string | null;
  visual_joke: string | null;
  subject: string | null;
  action: string | null;
  composition: string | null;
  camera_position: string | null;
  camera_height: string | null;
  shot_size: string | null;
  lens_feeling: string | null;
  lighting: string | null;
  colour: string | null;
  environment: string | null;
  props: string | null;
  expression: string | null;
  readable: string | null;
  continuity_dependency: string | null;
  must_not_appear: string | null;
};

export function compileFramePrompt(input: {
  brand: string;
  purpose: string;
  style: StyleProfile;
  shot: ShotSlice;
  continuity: string;
  referenceNote: string;
  rules: string[];
}) {
  const style = input.style;
  const shot = input.shot;
  const lines = [
    `Purpose: ${input.purpose}`,
    `Brand: ${input.brand}.`,
    `Visual style: ${style.style_name ?? "Unspecified"}. ${style.style_description ?? ""}`.trim(),
    `Medium: ${style.visual_medium ?? "Use the approved medium."}`,
    style.texture ? `Texture: ${style.texture}` : "",
    style.colour_philosophy ? `Colour: ${style.colour_philosophy}` : "",
    `Subject: ${shot.subject ?? "The subject named in this scene."}`,
    style.character_design ? `Character design: ${style.character_design}` : "",
    shot.expression ? `Expression and body: ${shot.expression}` : "",
    `Action: ${shot.action ?? shot.story_purpose ?? "One clear moment."}`,
    `Composition: ${shot.composition ?? style.composition_language ?? "One readable idea."}`,
    `Camera: ${[shot.shot_size, shot.camera_height, shot.camera_position, shot.lens_feeling ?? style.lens_language].filter(Boolean).join(", ")}`,
    `Environment: ${shot.environment ?? "Only the place this frame needs."}`,
    `Lighting: ${shot.lighting ?? style.lighting_philosophy ?? "Designed light for this medium."}`,
    shot.colour ? `Scene colour: ${shot.colour}` : "",
    shot.props ? `Props: ${shot.props}` : "",
    shot.readable ? `Must read immediately: ${shot.readable}` : "",
    shot.visual_joke ? `Visual joke: ${shot.visual_joke}` : "",
    `Continuity: ${input.continuity} Keep the same person, required wardrobe, world, and side. Pose, gaze, and expression may change unless the lock says the exact pose must remain frozen.`,
    input.referenceNote ? `References: ${input.referenceNote}` : "",
    "Negative:",
    ...relevantNegatives(style, input.rules, shot.must_not_appear),
  ];
  return lines
    .map((line) => line.trim())
    .filter((line) => line && line !== "Camera:" && line !== "Negative:")
    .join("\n");
}

function relevantNegatives(style: StyleProfile, rules: string[], mustNot: string | null) {
  const items = [
    style.negative_style_constraints,
    mustNot,
    "No logo, speech bubble, or brand lockup.",
    "No readable phone, document, payslip, calculator, or statement aimed at camera.",
    ...rules.map((rule) => rule.replace(/\s+/g, " ").trim()),
  ];
  const seen = new Set<string>();
  return items
    .filter((item): item is string => Boolean(item && item.trim()))
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((item) => `- ${item}`);
}

export function photographicConflict(medium: string | null, text: string) {
  if (!medium || !/sketch|illustrat/i.test(medium)) return false;
  return /photoreal|live-action|live action|real homes, real light|stock photo/i.test(text);
}
