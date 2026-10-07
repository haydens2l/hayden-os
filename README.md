# Hayden OS

Private founder system. This repository is the current build of the AI video factory and the app it lives inside. It is here so a developer can see what already works and quote the rest.

API keys, the local database, and generated images are not in this repo. Copy `.env.example` to `.env` and add keys locally.

## Run it

```bash
npm install
cp .env.example .env
npm run dev
```

Open http://localhost:3210.

## What the video factory already does

Content is not a production pack first. The path is:

1. Create content from an idea.
2. Creative Director writes a concept, then a script.
3. Hayden approves the concept and locks the script.
4. Hayden chooses a visual style. Nine style bibles exist. None of them have their approved reference images attached yet.
5. Visual Director plans the world inside that style.
6. A storyboard is generated, checked against the actual image, and reviewed.
7. A visual lock is the gate. Only then can Content Factory write a production pack.
8. Start and end frames are meant to follow the approved storyboard.
9. Video execution is a separate handoff. The GPU does not choose the creative.

Image generation uses xAI `grok-imagine-image-2.0`. The visual critic uses a vision-capable text model and looks at the file, not only the prompt.

## What is built but not finished

- Style reference images still need to be added by Hayden. Do not invent stand-ins.
- Storyboard generation for a new film waits until the script is locked and a style is chosen.
- Gemini scene video is built and not configured. Do not add a Gemini key unless asked.
- The Runpod GPU proof is built and has not been started from this app. Do not start a pod unless asked. Nothing in this repo should begin billing.
- Final video assembly, audio as its own step, and publishing are not built.

## What a quote is for

Finish the factory from an approved storyboard through start frame, end frame, generated scene video, and a review Hayden can accept. Do not rebuild the creative workflow from scratch, and do not start Sales, finance, ads, or publishing work as part of that quote unless it is asked for separately.

The same app also contains operations tools. Those are not the video-factory job.
