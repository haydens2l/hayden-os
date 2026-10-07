#!/usr/bin/env python3
"""One Wan 2.2 TI2V-5B job at a time. Start frame only. No end frame."""

import base64
import json
import os
import subprocess
import sys
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("PORT", "8000"))
TOKEN = os.environ.get("GPU_WORKER_TOKEN", "")
VOLUME = os.environ.get("WAN_VOLUME", "/runpod-volume")
ROOT = os.path.join(VOLUME, "src", "Wan2.2")
CKPT = os.environ.get("WAN_CKPT", os.path.join(VOLUME, "models", "Wan2.2-TI2V-5B"))
JOBS = os.path.join(VOLUME, "jobs")
STATE = {"phase": "starting", "detail": "Worker process started.", "ready": False}
BUSY = threading.Lock()
CURRENT = {"id": None}

PACKAGES = [
    "opencv-python>=4.9.0.80",
    "diffusers>=0.31.0",
    "transformers>=4.49.0,<=4.51.3",
    "tokenizers>=0.20.3",
    "accelerate>=1.1.1",
    "tqdm",
    "imageio[ffmpeg]",
    "easydict",
    "ftfy",
    "dashscope",
    "imageio-ffmpeg",
    "numpy>=1.23.5,<2",
    "huggingface_hub",
    "pillow",
]


def set_phase(phase, detail, ready=False):
    STATE["phase"] = phase
    STATE["detail"] = detail
    STATE["ready"] = ready


def weights_ready(path):
    if not os.path.isdir(path):
        return False
    for folder, _dirs, files in os.walk(path):
        for name in files:
            if name.endswith((".safetensors", ".pth", ".pt", ".bin")):
                if os.path.getsize(os.path.join(folder, name)) > 1_000_000:
                    return True
    return False


def run(cmd, cwd=None):
    completed = subprocess.run(cmd, cwd=cwd, text=True, capture_output=True)
    if completed.returncode != 0:
        tail = (completed.stderr or completed.stdout or "")[-4000:]
        raise RuntimeError(tail or f"Command failed: {' '.join(cmd[:4])}")
    return completed


def prepare():
    try:
        os.makedirs(JOBS, exist_ok=True)
        os.makedirs(os.path.dirname(CKPT), exist_ok=True)
        os.environ["PIP_CACHE_DIR"] = os.path.join(VOLUME, "pip-cache")
        if not os.path.isfile(os.path.join(ROOT, "generate.py")):
            set_phase("installing", "Cloning Wan 2.2 onto the network volume.")
            os.makedirs(os.path.dirname(ROOT), exist_ok=True)
            run(["git", "clone", "--depth", "1", "https://github.com/Wan-Video/Wan2.2.git", ROOT])
        set_phase("installing", "Installing Wan Python packages. The image's CUDA PyTorch is left as-is.")
        run([sys.executable, "-m", "pip", "install", "--upgrade-strategy", "only-if-needed", *PACKAGES])
        if not weights_ready(CKPT):
            set_phase("downloading-weights", "Downloading Wan 2.2 TI2V-5B onto the network volume. This is session time, not a generation.")
            from huggingface_hub import snapshot_download

            snapshot_download(repo_id="Wan-AI/Wan2.2-TI2V-5B", local_dir=CKPT)
        if not weights_ready(CKPT):
            raise RuntimeError("The model folder is still missing weight files.")
        set_phase("ready", "Wan 2.2 TI2V-5B is on the volume. Start-frame generation can run.", ready=True)
    except Exception as error:
        set_phase("error", str(error)[-2000:])


def job_path(job_id):
    return os.path.join(JOBS, job_id)


def read_job(job_id):
    path = os.path.join(job_path(job_id), "job.json")
    if not os.path.isfile(path):
        return None
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def write_job(job):
    folder = job_path(job["id"])
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, "job.json"), "w", encoding="utf-8") as handle:
        json.dump(job, handle)


def newest_mp4(folder, started):
    found = None
    found_mtime = started
    for name in os.listdir(folder):
        if not name.endswith(".mp4"):
            continue
        path = os.path.join(folder, name)
        mtime = os.path.getmtime(path)
        if mtime >= started and (found is None or mtime >= found_mtime):
            found = path
            found_mtime = mtime
    return found


