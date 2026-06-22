### Current Status
* **Workspace & Port:** The server is running on port `3322` (PID `30396`).
* **Recent Changes:** Commit `f6725ae` was pulled, containing frontend media tweaks and modifications to [server/files.js](file:///C:/dev/ai/AIFactory/session-workspace/3571c661-f705-4f9d-8391-b7943bb4cdf1/server/files.js).

### Active Issue
* **Symptom:** Video thumbnails and the hover-play preview features fail to load. The UI displays an endless loading animation with a gloss effect over black thumbnail cards.
* **Diagnostics:** 
  * The server log shows multiple concurrent `ffmpeg` thumbnail jobs crashing with `STATUS_DLL_INIT_FAILED` (exit code `3221225794`).
  * Manual execution of a single thumbnail generation task via NVENC succeeds in under a second.
  * **Root Cause:** In directories containing many episodes (e.g., Yellowstone, Bluey, Spidey), the frontend's Netflix-style card view fires a `/thumbnail` request for every visible card simultaneously. There is currently no concurrency limit (semaphore) on video clip/thumbnail generation, unlike the HEIC image thumbnail processing pipeline which limits active threads. Spawning 30-50 simultaneous `ffmpeg` processes exhausts system resources (GPU encoder sessions or DLL loader limits) and crashes both the hardware-accelerated runs and their software fallbacks.

### Next Steps & Open Threads
* Implement a concurrency limiting mechanism (such as a semaphore or job queue) in the video thumbnail generation path in [server/files.js](file:///C:/dev/ai/AIFactory/session-workspace/3571c661-f705-4f9d-8391-b7943bb4cdf1/server/files.js) (or the relevant server-side file handler) to prevent overloading the system when rendering large media folders.
