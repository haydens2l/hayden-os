import { imageConfig, videoConfig } from "@/lib/executor/providers";

export type HelpSection = {
  id: string;
  title: string;
  paragraphs: string[];
  examples?: string[];
};

export function capabilityGroups() {
  const image = imageConfig();
  const available = [
    "Chief of Staff",
    "Business Brain",
    "Creative concepts",
    "Content Factory production packs",
    "AI team: Creative Director, Visual Director, Growth Strategist, Media Director",
  ];
  if (image.configured) {
    available.push("Visual storyboard generation");
    available.push("Start and end frame generation");
  }
  const video = videoConfig();
  if (video.configured) available.push("Individual scene video generation");
  const notConnected = [
    "Final video assembly",
    "Automated video QA",
    "Audio generation as its own step",
    "Meta ads",
    "Publishing",
    "Grok Bot on the desktop",
  ];
  if (!image.configured) notConnected.unshift("Image generation is built, but the provider key is not set");
  if (!video.configured) notConnected.unshift("Video generation is built and not configured");
  return {
    available,
    notConnected,
    planned: ["Final video assembly", "Automated video QA", "Publishing", "Sales Director, RevOps, CFO, Research, and BDM"],
    video: {
      built: true,
      configured: video.configured,
      reason: video.configured ? "The Gemini key is set." : "Gemini API key not currently configured.",
    },
  };
}

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: "getting-started",
    title: "Getting started",
    paragraphs: [
      "Hayden OS is the command screen for the businesses. You ask for an outcome. The system routes it. You approve the things that matter.",
      "Start on Command. Type what you want in plain English. Today is the short list of what needs you. Content is where a video becomes a pack, then pictures.",
    ],
  },
  {
    id: "what-it-does",
    title: "What Hayden OS does",
    paragraphs: [
      "It keeps the businesses separate, holds the Business Brain, and lets the AI team think. Content Factory writes production instructions. The Production Executor can make image files, and a scene clip, when you ask.",
      "A concept is not a pack. A pack is not an image. An image is not a scene clip. A scene clip is not the finished video. Nothing is published from here.",
    ],
  },
  {
    id: "chief",
    title: "How to talk to Chief of Staff",
    paragraphs: [
      "On Command, ask for the outcome, not every step. A broad request such as having the team develop something comes back as a few options. You approve, ask for changes, or reject.",
      "The Chief routes work. The Chief does not publish, spend, or approve a concept for you.",
    ],
    examples: ["What should I be working on today?", "What's waiting on me?", "Why is this a priority?"],
  },
  {
    id: "content",
    title: "How to create content",
    paragraphs: [
      "Create content from Content. Name the brand and the idea. Creative Director writes a concept, then a script. Nothing is locked until you say so.",
      "Approve the concept. Read the script. Lock the script. Then choose a visual style from the library. The storyboard does not start until a style is chosen.",
      "Review the storyboard sheet. Ask for a new pass if the film is wrong. Approving the visuals locks the script, style, and board. Only then does Content Factory build the production pack.",
      "Start and end frames come from the approved storyboard. Video stays paused until you ask. To make a new style, propose it from a reference and approve it. One upload is not a style until you save it.",
      "A new pass can keep the same script and style, or send you back to choose a different style. The old board stays. Legacy packs stay on Content and are labelled legacy. No approval was invented for them.",
    ],
    examples: [
      "Come up with three Property Made Simple videos around paying your mortgage off faster.",
      "Make the second concept more entertaining.",
      "Approve concept two.",
      "Turn this into a production pack.",
    ],
  },
  {
    id: "storyboard",
    title: "How to create a visual storyboard",
    paragraphs: [
      "Open the production pack under Content. Create visual direction first. That locks the medium from the approved concept and writes a shot plan. Then click Generate visual storyboard.",
      "Each frame is judged by looking at the image, not the prompt. A file that fails the style or the split is not shown as a pass. Obvious failures can be regenerated twice. After that, the frame is marked Needs Hayden.",
      "You can approve a frame, write a short note such as Too corporate, or save it as a style, character, or environment reference. One note does not become a brand rule. A repeated pattern can be suggested for you to approve.",
      "Idea, then Creative Director, then you approve the concept. Visual Director writes the world and the shot plan. Generate the storyboard. AI visual QA fixes obvious failures. You review. An approved storyboard is the blueprint for start and end frames. Video stays paused.",
    ],
    examples: ["Make me a visual storyboard."],
  },
  {
    id: "frames",
    title: "How to generate start and end frames",
    paragraphs: [
      "On an AI-video pack, click Generate frames. If a shot plan exists, start and end frames use the locked style, the shot plan, and the character anchor. They do not start from the old live-action prompt.",
      "Approving a still means you accept that image for production. It does not mean the scene is filmed or the video exists.",
    ],
    examples: ["Generate the start and end frames."],
  },
  {
    id: "video-scenes",
    title: "How to generate video scenes",
    paragraphs: [
      "Approve the concept. Send it to Content Factory. Generate a storyboard if you want one. Generate the start and end frames. Approve both frames for a scene. Then click Generate video on that scene, or Generate video scenes for every scene that is ready.",
      "Hayden OS sends the approved start frame, the approved end frame, and the scene prompt to Gemini Omni Flash. You can leave the page. The job stays on the scene. When the clip is stored, it plays on the pack. Approve it, or write what was wrong and regenerate. The old clip stays.",
      "A scene video is one clip. It is not the final assembled video. Voiceover, music, and sound notes are included in the prompt because this model can generate audio. They are not marked finished. If a scene asks for a length outside 3 to 10 seconds, it is refused. Inside that range, the model still chooses the exact length.",
      "Video generation is paused. Built: yes. Configured: no. Reason: the Gemini API key is not currently configured. That is intentional. Hayden OS will not ask you to add it, and it will not submit a paid video job.",
    ],
    examples: [
      "Generate the video for Scene 1.",
      "Generate all ready scenes.",
      "Which scenes are missing frames?",
      "Regenerate Scene 2. Keep the same character but slow the movement down.",
      "Why did Scene 3 fail?",
      "How much will it cost to generate the remaining scenes?",
      "Show me the prompt used for Scene 2.",
    ],
  },
  {
    id: "gpu-test",
    title: "How to run the rented GPU test",
    paragraphs: [
      "Content, then GPU test. This is a separate proof from Gemini. Gemini stays paused.",
      "Start GPU rents an RTX 4090 and keeps the Wan weights on a Runpod network volume. The first start can take a long time because it downloads the model. That time is session cost. Generate sends one start frame and a prompt. An end frame is stored and is not sent.",
      "The page shows two money figures. Generation cost is only the render itself. GPU session cost includes startup, model load, the render, retries, idle time, and the stop. The session figure is the production infrastructure cost. Approve or reject the clip yourself.",
      "Stop GPU when you are done. The machine bills until Runpod accepts the stop, including while the page is open.",
    ],
  },
  {
    id: "review",
    title: "How to approve, reject, or regenerate",
    paragraphs: [
      "Under each picture: Approve, Reject, or Regenerate. Approve keeps the file and marks it approved by you. Reject keeps the file and marks it rejected. Regenerate keeps the old file and makes a new version. Put a note in the box first if you want a change, such as the character looking too polished.",
      "A failed attempt stays on the record with the error. Use Generate again to retry. It will not delete the pack or the earlier pictures.",
    ],
    examples: ["Regenerate Scene 3. Dave looks too polished.", "Keep the same character but make the location feel more Australian suburban."],
  },
  {
    id: "assign",
    title: "How to assign work",
    paragraphs: [
      "Say give this to Lily, have Danny make this, or AP can handle this. You can also assign on the work page.",
      "Lily executes production from the brief. Danny does paid AI-video fulfilment. That is not the same as making him Creative Director. AP is operations, systems, and data. Nic is setter coaching. If Business Brain does not name a skill, the answer says so.",
      "The person gets an execution brief. They do not get the rest of the Business Brain.",
    ],
    examples: ["Give this to Lily.", "Have Danny make this.", "Who should own this?"],
  },
  {
    id: "work-moves",
    title: "How work moves through Hayden OS",
    paragraphs: [
      "You create or approve the direction. Hayden OS decides the next stage. An agent or a person does the work. Hayden OS tracks it. It comes back to you only when you are needed. You review. Changes go back to the person who made it. Final approval closes it.",
      "You should not have to remember where everything is. Approving a concept, a storyboard, or a frame is not the same as finishing the work.",
    ],
  },
  {
    id: "executors",
    title: "How Lily and Danny use their work view",
    paragraphs: [
      "Open Work, then Lily or Danny. A card shows the title, brand, owner, status, next action, and whether you are needed.",
      "Open the piece. They see what they are making, why, the brand, the format, the script, the scenes, the frames, the prompts, and what done looks like. They can start, mark it blocked, add a note, or submit it. They cannot approve it as you, change the concept, publish, or spend.",
      "If the concept itself is broken, they return it to creative with a reason.",
    ],
  },
  {
    id: "submit",
    title: "How to submit work",
    paragraphs: [
      "On the brief, add a note, a link, or a file, then click Submit for review. That version is stored. The work becomes ready for review and shows on Today.",
    ],
  },
  {
    id: "review-work",
    title: "How to review work",
    paragraphs: [
      "Today has a short Needs your review list. Open Review. Approve the version, or write what is wrong in normal language.",
      "Only submitted work appears there. Everyone else's in-progress work stays on the Work page.",
    ],
    examples: ["What's waiting on me?"],
  },
  {
    id: "request-changes",
    title: "How to request changes",
    paragraphs: [
      "Write the change the way you would say it. The first three seconds are too slow. Dave looks different in scene 4. The old version stays. The person makes another one.",
    ],
    examples: ["Ask Lily for changes: the first three seconds are too slow."],
  },
  {
    id: "complete-work",
    title: "How to complete work",
    paragraphs: [
      "Approve the submitted version. The work is complete, the file or link stays attached, and it stops asking for you. The record says who made it, how many versions there were, and what feedback was needed. It does not say the style performed better.",
    ],
    examples: ["Approve this."],
  },
  {
    id: "waiting",
    title: "How to see what's waiting on you",
    paragraphs: ["Ask what's waiting on me. The answer is only work that actually needs you: a review, a decision, or a blocker that names you."],
    examples: ["What's waiting on me?", "Which work is blocked because of me?"],
  },
  {
    id: "everyone",
    title: "How to see what everyone is doing",
    paragraphs: ["Ask what is everyone working on, what has Lily got, or what has Danny finished. The answer comes from stored work, not a guess. Work you can ignore is the work that does not need you."],
    examples: ["What is everyone working on?", "Show me what Lily is working on.", "What's closest to finished?"],
  },
  {
    id: "blockers",
    title: "How to handle blockers",
    paragraphs: [
      "A blocked piece needs a reason and who it is waiting on. If it is waiting on you, it shows up. If it is waiting on a client, a file, or a tool, it stays tracked and does not take a slot on Today.",
    ],
    examples: ["What's blocked?", "What's stuck?"],
  },
  {
    id: "save-rule",
    title: "How to save feedback as a rule",
    paragraphs: [
      "If a review note looks reusable, Hayden OS suggests a production rule. Dave looks too corporate can become a note that the characters should feel like normal everyday Australians. Save rule keeps it. Just this video leaves it on that version only. Nothing is saved until you choose.",
    ],
    examples: ["Save that feedback as a production rule."],
  },
  {
    id: "today",
    title: "How to use Today",
    paragraphs: [
      "Today is the attention list. It is the short set of items the priority rules put in front of you. An empty morning means nothing stored needs you. It does not mean the businesses are fine, and it does not mean a concept review is hiding there.",
      "Concept reviews sit on Command. Production pictures sit on the pack.",
    ],
    examples: ["What should I be working on today?"],
  },
  {
    id: "brain",
    title: "How to use Business Brain",
    paragraphs: [
      "Business Brain is founder strategy: what each brand is, who it is for, and how it should be treated. Current notes are used. Historical notes are kept and labelled as historical.",
      "A fact, a strategy, and an assumption are not the same thing. The system must not invent live results. If a number is not stored, it should say so.",
    ],
    examples: ["What do you know about Property Made Simple?"],
  },
  {
    id: "team",
    title: "How to use the AI team",
    paragraphs: [
      "Agents are Creative Director, Growth Strategist, Media Director, and Content Factory. You can address one, or ask the Chief to route a broad job.",
      "They share the Business Brain. They do not each keep a private memory. They cannot publish or spend. Content Factory writes the pack. It does not generate images unless you ask the Production Executor.",
    ],
    examples: ["I've got this idea. Tell me if it's worth my time.", "What is everyone working on?"],
  },
  {
    id: "limits",
    title: "What the system cannot do yet",
    paragraphs: [
      "Final video assembly is not built. Automated checks on a clip are not built. Meta is not connected. Nothing can be published from Hayden OS. The Grok Bot app on this Mac is not staff and is not controlled from here.",
      "An image can use one reference picture so a later frame has something to follow. That does not guarantee the same face. If a capability is unknown, the screen should say unknown.",
    ],
  },
  {
    id: "operations",
    title: "Operations intelligence",
    paragraphs: [
      "Operations sits above Aircall and GoHighLevel. Both stay read-only. Hayden OS pulls new records about every 10 minutes while the app is open. The top of Operations says whether each source is current, delayed, stale, or in error.",
      "Open the daily audit for Josh's bookings from the last 7 days. It starts with the GoHighLevel booking, then reads only the Aircall calls around that booking. It does not read every call Josh made.",
      "Show evidence opens the exact lines. A partner saying they cannot attend is not treated as the lead saying they cannot attend. A past appointment stays in historical signals and is not listed as something to act on today.",
      "Open Operations, import a CSV, and map the columns. Status and appointment date are required. Rejected rows are shown. The file name, the date range, and the business stay attached to the import.",
      "A scorecard shows the actual count, a target only if you stored one, the gap, whether the move is large enough to call a change, the period, and the source. A small move is shown with the counts and is not called a trend.",
      "A finding says what happened, the records behind it, and who could handle it. Turn it into work and it lands with AP or Nic in the normal work list. It does not need you unless the finding says it does.",
      "A transcript concern is stored only when the words are stored. An Aircall call is stored as a call, not as what was said. A GoHighLevel appointment counts as sat only when the status says the person showed. Confirmed is stored as booked. An earlier slot is not claimed.",
      "The operations brief is a page you open when you want it. It is not added to the morning list.",
    ],
    examples: [
      "Check Josh's bookings from the last week.",
      "Did any of Josh's booked leads say they might not make it?",
      "Any partner attendance issues?",
      "Which appointments could potentially be brought forward?",
      "Show me the exact words.",
      "Which bookings couldn't you check?",
      "How fresh is the data?",
      "Which no-shows haven't been chased?",
      "Turn this finding into work for AP.",
    ],
  },
  {
    id: "josh-audit",
    title: "Josh appointment audit",
    paragraphs: [
      "Open Operations, then Daily audit. The Josh section is the last 7 days.",
      "The numbers at the top are bookings, conversations found, transcripts, analysed, and the ones that could not be checked. Coverage is bookings analysed divided by Josh's bookings. It is not a count of every call.",
      "Lead attendance means the lead themselves sounded unsure about showing up. Partner attendance means their partner or spouse did. Those are separate.",
      "Bring-forward only lists an upcoming appointment, and only when the lead actually said they were flexible. It does not mean an earlier time is free.",
      "Show evidence opens the exact words. Historical signals are bookings that have already passed. They stay there so you can read them, and they are not today's action list.",
      "Data health is the first block on Operations. Current means a successful sync in the last 15 minutes. If a no-show is older than the calls Hayden OS has stored, recovery says unknown rather than zero attempts.",
    ],
    examples: [
      "Check Josh's bookings from the last week.",
      "Did any of Josh's booked leads say they might not make it?",
      "Any partner attendance issues?",
      "Which appointments could potentially be brought forward?",
      "Show me the exact words.",
      "Which bookings couldn't you check?",
      "How fresh is the data?",
    ],
  },
  {
    id: "examples",
    title: "Example commands",
    paragraphs: ["Type these on Command. The ones that make images spend a few cents each and only run when you ask."],
    examples: [
      "What should I be working on today?",
      "I've got this idea. Tell me if it's worth my time.",
      "Come up with three Property Made Simple videos around paying your mortgage off faster.",
      "Make the second concept more entertaining.",
      "Approve concept two.",
      "Turn this into a production pack.",
      "Make me a visual storyboard.",
      "Generate the start and end frames.",
      "Generate the video for Scene 1.",
      "Generate all ready scenes.",
      "Which scenes are missing frames?",
      "Regenerate Scene 2. Keep the same character but slow the movement down.",
      "Why did Scene 3 fail?",
      "How much will it cost to generate the remaining scenes?",
      "Show me the prompt used for Scene 2.",
      "Regenerate Scene 3. Dave looks too polished.",
      "Keep the same character but make the location feel more Australian suburban.",
      "Assign this to Lily.",
      "What's waiting on me?",
      "What is everyone working on?",
      "Why is this a priority?",
      "What do you know about Property Made Simple?",
    ],
  },
];
