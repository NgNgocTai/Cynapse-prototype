# Quick Start Guide

## 🚀 Chạy Synapse (3 terminal)

### Terminal 1 - AWX Port-Forward
```bash
kubectl --context=awx-lab -n awx port-forward svc/awx-demo-service 8080:80
```
Giữ terminal này chạy liên tục.

### Terminal 2 - Backend
```bash
cd D:\Code\VDT\Synapse\backend
npm start
```
Hoặc double-click: `start-backend.cmd`

### Terminal 3 - Frontend
```bash
cd D:\Code\VDT\Synapse\frontend
py -m http.server 5500
```
Hoặc double-click: `start-frontend.cmd`

### Browser
Open: **http://localhost:5500**

---

## 🧪 Test UC-01 (Happy Path)

1. Click **"+ New Change"**
2. Fill form:
   - Objective: `DB_RESTART_CYCLE` ← Khớp với action ID trong catalog
   - Target: `db_servers`
   - Domain: `CNTT`
   - ✓ **CHECK "Maintenance Window"** ← Quan trọng!
3. Click **"Create Change"**
4. Auto-assess → Risk=75, Policy=APPROVAL
5. Click **"Execute"** → **"Approve"** → **"Run Execution"**
6. Watch log 6-8 phút
7. Result: State = **Verified** ✅

---

## 📋 Setup lần đầu (one-time)

Nếu chưa setup AWX, làm theo các bước sau:

### 1. Setup AWX (AWX UI - 10 phút)

### 1.1 Tạo Token trong AWX UI

```bash
# Access AWX
minikube service awx-service -n awx

# Login với admin user
# Navigate to: Users → admin → Tokens → Add
# Copy token vừa tạo
```

### 1.2 Tạo Job Template

1. **Project**: Tạo mới hoặc dùng existing project chứa `restart_cycle.yml`
2. **Inventory**: Tạo inventory với group `db_servers`, thêm hosts
3. **Credential**: SSH credential cho hosts
4. **Job Template**:
   - Name: `Database Restart Cycle`
   - Project: chọn project vừa tạo
   - Playbook: `restart_cycle.yml`
   - Inventory: chọn inventory vừa tạo
   - Credentials: chọn credential vừa tạo
   - **Uncheck "Enable Concurrent Jobs"** (quan trọng!)
   - Save

5. **Ghi lại Job Template ID**: Xem trong URL `/templates/job_template/7/details` → ID là `7`

## Bước 2: Config Backend

```bash
cd backend

# Copy env file
cp .env.example .env

# Edit .env
# AWX_URL=http://localhost:30080  (hoặc IP từ minikube service)
# AWX_TOKEN=<paste token từ bước 1.1>
# PORT=3000

# Edit catalog.json
# Thay awxJobTemplateId: 0 → awxJobTemplateId: 7 (ID từ bước 1.2)

# Install
npm install

# Start
npm start
```

Nếu thấy:
```
✓ Synapse Backend running on http://localhost:3000
✓ AWX URL: http://localhost:30080
✓ Ready to accept requests from frontend
```
→ Success!

## Bước 3: Start Frontend

```bash
cd frontend

# Option 1: Python
python -m http.server 8080

# Option 2: PowerShell script
.\serve.ps1

# Option 3: VS Code Live Server
# Right-click index.html → Open with Live Server
```

Mở browser: `http://localhost:8080`

## Bước 4: Test UC-01 (Happy Path)

1. Click **"+ New Change"**
2. Điền form:
   - Objective: `RESTART_DB_SERVICES`
   - Target: `db_servers`
   - Domain: `CNTT`
   - ✓ **Check** "Maintenance Window"
3. **Create Change**
4. Tự động assess → Risk=75, Policy=APPROVAL
5. Click **"Execute"** button bên phải change
6. Trong Execution view, click **"✓ Approve"**
7. Click **"▶ Run Execution"**
8. Xem log real-time (6-8 phút)

**Xác nhận thành công:**
- AWX UI → Jobs → thấy job mới với status `successful`
- SSH vào server: `systemctl status clickhouse-server postgresql@18-main` → cả 2 active
- Synapse UI → Change state = `Verified`

## Bước 5: Test UC-03 (Policy Block)

1. **"+ New Change"** lần nữa
2. Điền form giống bước 4 NHƯNG **KHÔNG check** "Maintenance Window"
3. **Create Change**
4. Assess → Policy=**BLOCK**
5. Change ở state `Blocked`, không có nút Execute

**Kiểm tra audit log:**

```bash
curl http://localhost:3000/api/audit?changeId=CHG-002
```

Phải thấy entry với `"action":"assessed","detail":"...Policy: BLOCK..."`

## Troubleshooting

### "AWX unreachable"

```bash
# Kiểm tra AWX pod
kubectl get pods -n awx

# Kiểm tra service
minikube service list -n awx

# Test token bằng tay
curl -H "Authorization: Bearer YOUR_TOKEN" \
     http://localhost:30080/api/v2/me/
```

### CORS error

- Backend đã config CORS cho localhost:8080, 5500
- Nếu dùng port khác, sửa `server.js` dòng 15-17

### Token lộ ở DevTools?

- Mở DevTools → Network
- Filter `awx` hoặc `30080`
- **KHÔNG được thấy** request nào tới AWX
- Chỉ thấy request tới `localhost:3000`
- Nếu thấy → có lỗi, token đang lộ

### Backend crash khi execute

Kiểm tra:
1. `catalog.json` có đúng Job Template ID chưa?
2. AWX token còn valid không? (có thể expire)
3. Inventory `db_servers` có host chưa?
4. Credential có đúng không?

## Definition of Done Checklist

- [ ] Backend start không lỗi, log hiện "Ready to accept requests"
- [ ] Frontend mở được, thấy empty Change list (ban đầu)
- [ ] Tạo Change → state=Draft → Assessed → riskScore=75
- [ ] Approve → Execute → thấy log polling
- [ ] AWX UI thấy job running
- [ ] Job complete → Synapse UI thấy log full, state=Verified
- [ ] SSH server kiểm tra services thật sự active
- [ ] DevTools không thấy token AWX
- [ ] `audit.log` file tồn tại và có entries
