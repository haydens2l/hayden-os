export type PromptScene = {
  sceneNumber: number;
  durationSeconds: number | null;
  visual: string;
  action: string;
  characters: string;
  location: string;
  camera: string;
  startFrame: string;
  endFrame: string;
  voiceover: string;
  sfx: string;
  musicNotes: string;
  continuityFrom: string;
  continuityInto: string;
};

export function composeScenePrompt(input: {
  scene: PromptScene;
  productionType: string;
  aspectRatio: string | null;
  visualStyle: string | null;
  voiceDirection: string | null;
  constraints: string[];
}) {
  const scene = input.scene;
  const lines = [
    `Scene ${scene.sceneNumber}.`,
    input.productionType ? `Production: ${input.productionType}.` : "",
    scene.durationSeconds ? `Duration: ${scene.durationSeconds} seconds.` : "Duration: not set.",
    input.aspectRatio ? `Aspect ratio: ${input.aspectRatio}.` : "Aspect ratio: not set.",
    input.visualStyle ? `Visual style: ${input.visualStyle}` : "",
    scene.characters ? `Characters, keep consistent: ${scene.characters}` : "",
    scene.location ? `Location: ${scene.location}` : "",
    scene.action ? `Action: ${scene.action}` : "",
    scene.camera ? `Camera: ${scene.camera}` : "",
    scene.visual ? `Lighting and look: ${scene.visual}` : "",
    scene.startFrame ? `Start frame: ${scene.startFrame}` : "",
    scene.endFrame ? `End frame: ${scene.endFrame}` : "",
    scene.continuityFrom ? `Continuity from previous: ${scene.continuityFrom}` : "",
    scene.continuityInto ? `Continuity into next: ${scene.continuityInto}` : "",
    scene.voiceover ? `Dialogue or voiceover, spoken naturally: ${scene.voiceover}` : "No dialogue in this scene.",
    input.voiceDirection ? `Voice: ${input.voiceDirection}` : "",
    scene.sfx ? `Sound effects: ${scene.sfx}` : "No added sound effect.",
    scene.musicNotes ? `Music: ${scene.musicNotes}` : "No music cue.",
    "Negative constraints:",
    ...input.constraints.map((rule) => `- ${rule}`),
  ];
  return lines.filter(Boolean).join("\n");
}
