# Known Issues & Improvements

## 🔴 Critical - Security

### Issue: .env file chứa AWX token được commit/upload
**Status:** ⚠️ Cần xử lý ngay

**Chi tiết:**
- File `backend/.env` có thể đã được commit vào Git hoặc đưa vào archive
- Chứa AWX token thực: `AWX_TOKEN=1nRYqogz5GXgOTMhGr7coOigJnT8mP`
- `.gitignore` đã có `.env` nhưng có thể đã commit trước khi add gitignore

**Action required:**
1. ✅ Revoke token hiện tại trong AWX UI: Users → admin → Tokens → Delete token
2. ✅ Tạo token mới
3. ✅ Update `backend/.env` với token mới (chỉ local)
4. ✅ Verify `.env` trong `.gitignore`
5. ✅ Remove `.env` from Git history nếu đã commit:
   ```bash
   git rm --cached backend/.env
   git commit -m "Remove .env from tracking"
   ```

---

## 🟡 Medium - Functional Improvements

### Issue 1: target_group không được playbook sử dụng
**Status:** ⏳ TODO

**Chi tiết:**
Backend gửi:
```javascript
launchJob(templateId, { target_group: change.target })
```

Nhưng playbook có:
```yaml
hosts: db_servers  # Hard-coded
```

**Impact:**
- Hiện tại: Vô tình khớp vì default `db_servers`
- Vấn đề: Nếu gửi `target=web_servers`, playbook vẫn chạy trên `db_servers`
- Blueprint không thực sự dynamic về target

**Solution:**
Sửa playbook:
```yaml
hosts: "{{ target_group | default('db_servers') }}"
```

Hoặc tốt hơn, dùng AWX Inventory limit:
```javascript
launchJob(templateId, { 
  limit: change.target,  // AWX built-in parameter
  extra_vars: { ... }
})
```

**Priority:** Medium - không block POC nhưng cần sửa cho production

---

### Issue 2: Blueprint resolution logic đã cải thiện nhưng chưa optimal
**Status:** ✅ Đã sửa trong commit này (improved matching)

**Chi tiết trước đây:**
```javascript
// Old: Chỉ match exact blueprint name
change.objective.includes(blueprint.metadata.name.toUpperCase().replace(/-/g, '_'))
// "RESTART_DB_SERVICES" không khớp "db-restart-cycle"
```

**Đã sửa thành:**
```javascript
// New: Match action ID, sau đó tìm blueprint sử dụng action đó
1. Tìm action.id === "DB_RESTART_CYCLE"
2. Tìm blueprint có step.action === "DB_RESTART_CYCLE"
3. Match flexible: exact, includes, reverse includes
```

**Cải thiện trong tương lai:**
- Thêm field `blueprintId` hoặc `actionId` vào Change schema
- Frontend chọn blueprint từ dropdown thay vì type free-text objective
- Backend validation objective phải match available actions

---

## 🟢 Low - Nice to Have

### Issue 3: Objective field là free-text, dễ typo
**Solution:** Đổi thành dropdown select với available actions từ catalog

### Issue 4: Frontend mặc định giá trị `db_servers` - không linh hoạt
**Solution:** Dynamic form tùy action (vd action khác có thể cần params khác)

### Issue 5: Audit log chỉ ghi file, không có retention policy
**Solution:** Rotate logs hoặc chuyển sang database

### Issue 6: Error messages backend chưa user-friendly
**Solution:** Thêm error codes + helpful messages

---

## ✅ Fixed Issues

### ✅ Objective mismatch bug
**Fixed:** Đổi frontend default `RESTART_DB_SERVICES` → `DB_RESTART_CYCLE`

### ✅ Blueprint resolution logic
**Fixed:** Improved matching với action-first approach

### ✅ Port conflict (frontend :8080 vs AWX :8080)
**Fixed:** Frontend chuyển sang :5500

---

## 📊 Current POC Status

| Component | Status | Note |
|---|---|---|
| Ansible playbook | ✅ | Works standalone |
| AWX setup | ✅ | Job Template #10 exists |
| AWX ↔ Git | ✅ | Project synced |
| AWX ↔ Server | ✅ | Can run job manually |
| Backend ↔ AWX | ✅ | API connectivity OK |
| Frontend ↔ Backend | ✅ | API calls work |
| **Full E2E flow** | ⏳ **Testing** | Resolve bug fixed, need to verify |

**Next:** Test UC-01 end-to-end với fix mới:
```
Create (DB_RESTART_CYCLE) → Assess → Approve → Execute → AWX Job → Verified
```

Nếu flow này chạy xanh → POC hoàn tất 100%

---

## 🎯 Roadmap

### v1.1 (Post-POC)
- [ ] Fix target_group in playbook
- [ ] Revoke old token, use new token
- [ ] Dropdown cho objective/action selection
- [ ] Better error messages

### v2.0 (Production-ready)
- [ ] JWT authentication
- [ ] Database thay in-memory
- [ ] WebSocket cho real-time updates
- [ ] Multi-action blueprints
- [ ] Rollback thực sự (compensation)
