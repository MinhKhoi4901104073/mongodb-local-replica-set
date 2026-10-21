# MongoDB Distributed Replica Set

> **Sinh viên:** Nguyễn Minh Khôi &nbsp;·&nbsp; **MSSV:** 49.01.104.073  
> **Môn học:** Điện toán đám mây &nbsp;·&nbsp; **Đề tài 21:** Tìm hiểu và triển khai CSDL NoSQL (MongoDB) phân tán cục bộ

---

## Mục tiêu

| # | Mục tiêu | Trạng thái |
|---|----------|:----------:|
| 1 | Cài đặt MongoDB Replica Set 3 nodes (1 Primary + 2 Secondary) | Hoàn thành |
| 2 | Xác thực nội bộ bằng Keyfile (Shared Secret) | Hoàn thành |
| 3 | Đồng bộ dữ liệu tự động qua oplog replication | Hoàn thành |
| 4 | Kiểm thử tắt Primary và đo lường quá trình Election tự động | Hoàn thành |
| 5 | Tự động khôi phục và đồng bộ bù dữ liệu khi node cũ hoạt động lại | Hoàn thành |

---

## Kiến trúc hệ thống

```
Host (Docker Desktop / WSL2)
│
├── Bridge Network: mongo-replica-net (172.20.0.0/16)
│   │
│   ├── mongo1 (PRIMARY)    172.20.0.11  ←→ host:27017
│   │    └── oplog ──────────────────────────────────────┐
│   │                                                     │ Keyfile Auth
│   ├── mongo2 (SECONDARY)  172.20.0.12  ←→ host:27018  │ (Shared Secret)
│   │    └── replicates oplog ◄──────────────────────────┤
│   │                                                     │
│   └── mongo3 (SECONDARY)  172.20.0.13  ←→ host:27019  │
│        └── replicates oplog ◄──────────────────────────┘
│
├── Web GUI: Mongo Express  172.20.0.20  ←→ host:8081
└── Volumes: mongo1-data, mongo2-data, mongo3-data (persistent)
```

---

## Cấu trúc thư mục

```
mongodb-local-replica-set/
├── docker-compose.yml          # Cấu hình 3 nodes MongoDB, Mongo Express, network và volumes
├── mongo-keyfile               # Shared secret key xác thực nội bộ cluster
├── dashboard/                  # Web Dashboard giám sát và điều khiển failover
│   ├── server.js               # Backend Node.js kết nối cluster với retryWrites
│   ├── package.json
│   └── public/                 # Giao diện giám sát topology và workload thời gian thực
│       ├── index.html
│       ├── style.css
│       └── app.js
└── scripts/
    ├── setup.ps1               # Khởi tạo và kiểm tra cluster tự động (Windows)
    ├── setup.sh                # Khởi tạo và kiểm tra cluster tự động (Linux/WSL)
    ├── status.ps1              # Kiểm tra nhanh trạng thái containers và replica set
    ├── test_failover.ps1       # Kịch bản kiểm thử chuyển đổi dự phòng tự động (Windows)
    ├── test_failover.sh        # Kịch bản kiểm thử chuyển đổi dự phòng tự động (Linux/WSL)
    ├── start_dashboard.ps1     # Khởi chạy Web Dashboard (Windows)
    ├── start_dashboard.sh      # Khởi chạy Web Dashboard (Linux/WSL)
    └── init_replica.js         # Script mongosh cấu hình rs.initiate()
```

---

## Hướng dẫn sử dụng

### 1. Khởi động cụm Replica Set

Yêu cầu Docker Desktop đang chạy:

```powershell
# Windows PowerShell
.\scripts\setup.ps1

# Để xóa sạch volume và dựng lại từ đầu:
.\scripts\setup.ps1 -Reset
```

Linux / WSL:
```bash
bash scripts/setup.sh
# hoặc: bash scripts/setup.sh --reset
```

### 2. Kiểm tra trạng thái cụm

```powershell
.\scripts\status.ps1
```

Kết quả hiển thị:
- Trạng thái Docker containers (`mongo1`, `mongo2`, `mongo3`)
- Vai trò hiện tại của từng member trong `rs.status()` (`PRIMARY` / `SECONDARY`)

### 3. Kiểm thử chuyển đổi dự phòng (Failover Test)

```powershell
.\scripts\test_failover.ps1
```

