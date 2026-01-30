from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import json
import base64
import os
import shutil
import hashlib
import time
import sqlite3
from pathlib import Path
from typing import Dict, Any, List
from fastapi.responses import Response, FileResponse

app = FastAPI()

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Paths
current_dir = Path(__file__).resolve().parent
project_root = current_dir.parent.parent.parent
# Assuming dist is in netlist_label_tool/dist
dist_dir = project_root / "netlist_label_tool" / "dist"
cache_dir = project_root / ".cache"
tasks_dir = cache_dir / "tasks" 
tasks_dir.mkdir(parents=True, exist_ok=True)

# Database Setup
DB_PATH = project_root / "annotations.db"

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    # Create table if not exists
    # schema: id, original_netlist, current_netlist, image_data, created_at, updated_at, status
    c.execute('''
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            original_netlist TEXT,
            current_netlist TEXT,
            image_data TEXT,
            created_at REAL,
            updated_at REAL,
            status TEXT
        )
    ''')
    conn.commit()
    conn.close()

# Initialize DB on startup
init_db()

class TaskUpload(BaseModel):
    json_data: Dict[str, Any]
    image_data: str # Base64
    filename: str = "result.json"

# --- Heartbeat Mechanism ---
heartbeats: Dict[str, float] = {}
explicit_finish_tasks: set = set()

def update_task_heartbeat(task_id: str):
    heartbeats[task_id] = time.time()
    if task_id in explicit_finish_tasks:
        explicit_finish_tasks.remove(task_id)

@app.post("/api/upload_task")
async def upload_task(task: TaskUpload):
    import uuid
    task_id = str(uuid.uuid4())
    timestamp = time.time()
    
    # Serialize JSON
    try:
        json_str = json.dumps(task.json_data, ensure_ascii=False, sort_keys=True)
        
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute('''
            INSERT INTO tasks (id, original_netlist, current_netlist, image_data, created_at, updated_at, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (task_id, json_str, json_str, task.image_data, timestamp, timestamp, ""))
        conn.commit()
        conn.close()
        
        # Initialize heartbeat
        update_task_heartbeat(task_id)
        
    except Exception as e:
        return {"error": f"Database error: {str(e)}"}
        
    return {"task_id": task_id, "url": f"/?id={task_id}"}

@app.post("/api/save_task/{task_id}")
async def save_task(task_id: str, request: Request):
    try:
        new_netlist = await request.json()
        json_str = json.dumps(new_netlist, ensure_ascii=False, sort_keys=True)
        timestamp = time.time()
        
        # Calculate Hash
        data_hash = hashlib.md5(json_str.encode("utf-8")).hexdigest()

        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        # Only update current_netlist and updated_at
        c.execute('''
            UPDATE tasks 
            SET current_netlist = ?, updated_at = ?, status = ?
            WHERE id = ?
        ''', (json_str, timestamp, "", task_id)) # Reset status to active on save
        
        if c.rowcount == 0:
            conn.close()
            return {"success": False, "error": "Task not found"}
            
        conn.commit()
        conn.close()

        # Update heartbeat
        update_task_heartbeat(task_id)
            
        return {"success": True, "timestamp": timestamp, "hash": data_hash}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.post("/api/heartbeat/{task_id}")
async def heartbeat(task_id: str, status: str = ""):
    if status == "finish":
        print(f"Received explicit finish signal for {task_id}")
        explicit_finish_tasks.add(task_id)
        
        # Update status in DB
        try:
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute('UPDATE tasks SET status = ? WHERE id = ?', ("finish", task_id))
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"Error updating status to finish: {e}")
    else:
        # Normal heartbeat (in-memory only for performance)
        update_task_heartbeat(task_id)

    return {"success": True}

@app.get("/api/get_task_json/{task_id}")
def get_task_json(task_id: str):
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute('SELECT current_netlist, updated_at, status FROM tasks WHERE id = ?', (task_id,))
        row = c.fetchone()
        
        if not row:
            conn.close()
            return {"code": 404, "message": "Task not found", "data": None}
            
        current_netlist_str, updated_at, status = row
        
        # Check heartbeat timeout logic
        last_beat = heartbeats.get(task_id, 0)
        timeout_seconds = 60
        db_updated = False
        
        if status == "":
            if time.time() - last_beat > timeout_seconds:
                 print(f"Heartbeat timeout for {task_id}. Marking as finish.")
                 status = "finish"
                 c.execute('UPDATE tasks SET status = ? WHERE id = ?', ("finish", task_id))
                 db_updated = True
        elif status == "finish":
            if task_id not in explicit_finish_tasks and (time.time() - last_beat < timeout_seconds):
                 print(f"Heartbeat resumed for {task_id}. Marking as active.")
                 status = ""
                 c.execute('UPDATE tasks SET status = ? WHERE id = ?', ("", task_id))
                 db_updated = True
        
        if db_updated:
            conn.commit()
            
        conn.close()
        
        # Parse JSON
        netlist_data = json.loads(current_netlist_str)
        data_hash = hashlib.md5(current_netlist_str.encode("utf-8")).hexdigest()

        # Construct response
        response_data = {
            "data": netlist_data,
            "timestamp": updated_at,
            "status": status,
            "hash": data_hash
        }
        
        return {
            "code": 200,
            "message": "success",
            **response_data 
        }
    except Exception as e:
        return {"code": 500, "message": str(e), "data": None}

@app.get("/api/get_task_image/{task_id}")
def get_task_image(task_id: str):
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute('SELECT image_data FROM tasks WHERE id = ?', (task_id,))
        row = c.fetchone()
        conn.close()
        
        if not row:
            return {"error": "Image not found"}
            
        img_str = row[0]
        if "," in img_str:
            img_str = img_str.split(",")[1]
        img_bytes = base64.b64decode(img_str)
        
        return Response(content=img_bytes, media_type="image/png")
    except Exception as e:
        return {"error": f"Image load failed: {str(e)}"}

# Serve Static Files (must be last)
if os.path.exists(dist_dir):
    app.mount("/", StaticFiles(directory=str(dist_dir), html=True), name="static")
else:
    @app.get("/")
    def index():
        from fastapi.responses import HTMLResponse
        html_content = f"""
        <html>
            <body style="font-family: sans-serif; text-align: center; padding-top: 50px;">
                <h1 style="color: #e74c3c;">Frontend Build Not Found</h1>
                <p>The React frontend has not been built or installed on this server.</p>
                <p>Please run the following command in the <code>netlist_label_tool</code> directory:</p>
                <pre style="background: #f1f1f1; padding: 10px; display: inline-block;">npm install && npm run build</pre>
                <p>Expected path: <code>{dist_dir}</code></p>
            </body>
        </html>
        """
        return HTMLResponse(content=html_content)

if __name__ == "__main__":
    import uvicorn
    # Using 12301
    
    # Check for SSL certificates
    key_file = "key.pem"
    cert_file = "cert.pem"
    
    if os.path.exists(key_file) and os.path.exists(cert_file):
        print("Starting in HTTPS mode...")
        uvicorn.run(app, host="0.0.0.0", port=12301, ssl_keyfile=key_file, ssl_certfile=cert_file)
    else:
        print("Starting in HTTP mode...")
        uvicorn.run(app, host="0.0.0.0", port=12301)
