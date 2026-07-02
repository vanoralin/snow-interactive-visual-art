import os
import urllib.request
import asyncio
import json
import logging
import cv2
import numpy as np
import websockets
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

# Path to the TFLite model file
model_path = os.path.join(os.path.dirname(__file__), 'selfie_segmenter.tflite') if __file__ else 'selfie_segmenter.tflite'

# Download the model from Google's CDN if it doesn't exist locally
if not os.path.exists(model_path):
    logging.info("Downloading selfie_segmenter.tflite model...")
    url = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite'
    urllib.request.urlretrieve(url, model_path)
    logging.info("Model download complete.")

# Initialize the ImageSegmenter from the downloaded TFLite model options
base_options = python.BaseOptions(model_asset_path=model_path)
options = vision.ImageSegmenterOptions(
    base_options=base_options,
    running_mode=vision.RunningMode.IMAGE,
    output_confidence_masks=True
)
segmenter = vision.ImageSegmenter.create_from_options(options)

async def detect_body_edges(websocket):
    logging.info(f"Client connected: {websocket.remote_address}")
    try:
        async for message in websocket:
            if not isinstance(message, bytes):
                continue
            
            # Decode JPEG binary data
            nparr = np.frombuffer(message, np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if frame is None:
                continue
            
            h, w, _ = frame.shape
            
            # MediaPipe expects RGB images
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
            
            results = segmenter.segment(mp_image)
            
            if not results.confidence_masks:
                # No mask found, send empty edges (at the bottom of the frame)
                await websocket.send(json.dumps({
                    "width": w,
                    "height": h,
                    "top_edges": [h] * w,
                    "centroid_x": w // 2,
                    "centroid_y": h // 2,
                    "min_y": h
                }))
                continue
            
            # Extract the first confidence mask (person)
            mask = results.confidence_masks[0].numpy_view()
            if len(mask.shape) == 3:
                mask = mask[:, :, 0]
                
            # Values above 0.45 represent the person
            binary_mask = (mask > 0.45).astype(np.uint8)
            
            # Find the top edge Y coordinate for each column
            top_edges = []
            for x in range(w):
                col = binary_mask[:, x]
                indices = np.where(col > 0)[0]
                if len(indices) > 0:
                    top_edges.append(int(indices[0]))
                else:
                    top_edges.append(h)
            
            # Smooth the edges using a 1D moving average filter to reduce jitter
            smoothed_edges = []
            window_size = 7
            half_window = window_size // 2
            for i in range(w):
                start = max(0, i - half_window)
                end = min(w, i + half_window + 1)
                smoothed_edges.append(int(np.mean(top_edges[start:end])))
            
            # Calculate centroid & min Y for general body location tracking
            person_pixels = np.where(binary_mask > 0)
            if len(person_pixels[0]) > 0:
                min_y = int(np.min(person_pixels[0]))
                centroid_y = int(np.mean(person_pixels[0]))
                centroid_x = int(np.mean(person_pixels[1]))
            else:
                min_y = h
                centroid_y = h // 2
                centroid_x = w // 2
                
            # Send coordinates back to browser
            response = {
                "width": w,
                "height": h,
                "top_edges": smoothed_edges,
                "centroid_x": centroid_x,
                "centroid_y": centroid_y,
                "min_y": min_y
            }
            await websocket.send(json.dumps(response))
            
    except websockets.exceptions.ConnectionClosed:
        logging.info(f"Client disconnected: {websocket.remote_address}")
    except Exception as e:
        logging.error(f"Error processing frame: {e}")

async def main():
    port = 8765
    async with websockets.serve(detect_body_edges, "0.0.0.0", port):
        logging.info(f"WebSocket AI detection server started on ws://localhost:{port}")
        await asyncio.Future()  # run forever

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logging.info("Server stopped by user.")