Quy trình thực thi của script:
1. Xác định Primary hiện tại và ghi 1 bản ghi kiểm chứng vào `demoDB.failover_test`.
2. Dừng container Primary (`docker stop`).
3. Đo thời gian hệ thống tiến hành Election qua giao thức đồng thuận (5–15 giây).
4. Xác minh Primary mới được bầu và kiểm tra toàn vẹn dữ liệu (0% mất mát).
5. Khởi động lại container cũ (`docker start`) và xác nhận node cũ tự động tái gia nhập với vai trò `SECONDARY`.

### 4. Khởi chạy Web Dashboard

```powershell
.\scripts\start_dashboard.ps1
```
Trình duyệt tự động mở tại `http://localhost:3000`. Dashboard cung cấp:
- Trực quan hóa sơ đồ 3 nodes và tình trạng kết nối.
- Nút kích hoạt kiểm thử ngắt Primary và đồng hồ đo thời gian Election.
- Trình tạo luồng ghi dữ liệu khách hàng (Client Workload) với `writeConcern: majority` để quan sát tính trong suốt của kết nối khi xảy ra failover.

### 5. Giao diện quản trị Mongo Express

Mở trình duyệt tại: `http://localhost:8081`  
Cho phép xem trực tiếp cơ sở dữ liệu `demoDB`, collection `live_transactions`, và nhật ký `local.oplog.rs`.

---

## Phân tích Kiến trúc Kỹ thuật

### 1. Bản chất Ảo hóa (Virtualization Architecture)
- **Ảo hóa mức Hệ điều hành (OS-Level Virtualization / Containerization):** Hệ thống sử dụng Docker Container để đóng gói từng máy chủ cơ sở dữ liệu độc lập.
  - **Linux Namespaces:**
    - *Network Namespace:* Mỗi container sở hữu card mạng ảo và địa chỉ IP riêng biệt (`172.20.0.11`, `172.20.0.12`, `172.20.0.13`) trong Docker Bridge Network.
    - *Mount Namespace:* Cô lập hoàn toàn hệ thống tệp và volume dữ liệu của từng máy chủ.
  - **Control Groups (cgroups):** Giới hạn định mức tài nguyên CPU/RAM cho từng node, mô phỏng đúng các Compute Instances trên Cloud.
- **Hạ tầng nền tảng:** Docker Desktop trên Windows sử dụng backend WSL2 – hoạt động như một micro-virtual machine được quản lý bởi Hyper-V Type-1 Hypervisor.

### 2. Tiêu chuẩn Lưu trữ Đám mây (Cloud Storage)
- **Tính Bền vững (Data Persistence):** Hệ thống phân tách giữa Compute Layer (container `mongod`) và Storage Layer (Docker Named Volumes `mongo1-data`, `mongo2-data`, `mongo3-data`). Dữ liệu tồn tại độc lập với vòng đời của container.
- **Tính Sẵn Sàng Cao (High Availability) & Khả năng Chịu Lỗi (Fault Tolerance):**
  - Khi node Primary gặp sự cố, các node Secondary phát hiện qua heartbeat timeout (10 giây) và kích hoạt thuật toán Raft để bầu Primary mới.
  - Thời gian phục hồi dịch vụ (RTO): 5 đến 15 giây.
- **Định lý CAP:**
  - MongoDB Replica Set là hệ thống theo mô hình **CP (Consistency & Partition Tolerance)**.
  - Khi xảy ra phân rã mạng, hệ thống ưu tiên tính nhất quán dữ liệu thông qua nhật ký đồng bộ **Oplog Replication**.
- **Kiểm soát Lưu trữ Phân tán:**
  - `writeConcern: { w: "majority" }`: Dữ liệu chỉ được xác nhận khi đã ghi an toàn vào đa số các node trong cụm (Quorum $\ge 2/3$).
  - `retryWrites: true`: Client driver tự động lưu đệm và gửi lại truy vấn khi phát hiện cụm đang bầu chọn, đảm bảo quá trình failover diễn ra trong suốt.
- **Nguyên tắc Quorum và Phòng chống Split-Brain:**
  - Cụm duy trì số lượng node lẻ ($N = 3$), yêu cầu túc số quá bán $Quorum = \lfloor N/2 \rfloor + 1 = 2$.
  - Loại bỏ hoàn toàn nguy cơ 2 node cùng tự nhận là Primary khi có sự cố chia cắt mạng.

---

## Tài liệu tham khảo

- [MongoDB Replica Set Documentation](https://www.mongodb.com/docs/manual/replication/)
- [MongoDB Keyfile Authentication](https://www.mongodb.com/docs/manual/tutorial/deploy-replica-set-with-keyfile-access-control/)
- [Docker Compose Specification](https://docs.docker.com/compose/)
- [MongoDB Replication Election Mechanics](https://www.mongodb.com/docs/manual/core/replica-set-elections/)