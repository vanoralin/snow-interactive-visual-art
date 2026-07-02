# ❄️ Snowfall Body Outline Interactive Art

An interactive, real-time visual art project that combines a web application with Artificial Intelligence (AI) to detect the user's body silhouette and hand gestures via webcam. Falling snow particles land on your head and shoulders, slide down naturally, or respond dynamically to your hand gestures in real-time.

---

## ✨ Features
- **AI Body Segmentation & Hand Tracking**: Runs the **MediaPipe Selfie Segmentation** and **Hand Landmarker** models concurrently on a Python backend to extract body outlines and analyze finger joint positions.
- **Interactive Gestures Control**:
  - **Open Hand (5-Finger Spread)**: Triggers the **"Freeze Effect"**, locking all active snow particles in mid-air (pausing gravity).
  - **Pointing Index Finger Up**: Triggers **"Gravity Reverse"**, making the snow particles float rapidly upwards back into the sky, smoothly morphing from round circles into warp streaks (motion blur lines) based on their velocity.
- **Hand Tracking Toggle**: A dedicated UI button to quickly toggle hand tracking/gestures on or off, falling back to a normal snowfall visualizer.
- **Premium Glassmorphism Tooltips**: Sleek, frosted-glass tooltips that smoothly scale and fade in on hover, explaining the exact gesture controls.
- **Clean Camera View & Background**: Displays the camera feed with original, natural webcam colors (100% opacity) and removes decorative background distractions (fairy lights) for a modern, minimalist aesthetic.
- **Real-Time Latency Optimizations**:
  - **Send-on-Acknowledgment Loop**: The browser only sends a frame once the response from the previous frame is processed, guaranteeing zero queue buildup and the lowest possible latency.
  - **Non-blocking IO (Parallel Threads)**: Runs CPU-bound MediaPipe inference on separate threads via `asyncio.to_thread` to keep the WebSocket server responsive.
  - **Vectorized NumPy Outline Search**: Vectorized search algorithms (`np.argmax`, `np.convolve`) locate body edges and apply 1D smoothing in sub-milliseconds, replacing slow Python iteration loops.

---

## 🏗️ Architecture

```
[ Web Browser (Frontend) ]
      │
      │ 1. Sends 320x240 camera frames (JPEG Binary Blob) one frame at a time (wait-for-ack)
      ▼
[ Python Server (Backend: ws://localhost:8765) ] ──► MediaPipe AI processing (Seg. & Hands)
      │
      │ 2. Sends body edges, hand joints, and gesture state flags (JSON) back
      ▼
[ HTML5 Canvas (Render) ] ──► Simulates snow sliding or morphs particles to fly upwards
```

---

## 🛠️ Tech Stack

### Client Side (Frontend)
- **Vite** (Next-generation frontend tooling)
- **pnpm** (Fast, disk space efficient package manager)
- **HTML5 Canvas API** (Draws snow particles, hand skeletons, and handles physics calculations)

### AI Server Side (Backend)
- **Python 3.10+**
- **MediaPipe Tasks API** (Core AI engines for segmentation and hand landmarks)
- **OpenCV & NumPy** (High-speed image decoding and vectorized edge processing)
- **Websockets** (Low-latency bidirectional data communication)

---

## 🚀 Setup & Installation

### 1. Python AI Backend Setup

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Install the required Python packages:
   ```bash
   pip install -r requirements.txt
   ```
3. Start the WebSocket server:
   ```bash
   python main.py
   ```
   *(On its first run, the script will automatically download the `selfie_segmenter.tflite` and `hand_landmarker.task` models from Google's public CDN. The server will print `WebSocket AI detection server started on ws://localhost:8765` when ready).*

---

### 2. Vite Frontend Setup

1. Open a new terminal in the project's root folder.
2. Install the web dependencies:
   ```bash
   pnpm install
   ```
3. Start the development server:
   ```bash
   pnpm run dev
   ```
4. Open your browser and navigate to the displayed URL (usually [http://localhost:5173/](http://localhost:5173/)).
5. Click the circular camera icon button to activate the AI webcam tracking and have fun!

---

## 📂 Folder Structure

```
snow/
├── backend/
│   ├── main.py                 # WebSocket server handles AI model inferences
│   └── requirements.txt        # Python package dependencies
├── src/
│   ├── main.js                 # Snow simulation logic, WS communication & skeleton rendering
│   └── style.css               # Premium styles, circular buttons & glassmorphism tooltips
├── index.html                  # HTML template with SVG icon buttons
├── package.json                # Project configurations & dependencies
├── .gitignore                  # Git ignore rules (binaries .tflite & .task are ignored)
└── README.md                   # Project documentation (English version)
```
