# FaceTrack Web — Setup Guide

## 📁 Project Structure
```
face_web/
├── app.py              ← Flask backend (main server)
├── requirements.txt    ← Python dependencies
├── dataset/            ← Face images per person
├── users.xlsx          ← Registered users
├── attendance.xlsx     ← Attendance records
├── templates/
│   └── index.html      ← Main web UI
└── static/
    ├── css/style.css
    └── js/main.js
```

## 🚀

### 1. Install dependencies
```bash
pip install -r requirements.txt
```

### 2. Start the server
```bash
python app.py
```


## 🖥️ Features
- **Dashboard** — live stats (users, today's attendance, total records)
- **Recognize** — click Start Scanning → camera opens in browser → auto-marks attendance
- **Register** — fill in name/sex/class → captures 20 face photos via browser
- **Records** — view all attendance logs, search, export to Excel
- **Users** — view and remove registered users

## ⚠️ Notes
- Make sure your webcam is connected and allowed in the browser
- The `dataset/` and Excel files are preserved from your original project
- Only one camera operation (register/recognize) can run at a time
