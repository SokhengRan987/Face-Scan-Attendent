from flask import Flask, render_template, Response, jsonify, request, send_file
import cv2
import os
import numpy as np
import pandas as pd
from datetime import datetime
import threading
import time
import io

app = Flask(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATASET_PATH = os.path.join(BASE_DIR, "dataset")
USERS_FILE = os.path.join(BASE_DIR, "users.xlsx")
ATTENDANCE_FILE = os.path.join(BASE_DIR, "attendance.xlsx")

os.makedirs(DATASET_PATH, exist_ok=True)

# ==========================
# GLOBAL CAMERA STATE
# ==========================
camera = None
camera_lock = threading.Lock()
current_mode = None          # 'register' or 'recognize'
register_data = {}           # holds name/sex/class during registration
capture_count = 0
MAX_IMAGES = 20
recognition_result = {}      # last recognition result
frame_overlay = {}           # per-frame overlay info (boxes, labels)


def get_camera():
    global camera
    if camera is None or not camera.isOpened():
        camera = cv2.VideoCapture(0)
    return camera


def release_camera():
    global camera, current_mode
    with camera_lock:
        if camera and camera.isOpened():
            camera.release()
        camera = None
        current_mode = None


# ==========================
# FACE RECOGNITION HELPERS
# ==========================
def load_and_train():
    faces, labels, label_dict = [], [], {}
    current_id = 0
    if not os.path.isdir(DATASET_PATH):
        return None, {}
    for person_name in os.listdir(DATASET_PATH):
        person_folder = os.path.join(DATASET_PATH, person_name)
        if not os.path.isdir(person_folder):
            continue
        label_dict[current_id] = person_name
        for img_name in os.listdir(person_folder):
            img_path = os.path.join(person_folder, img_name)
            img = cv2.imread(img_path, cv2.IMREAD_GRAYSCALE)
            if img is None:
                continue
            faces.append(img)
            labels.append(current_id)
        current_id += 1
    if not faces:
        return None, {}
    recognizer = cv2.face.LBPHFaceRecognizer_create()
    recognizer.train(faces, np.array(labels))
    return recognizer, label_dict


def mark_attendance(name):
    now = datetime.now()
    time_str = now.strftime("%Y-%m-%d %H:%M:%S")
    today = now.strftime("%Y-%m-%d")

    try:
        df_att = pd.read_excel(ATTENDANCE_FILE)
    except Exception:
        df_att = pd.DataFrame(columns=["Name", "Sex", "Class", "Time"])

    try:
        df_users = pd.read_excel(USERS_FILE)
    except Exception:
        return False, "users.xlsx not found"

    user = df_users[df_users["Name"] == name]
    if user.empty:
        return False, f"User '{name}' not in users.xlsx"

    already = (
        (df_att["Name"] == name) &
        (df_att["Time"].astype(str).str.startswith(today))
    ).any()
    if already:
        return False, "Already marked today"

    new_row = {
        "Name": name,
        "Sex": user.iloc[0]["Sex"],
        "Class": user.iloc[0]["Class"],
        "Time": time_str,
    }
    df_att = pd.concat([df_att, pd.DataFrame([new_row])], ignore_index=True)
    df_att.to_excel(ATTENDANCE_FILE, index=False)
    return True, f"Attendance marked for {name}"


# ==========================
# VIDEO STREAM GENERATOR
# ==========================
face_cascade = cv2.CascadeClassifier(
    cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
)


def generate_frames():
    global current_mode, capture_count, recognition_result, register_data

    recognizer, label_dict = None, {}

    cam = get_camera()

    while True:
        with camera_lock:
            if camera is None or not camera.isOpened():
                break
            ret, frame = camera.read()

        if not ret:
            time.sleep(0.05)
            continue

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        detected = face_cascade.detectMultiScale(gray, 1.3, 5)

        # ---- REGISTER MODE ----
        if current_mode == "register":
            person_name = register_data.get("name", "unknown")
            person_path = os.path.join(DATASET_PATH, person_name)
            os.makedirs(person_path, exist_ok=True)

            for (x, y, w, h) in detected:
                face_img = gray[y:y+h, x:x+w]
                face_img = cv2.resize(face_img, (200, 200))

                if capture_count < MAX_IMAGES:
                    file_path = os.path.join(person_path, f"{capture_count}.jpg")
                    cv2.imwrite(file_path, face_img)
                    capture_count += 1

                color = (0, 255, 100)
                cv2.rectangle(frame, (x, y), (x+w, y+h), color, 2)
                label = f"Captured: {capture_count}/{MAX_IMAGES}"
                cv2.putText(frame, label, (x, y-10),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)

            if capture_count >= MAX_IMAGES:
                current_mode = None

        # ---- RECOGNIZE MODE ----
        elif current_mode == "recognize":
            if recognizer is None:
                recognizer, label_dict = load_and_train()

            for (x, y, w, h) in detected:
                face_img = gray[y:y+h, x:x+w]
                face_img = cv2.resize(face_img, (200, 200))

                if recognizer:
                    label_id, confidence = recognizer.predict(face_img)
                    name = label_dict.get(label_id, "Unknown")

                    if confidence < 100:
                        color = (0, 255, 80)
                        cv2.rectangle(frame, (x, y), (x+w, y+h), color, 2)
                        cv2.putText(frame, name, (x, y-10),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.85, color, 2)
                        saved, msg = mark_attendance(name)
                        recognition_result = {
                            "name": name,
                            "confidence": round(float(confidence), 1),
                            "saved": saved,
                            "message": msg,
                            "time": datetime.now().strftime("%H:%M:%S"),
                        }
                    else:
                        color = (0, 60, 255)
                        cv2.rectangle(frame, (x, y), (x+w, y+h), color, 2)
                        cv2.putText(frame, "Unknown", (x, y-10),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.85, color, 2)
                        recognition_result = {
                            "name": "Unknown",
                            "confidence": round(float(confidence), 1),
                            "saved": False,
                            "message": "Face not recognized",
                            "time": datetime.now().strftime("%H:%M:%S"),
                        }

        # Encode frame
        ret2, buffer = cv2.imencode(".jpg", frame)
        if not ret2:
            continue
        yield (b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" +
               buffer.tobytes() + b"\r\n")


# ==========================
# ROUTES
# ==========================
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/video_feed")
def video_feed():
    return Response(generate_frames(),
                    mimetype="multipart/x-mixed-replace; boundary=frame")


@app.route("/start_camera")
def start_camera():
    cam = get_camera()
    if cam.isOpened():
        return jsonify({"status": "ok"})
    return jsonify({"status": "error", "message": "Camera not available"}), 500


@app.route("/stop_camera")
def stop_camera():
    release_camera()
    return jsonify({"status": "ok"})


@app.route("/start_register", methods=["POST"])
def start_register():
    global current_mode, capture_count, register_data
    data = request.json
    name = data.get("name", "").strip()
    sex = data.get("sex", "").strip().upper()
    user_class = data.get("class", "").strip().upper()

    if not name or not sex or not user_class:
        return jsonify({"status": "error", "message": "All fields required"}), 400

    # Save to users.xlsx
    try:
        df = pd.read_excel(USERS_FILE)
    except Exception:
        df = pd.DataFrame(columns=["Name", "Sex", "Class", "Date"])

    if name not in df["Name"].values:
        new = pd.DataFrame([{
            "Name": name,
            "Sex": sex,
            "Class": user_class,
            "Date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }])
        df = pd.concat([df, new], ignore_index=True)
        df.to_excel(USERS_FILE, index=False)

    register_data = {"name": name, "sex": sex, "class": user_class}
    capture_count = 0
    current_mode = "register"
    return jsonify({"status": "ok", "message": f"Registering {name}..."})


@app.route("/register_status")
def register_status():
    return jsonify({
        "count": capture_count,
        "max": MAX_IMAGES,
        "done": current_mode != "register" and capture_count >= MAX_IMAGES,
    })


@app.route("/start_recognize")
def start_recognize():
    global current_mode, recognition_result
    current_mode = "recognize"
    recognition_result = {}
    return jsonify({"status": "ok"})


@app.route("/recognition_result")
def get_recognition_result():
    return jsonify(recognition_result)


@app.route("/stop_recognize")
def stop_recognize():
    global current_mode
    current_mode = None
    return jsonify({"status": "ok"})


@app.route("/attendance")
def get_attendance():
    try:
        df = pd.read_excel(ATTENDANCE_FILE)
        df["Time"] = df["Time"].astype(str)
        records = df.to_dict(orient="records")
        return jsonify({"status": "ok", "data": records})
    except Exception:
        return jsonify({"status": "ok", "data": []})


@app.route("/users")
def get_users():
    try:
        df = pd.read_excel(USERS_FILE)
        df["Date"] = df["Date"].astype(str)
        return jsonify({"status": "ok", "data": df.to_dict(orient="records")})
    except Exception:
        return jsonify({"status": "ok", "data": []})


@app.route("/delete_user", methods=["POST"])
def delete_user():
    name = request.json.get("name", "").strip()
    try:
        df = pd.read_excel(USERS_FILE)
        df = df[df["Name"] != name]
        df.to_excel(USERS_FILE, index=False)
    except Exception:
        pass
    import shutil
    person_path = os.path.join(DATASET_PATH, name)
    if os.path.isdir(person_path):
        shutil.rmtree(person_path)
    return jsonify({"status": "ok"})


@app.route("/export_attendance")
def export_attendance():
    try:
        return send_file(ATTENDANCE_FILE, as_attachment=True,
                         download_name="attendance.xlsx")
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/stats")
def stats():
    today = datetime.now().strftime("%Y-%m-%d")
    try:
        df_att = pd.read_excel(ATTENDANCE_FILE)
        df_att["Time"] = df_att["Time"].astype(str)
        total = len(df_att)
        today_count = len(df_att[df_att["Time"].str.startswith(today)])
    except Exception:
        total, today_count = 0, 0
    try:
        df_users = pd.read_excel(USERS_FILE)
        total_users = len(df_users)
    except Exception:
        total_users = 0
    return jsonify({
        "total_records": total,
        "today": today_count,
        "total_users": total_users,
    })


if __name__ == "__main__":
    app.run(debug=True, threaded=True)
