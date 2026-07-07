import cv2
import numpy as np
from ultralytics import YOLO

# =====================================================================
# STEP 1: LOAD YOLOv8 MODEL & DEFINE VARIABLES
# =====================================================================
# Load the pre-trained YOLOv8 Nano model (lightweight, runs fast on CPU/GPU)
model = YOLO('yolov8n.pt') 

# Define COCO class IDs that represent vehicles in standard YOLO models:
# 2: car, 3: motorcycle, 5: bus, 7: truck
VEHICLE_CLASSES = [2, 3, 5, 7]

# Note: Standard YOLO models trained on COCO do not have a separate 'ambulance' class 
# (they are classified as trucks/cars). If you train a custom YOLO model, you will have 
# a specific ID for emergency vehicles. For this code, we simulate emergency vehicle detection
# by checking if a vehicle matches a specific index or custom parameter.
EMERGENCY_CLASS_ID = 999  # Replace with your custom class ID once trained

# Define Lane Regions of Interest (ROIs) as bounding boxes [x1, y1, x2, y2]
# Adjust these coordinates to match your actual camera feed resolution (e.g. 640x480)
LANES = {
    "Lane_1": [50, 200, 180, 480],   # [left, top, right, bottom]
    "Lane_2": [190, 200, 320, 480],
    "Lane_3": [330, 200, 460, 480],
    "Lane_4": [470, 200, 600, 480]
}

# Variable to keep track of which lane currently has the green light
active_green_lane = "Lane_1"

# =====================================================================
# STEP 2: HELPER FUNCTION TO ASSIGN VEHICLES TO LANES
# =====================================================================
def get_lane_for_vehicle(x_center, y_center):
    """
    Checks which Lane boundary box contains the center point of the detected vehicle.
    """
    for lane_name, box in LANES.items():
        x1, y1, x2, y2 = box
        if x1 <= x_center <= x2 and y1 <= y_center <= y2:
            return lane_name
    return None  # Vehicle is outside monitored lanes

# =====================================================================
# STEP 3: MAIN PROCESSING LOOP (FOR CAMERA / VIDEO FILE)
# =====================================================================
def start_traffic_controller(video_source=0):
    global active_green_lane
    
    # Open camera stream or video file (0 is default webcam)
    cap = cv2.VideoCapture(video_source)
    
    if not cap.isOpened():
        print(f"Error: Could not open video source {video_source}")
        return

    print("Intelligent Traffic System running. Press 'q' to quit.")

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        # Resize frame to standard 640x480 for fast processing
        frame = cv2.resize(frame, (640, 480))

        # Run YOLOv8 object detection on the frame
        results = model(frame, verbose=False)[0]

        # Reset counters for the current frame
        lane_densities = {"Lane_1": 0, "Lane_2": 0, "Lane_3": 0, "Lane_4": 0}
        emergency_detected = {"Lane_1": False, "Lane_2": False, "Lane_3": False, "Lane_4": False}

        # Analyze detections
        for box in results.boxes:
            # Extract coordinates, confidence score, and class ID
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            conf = float(box.conf[0])
            cls_id = int(box.cls[0])

            # Process only if detected object is a vehicle
            if cls_id in VEHICLE_CLASSES or cls_id == EMERGENCY_CLASS_ID:
                # Compute center point of the vehicle's bounding box
                cx = (x1 + x2) // 2
                cy = (y1 + y2) // 2

                # Determine which lane the vehicle belongs to
                lane_name = get_lane_for_vehicle(cx, cy)
                
                if lane_name:
                    lane_densities[lane_name] += 1
                    
                    # Check if this vehicle is classified as an Emergency Vehicle
                    # (Here we simulate it by checking if it is a truck with high confidence, 
                    # or you can link this to custom model classification).
                    if cls_id == EMERGENCY_CLASS_ID:
                        emergency_detected[lane_name] = True
                    
                    # Draw a bounding box around the vehicle
                    color = (0, 0, 255) if cls_id == EMERGENCY_CLASS_ID else (255, 255, 0)
                    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
                    cv2.putText(frame, f"Veh {conf:.2f}", (x1, y1 - 5),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1)

        # =================================================================
        # STEP 4: SMART DYNAMIC TRAFFIC SIGNAL LOGIC
        # =================================================================
        # 1. Rule 1: Priority Override if any lane has an emergency vehicle
        has_emergency = False
        for lane_name, detected in emergency_detected.items():
            if detected:
                active_green_lane = lane_name
                has_emergency = True
                break  # Green light goes to first lane with emergency vehicle

        # 2. Rule 2: If no emergency vehicle, allocate green based on highest density
        if not has_emergency:
            # Find the lane name with the maximum vehicle count
            highest_density_lane = max(lane_densities, key=lane_densities.get)
            
            # Switch green light if the busiest lane has at least 1 vehicle
            if lane_densities[highest_density_lane] > 0:
                active_green_lane = highest_density_lane

        # =================================================================
        # STEP 5: VISUALIZE LENS BOUNDARIES & SIGNAL STATES
        # =================================================================
        for lane_name, box in LANES.items():
            x1, y1, x2, y2 = box
            
            # Determine color of lane boundary based on signal state
            # Green if active_green_lane, Red otherwise
            is_green = (lane_name == active_green_lane)
            lane_color = (0, 255, 0) if is_green else (0, 0, 255)
            
            # Draw Lane border lines
            cv2.rectangle(frame, (x1, y1), (x2, y2), lane_color, 2)
            
            # Display text label: Density and Signal state
            status_text = "GREEN" if is_green else "RED"
            label = f"{lane_name}: Count={lane_densities[lane_name]} [{status_text}]"
            cv2.putText(frame, label, (x1, y1 - 8),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, lane_color, 2)

            # Draw a visual light indicator (circle) at the top of each lane
            indicator_center = (x1 + (x2 - x1) // 2, y1 + 20)
            cv2.circle(frame, indicator_center, 12, lane_color, -1)

        # Display Emergency warning banner if active
        if has_emergency:
            cv2.rectangle(frame, (10, 10), (630, 40), (0, 0, 255), -1)
            cv2.putText(frame, "!!! EMERGENCY VEHICLE PREEMPTION ACTIVE !!!", (60, 32),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)

        # Render the monitor window
        cv2.imshow("ITS - 4 Lane YOLOv8 Smart Controller", frame)

        # Press 'q' key to stop execution loop
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    # To test on your laptop camera, set video_source=0
    # To test on a recorded video file, set video_source='path_to_video.mp4'
    start_traffic_controller(video_source=0)
