# Synapse AWX Integration Prototype

Prototype tích hợp thật với AWX để thực thi automation workflow `restart_cycle.yml` (Database restart với ClickHouse + PostgreSQL).

## Cấu trúc

```
synapse-prototype/
├── frontend/           # HTML/CSS/JS static files
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── backend/            # Node.js Express backend
│   ├── server.js       # Main API server
│   ├── awxClient.js    # AWX API wrapper
│   ├── policy.js       # Risk & policy engine
│   ├── audit.js        # Audit logging
│   ├── catalog.json    # Action & Blueprint catalog
│   └── .env            # Config (token, URL)
└── README.md
```

## Prerequisites

1. **AWX đã cài đặt** (Minikube + AWX Operator)
2. **Node.js 18+** (cho fetch() built-in)
3. **Playbook** `restart_cycle.yml` đã tạo Job Template trong AWX

## Setup Backend

### 1. Chuẩn bị AWX

Trước khi chạy backend, cần setup trong AWX UI:

1. **Tạo Project**: Trỏ tới thư mục chứa `restart_cycle.yml`
2. **Tạo Inventory**: Group `db_servers` với các host thật
3. **Tạo Credential**: SSH key/password cho hosts
4. **Tạo Job Template**:
   - Name: `Database Restart Cycle`
   - Playbook: `restart_cycle.yml`
   - Inventory + Credential đã tạo
   - **Tắt "Enable Concurrent Jobs"** (quan trọng!)
5. **Lấy Job Template ID**: Xem trong URL hoặc gọi API:
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" \
        http://localhost:30080/api/v2/job_templates/
   ```
6. **Tạo Token**: Users → admin → Tokens → Add

### 2. Install dependencies

```bash
cd backend
npm install
```

### 3. Configure

Copy `.env.example` thành `.env`:

```bash
cp .env.example .env
```

Edit `.env`:

```env
AWX_URL=http://localhost:30080
AWX_TOKEN=your_actual_token_here
PORT=3000
```

### 4. Update catalog.json

Mở `catalog.json`, tìm `awxJobTemplateId` và thay `0` bằng Job Template ID thật:

```json
{
  "actions": [{
    "id": "DB_RESTART_CYCLE",
    "implementation": {
      "awxJobTemplateId": 7  // ← Thay số này
    }
  }]
}
```

### 5. Start backend

```bash
npm start
```

Backend sẽ chạy tại `http://localhost:3000`.

## Setup Frontend

### 1. Serve static files

Dùng bất kỳ HTTP server nào (ví dụ Python):

```bash
cd frontend
python -m http.server 8080
```

Hoặc dùng VS Code Live Server extension.

### 2. Open browser

Mở `http://localhost:8080` (hoặc `http://localhost:5500` nếu dùng Live Server).

## Use Case Demo

### UC-01: Happy Path (Execution thành công)

1. Click **"+ New Change"**
2. Nhập:
   - Objective: `RESTART_DB_SERVICES`
   - Target: `db_servers`
   - Domain: `CNTT`
   - ✓ Check "Maintenance Window"
3. Click **Create Change**
4. Change được assess tự động → Risk=75, Policy=APPROVAL
5. Click **Approve**
6. Click **Execute** → chuyển sang Execution view
7. Click **▶ Run Execution**
8. Xem log real-time từ AWX (6-8 phút)
9. Job successful → Change chuyển `Verified`

### UC-02: Execution Failed

Làm giống UC-01 nhưng:
- Trong lúc job chạy, cố tình tắt một service để `assert` fail
- Hoặc chỉnh sửa playbook để force fail
- Log sẽ hiển thị lỗi chi tiết
- Change chuyển `Failed`
- Compensation `NOTIFY_ONCALL` được trigger (xem audit log)

### UC-03: Policy Block

1. Tạo Change **không check** "Maintenance Window"
2. Assess → Risk=75, Policy=**BLOCK**
3. Change ở state `Blocked`, không có nút Execute
4. Audit log ghi rõ lý do block

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/changes` | List all changes |
| GET | `/api/blueprints` | List blueprints from catalog |
| POST | `/api/changes` | Create new change |
| POST | `/api/changes/:id/assess` | Calculate risk & policy |
| POST | `/api/changes/:id/approve` | Approve change (TODO: add auth) |
| POST | `/api/changes/:id/resolve-plan` | Create execution plan |
| POST | `/api/plans/:id/execute` | Launch AWX job |
| GET | `/api/executions/:id/status` | Poll execution status |
| GET | `/api/executions/:id/log` | Get full job log |
| GET | `/api/executions/:id/events` | Get task-level events |
| GET | `/api/audit` | Get audit log |

## Troubleshooting

### Backend không kết nối được AWX

**Lỗi:** `AWX unreachable`

**Giải pháp:**
1. Kiểm tra AWX đang chạy: `kubectl get pods -n awx`
2. Kiểm tra service URL: `minikube service awx-service -n awx --url`
3. Test token bằng curl:
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" \
        http://localhost:30080/api/v2/me/
   ```

### Job chạy quá 12 phút

**Lỗi:** Frontend hiển thị warning "taking longer than expected"

**Giải pháp:**
- Đây là bình thường nếu server reboot chậm
- Job vẫn chạy trong AWX, kiểm tra AWX UI trực tiếp
- Tăng `maxPolls` trong `app.js` nếu cần

### CORS error

**Lỗi:** `Access-Control-Allow-Origin`

**Giải pháp:**
- Backend đã config CORS cho localhost:8080 và localhost:5500
- Nếu dùng port khác, thêm vào `server.js`:
  ```javascript
  app.use(cors({
    origin: ['http://localhost:YOUR_PORT'],
    credentials: true
  }));
  ```

### Token lộ trong DevTools

**Kiểm tra:**
- Mở DevTools → Network
- Filter requests tới AWX URL
- **KHÔNG được thấy** request nào tới AWX trực tiếp
- Chỉ thấy request tới `localhost:3000`

## Security Notes

⚠️ **Prototype v1 — không production-ready:**
- Endpoint `/api/changes/:id/approve` chưa có authentication
- Token AWX lưu trong `.env` server-side (đúng)
- Không có database, state in-memory (mất khi restart)
- Không có rate limiting
- Không có HTTPS

## Definition of Done

- [ ] Tạo Change → Execute → thấy job chạy trong AWX UI
- [ ] Reboot thành công, services active trên server (kiểm tra SSH)
- [ ] UC-01, UC-02, UC-03 đều pass
- [ ] Token không xuất hiện ở Network tab của browser
- [ ] Restart backend, audit log vẫn đọc được

## Next Steps (Ngoài phạm vi v1)

- [ ] Add JWT authentication cho approve endpoint
- [ ] Persist state to database (PostgreSQL/MongoDB)
- [ ] Multi-action blueprints
- [ ] More providers (NETCONF, Terraform...)
- [ ] Real-time events via WebSocket thay vì polling