def generate(job):
    folder = job_path(job["id"])
    raw = base64.b64decode(job.pop("imageBase64"))
    if raw[:2] == b"\xff\xd8":
        extension = "jpg"
    elif raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        extension = "webp"
    else:
        extension = "png"
    image = os.path.join(folder, f"start.{extension}")
    output = os.path.join(folder, "output.mp4")
    with open(image, "wb") as handle:
        handle.write(raw)
    command = [
        sys.executable,
        "generate.py",
        "--task",
        "ti2v-5B",
        "--size",
        job["size"],
        "--ckpt_dir",
        CKPT,
        "--offload_model",
        "True",
        "--convert_model_dtype",
        "--t5_cpu",
        "--image",
        image,
        "--prompt",
        job["prompt"],
        "--frame_num",
        str(job["frameNum"]),
        "--save_file",
        output,
    ]
    if job.get("seed") is not None:
        command.extend(["--base_seed", str(job["seed"])])
    job["command"] = command
    job["generationStartedAt"] = iso()
    job["status"] = "RENDERING"
    write_job(job)
    before = iso_epoch()
    completed = subprocess.run(command, cwd=ROOT, text=True, capture_output=True)
    if completed.returncode != 0 and "--frame_num" in (completed.stderr or ""):
        fallback = [part for part in command if part not in ("--frame_num", str(job["frameNum"]))]
        job["frameFallback"] = True
        job["command"] = fallback
        write_job(job)
        completed = subprocess.run(fallback, cwd=ROOT, text=True, capture_output=True)
    job["generationCompletedAt"] = iso()
    log_path = os.path.join(folder, "log.txt")
    with open(log_path, "w", encoding="utf-8") as handle:
        handle.write((completed.stdout or "")[-8000:])
        handle.write("\n")
        handle.write((completed.stderr or "")[-8000:])
    if completed.returncode != 0:
        job["status"] = "FAILED"
        job["error"] = (completed.stderr or completed.stdout or "generate.py failed")[-2000:]
        write_job(job)
        return
    output = newest_mp4(folder, before - 1)
    if output is None:
        output = newest_mp4(ROOT, before - 1)
    if output is None:
        job["status"] = "FAILED"
        job["error"] = "generate.py finished without an MP4."
        write_job(job)
        return
    stored = os.path.join(folder, "output.mp4")
    if os.path.abspath(output) != os.path.abspath(stored):
        os.replace(output, stored)
    job["output"] = stored
    job["status"] = "COMPLETE"
    job.pop("imageBase64", None)
    write_job(job)


def iso():
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def iso_epoch():
    return __import__("time").time()


def start_job(payload):
    if not STATE["ready"]:
        raise RuntimeError(STATE["detail"] or "The worker is not ready.")
    if not BUSY.acquire(blocking=False):
        raise RuntimeError("A generation is already running on this GPU.")
    job_id = str(payload.get("id") or "")
    if not job_id or "/" in job_id or ".." in job_id:
        BUSY.release()
        raise RuntimeError("The job id is missing.")
    job = {
        "id": job_id,
        "status": "QUEUED",
        "prompt": str(payload.get("prompt") or ""),
        "size": str(payload.get("size") or "1280*704"),
        "frameNum": int(payload.get("frameNum") or 121),
        "seed": payload.get("seed"),
        "imageBase64": payload.get("imageBase64"),
        "createdAt": iso(),
    }
    if not job["prompt"] or not job["imageBase64"]:
        BUSY.release()
        raise RuntimeError("A prompt and a start frame are required.")
    write_job({key: value for key, value in job.items() if key != "imageBase64"})

    def work():
        try:
            CURRENT["id"] = job_id
            generate(job)
        except Exception:
            failed = read_job(job_id) or {"id": job_id}
            failed["status"] = "FAILED"
            failed["error"] = traceback.format_exc()[-2000:]
            write_job(failed)
        finally:
            CURRENT["id"] = None
            BUSY.release()

    threading.Thread(target=work, daemon=True).start()
    return {"id": job_id, "status": "QUEUED"}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def authorized(self):
        header = self.headers.get("Authorization", "")
        return bool(TOKEN) and header == f"Bearer {TOKEN}"

    def send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self.authorized():
            self.send_json(401, {"error": "Unauthorized"})
            return
        if self.path == "/health":
            self.send_json(200, {"ok": STATE["ready"], "phase": STATE["phase"], "detail": STATE["detail"], "model": "Wan2.2-TI2V-5B", "task": "ti2v-5B"})
            return
        parts = self.path.strip("/").split("/")
        if len(parts) == 2 and parts[0] == "jobs":
            job = read_job(parts[1])
            if not job:
                self.send_json(404, {"error": "Unknown job"})
                return
            public = {key: value for key, value in job.items() if key != "imageBase64"}
            self.send_json(200, public)
            return
        if len(parts) == 3 and parts[0] == "jobs" and parts[2] == "video":
            job = read_job(parts[1])
            output = job.get("output") if job else None
            if not output or not os.path.isfile(output):
                self.send_json(404, {"error": "The MP4 is not ready."})
                return
            with open(output, "rb") as handle:
                data = handle.read()
            self.send_response(200)
            self.send_header("Content-Type", "video/mp4")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        self.send_json(404, {"error": "Not found"})

    def do_POST(self):
        if not self.authorized():
            self.send_json(401, {"error": "Unauthorized"})
            return
        if self.path != "/jobs":
            self.send_json(404, {"error": "Not found"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > 20_000_000:
            self.send_json(413, {"error": "The start frame is missing or too large."})
            return
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            self.send_json(202, start_job(payload))
        except Exception as error:
            self.send_json(400, {"error": str(error)})


def main():
    if not TOKEN:
        print("GPU_WORKER_TOKEN is missing", file=sys.stderr)
        sys.exit(1)
    threading.Thread(target=prepare, daemon=True).start()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"worker listening on {PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
