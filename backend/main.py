import os
import urllib.request
import asyncio
import json
import logging
import math
import cv2
import numpy as np
import websockets
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

# Paths to the model files
segmenter_model_path = os.path.join(os.path.dirname(__file__), 'selfie_segmenter.tflite') if __file__ else 'selfie_segmenter.tflite'
hand_model_path = os.path.join(os.path.dirname(__file__), 'hand_landmarker.task') if __file__ else 'hand_landmarker.task'

# Download segmenter model if missing
if not os.path.exists(segmenter_model_path):
    logging.info("Downloading selfie_segmenter.tflite model...")
    url = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite'
    urllib.request.urlretrieve(url, segmenter_model_path)
    logging.info("Selfie segmenter model download complete.")

# Download hand landmarker model if missing
if not os.path.exists(hand_model_path):
    logging.info("Downloading hand_landmarker.task model...")
    url = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task'
    urllib.request.urlretrieve(url, hand_model_path)
    logging.info("Hand landmarker model download complete.")

# Initialize the ImageSegmenter
segmenter_base = python.BaseOptions(model_asset_path=segmenter_model_path)
segmenter_options = vision.ImageSegmenterOptions(
    base_options=segmenter_base,
    running_mode=vision.RunningMode.IMAGE,
    output_confidence_masks=True
)
segmenter = vision.ImageSegmenter.create_from_options(segmenter_options)

# Initialize the HandLandmarker
hand_base = python.BaseOptions(model_asset_path=hand_model_path)
hand_options = vision.HandLandmarkerOptions(
    base_options=hand_base,
    running_mode=vision.RunningMode.IMAGE,
    num_hands=2
)
landmarker = vision.HandLandmarker.create_from_options(hand_options)

def is_hand_fully_open(landmarks):
    # Calculate Euclidean distance
    def dist(p1, p2):
        return math.sqrt((p1.x - p2.x)**2 + (p1.y - p2.y)**2)
        
    # Check 4 fingers: tip y is above PIP joint y (y coordinate is smaller)
    index_open = landmarks[8].y < landmarks[6].y
    middle_open = landmarks[12].y < landmarks[10].y
    ring_open = landmarks[16].y < landmarks[14].y
    pinky_open = landmarks[20].y < landmarks[18].y
    
    # Thumb is open if tip (4) is extended away from pinky MCP (17)
    # than thumb IP joint (3)
    thumb_open = dist(landmarks[4], landmarks[17]) > dist(landmarks[3], landmarks[17])
    
    return all([thumb_open, index_open, middle_open, ring_open, pinky_open])

def is_index_pointing_up(landmarks):
    # Calculate Euclidean distance
    def dist(p1, p2):
        return math.sqrt((p1.x - p2.x)**2 + (p1.y - p2.y)**2)
        
    # Index finger is open (tip Y is above PIP Y)
    index_open = landmarks[8].y < landmarks[6].y
    
    # Middle, Ring, Pinky are closed (tip Y is below PIP Y)
    middle_closed = landmarks[12].y >= landmarks[10].y
    ring_closed = landmarks[16].y >= landmarks[14].y
    pinky_closed = landmarks[20].y >= landmarks[18].y
    
    # Thumb is closed (tip is close to pinky MCP)
    thumb_closed = dist(landmarks[4], landmarks[17]) <= dist(landmarks[3], landmarks[17])
    
    return all([index_open, middle_closed, ring_closed, pinky_closed, thumb_closed])

async def detect_body_edges(websocket):
    logging.info(f"Client connected: {websocket.remote_address}")
    try:
        async for message in websocket:
            if not isinstance(message, bytes):
                continue
            
            nparr = np.frombuffer(message, np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if frame is None:
                continue
            
            h, w, _ = frame.shape
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
            
            # Segment body non-blocking in thread pool
            seg_results = await asyncio.to_thread(segmenter.segment, mp_image)
            
            # Detect hands non-blocking in thread pool
            hand_results = await asyncio.to_thread(landmarker.detect, mp_image)
            
            # Check if any hand has all 5 fingers open & serialize landmarks
            freeze_particles = False
            reverse_particles = False
            hands_data = []
            for hand_landmarks in hand_results.hand_landmarks:
                if is_hand_fully_open(hand_landmarks):
                    freeze_particles = True
                if is_index_pointing_up(hand_landmarks):
                    reverse_particles = True
                
                # Extract joint coordinates
                landmarks_list = []
                for lm in hand_landmarks:
                    landmarks_list.append({
                        "x": float(lm.x),
                        "y": float(lm.y),
                        "z": float(lm.z)
                    })
                hands_data.append(landmarks_list)
            
            # Process segmentation outline using vectorized numpy operations
            if not seg_results.confidence_masks:
                top_edges = [h] * w
                min_y = h
                centroid_x = w // 2
                centroid_y = h // 2
            else:
                mask = seg_results.confidence_masks[0].numpy_view()
                if len(mask.shape) == 3:
                    mask = mask[:, :, 0]
                binary_mask = (mask > 0.45).astype(np.uint8)
                
                # Vectorized search for first index of True (person) in each column
                has_person = binary_mask > 0
                first_y = np.argmax(has_person, axis=0)
                any_person = np.any(has_person, axis=0)
                raw_edges = np.where(any_person, first_y, h)
                
                # Vectorized 1D smoothing convolve
                window_size = 7
                kernel = np.ones(window_size) / window_size
                padded = np.pad(raw_edges, window_size // 2, mode='edge')
                top_edges = np.convolve(padded, kernel, mode='valid').astype(int).tolist()
                
                person_pixels = binary_mask.nonzero()
                if len(person_pixels[0]) > 0:
                    min_y = int(np.min(person_pixels[0]))
                    centroid_y = int(np.mean(person_pixels[0]))
                    centroid_x = int(np.mean(person_pixels[1]))
                else:
                    min_y = h
                    centroid_y = h // 2
                    centroid_x = w // 2
            
            response = {
                "width": w,
                "height": h,
                "top_edges": top_edges,
                "centroid_x": centroid_x,
                "centroid_y": centroid_y,
                "min_y": min_y,
                "freeze_particles": freeze_particles,
                "reverse_particles": reverse_particles,
                "hands": hands_data
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
        await asyncio.Future()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logging.info("Server stopped.")
