# 📹 P2P IP Camera System (Mobile App & Web Surveillance)

ระบบกล้องวงจรปิด IP Camera แบบ Peer-to-Peer (P2P) น้ำหนักเบาพิเศษ กินทรัพยากรเครื่องต่ำมาก **รองรับการติดตั้งเป็น Mobile App (Android APK)** และ**ไม่มีค่าใช้จ่ายเซิร์ฟเวอร์คลาวด์ตลอดชีพ (Zero Cloud Cost)**

---

## 🌟 จุดเด่นและฟีเจอร์ของระบบ

1. **รองรับทั้ง Mobile App (Android APK) และ Web Browser**
   * ฝั่งเครื่องกล้อง สามารถติดตั้งเป็น **Android App (`IPCam.apk`)** ผ่าน Capacitor ทำงานได้เสถียร ไม่หลุด ไม่โดนพักการทำงาน
   * ฝั่งจอมอนิเตอร์ (Viewer) เปิดดูได้จากทุกอุปกรณ์ผ่านเบราว์เซอร์ ทั้งคอมพิวเตอร์, โน้ตบุ๊ก, แท็บเล็ต หรือสมาร์ทโฟน
2. **สตรีมวิดีโอสดความหน่วงต่ำพิเศษ (Ultra-Low Latency < 200ms)**
   * ขับเคลื่อนด้วยโปรโตคอล **WebRTC (UDP / SRTP)** เข้ารหัสแบบ End-to-End ไม่ผ่านเซิร์ฟเวอร์คนกลาง
3. **ระบบประหยัดพลังงาน & ระบายความร้อนอัจฉริยะ (Smart Eco & Cooling Engine)**
   * **Auto Screen Sleep (15s)**: พักหน้าจอเป็นสีดำสนิท (OLED Black Screen) อัตโนมัติเมื่อภาพนิ่ง 15 วินาที พร้อมหยุดการวาดภาพของ GPU ช่วยลดความร้อนลงทันที
   * **Auto-FPS Throttling**: ลดเฟรมเรทเหลือ **10 FPS** เมื่อไม่มีคนเดินผ่าน และเร่งกลับมาเป็น **30 FPS** ทันทีที่มีความเคลื่อนไหว
4. **ระบบตรวจจับความเคลื่อนไหว (Lightweight Motion Detection & Scheduling)**
   * อัลกอริทึม Canvas Frame Difference ระดับพิกเซล กิน CPU เพิ่มเพียง 1-2%
   * มีระบบ **ตั้งเวลาตรวจจับ (Schedule Timer)** เช่น เปิดตรวจจับเฉพาะกลางคืน `22:00 - 06:00`
5. **บันทึกวิดีโอบนตัวกล้อง (Camera Local Storage & Remote Playback)**
   * บันทึกด้วย `MediaRecorder` ลง **IndexedDB** ภายในตัวเครื่องกล้อง ไม่เสียค่าคลาวด์
   * **Circular Buffer & Auto-Purge**: กำหนดขนาดความจุสูงสุดได้ (เช่น 500 MB) และระบบจะทยอยลบคลิปเก่าสุดออกอัตโนมัติ
   * ฝั่งจอมอนิเตอร์สามารถกดดูวิดีโอย้อนหลังแบบสตรีมทันที หรือกดบันทึกลงคอมพิวเตอร์ได้
6. **สั่งการและตั้งค่าระยะไกลแบบ 2-Way Sync (Bidirectional Settings)**
   * สั่งเปิด/ปิดไฟฉาย (Torch), สลับกล้องหน้า/หลัง, สั่งบันทึกคลิป
   * ปรับตั้งค่าความไว Motion, เวลา Schedule, ความยาวคลิป, โหมด Eco ได้จากทั้งฝั่งกล้องและจอมอนิเตอร์

---

## 📁 โครงสร้างโปรเจกต์ (Project Structure)

```
d:/AIProject/IPcameraphone/
├── IPCam.apk                # ไฟล์ติดตั้ง Android Application สำหรับเครื่องกล้อง
├── capacitor.config.json    # การตั้งค่า Capacitor Android Bridge
├── package.json             # npm dependencies (@capacitor/android, core, cli)
├── index.html               # หน้าหลักเลือกระหว่าง Camera Node หรือ Viewer Node
├── server.py                # Local HTTPS Dev Server & High-Speed Media Relay
├── android/                 # โครงสร้าง Android Native Project (Gradle / Java)
├── www/                     # Web Bundle Source สำหรับ Build เป็น Android App
├── camera/                  # [โมดูล Camera Node - Web Version]
│   ├── index.html           # หน้าสตรีมกล้อง (รองรับ OLED Dark Mode, สแกน QR Code)
│   ├── css/style.css        # Mobile Dark UI
│   └── js/
│       ├── camera.js        # จัดการฮาร์ดแวร์กล้อง, ไฟฉาย, Aspect Ratio 16:9, Screen WakeLock
│       ├── motion.js        # เอนจินตรวจจับความเคลื่อนไหว & ตั้งเวลา Schedule
│       ├── recorder.js      # MediaRecorder บันทึกวิดีโอ
│       ├── storage.js       # IndexedDB Storage, คำนวณพื้นที่ใช้จริง & Auto-Purge
│       ├── webrtc-cam.js    # RTCPeerConnection, Dynamic FPS & Settings Sync
│       └── app.js           # ตัวประสานงานหลักของ Camera
├── viewer/                  # [โมดูล Viewer Node - Monitor Dashboard]
│   ├── index.html           # หน้าจอ CCTV Dashboard มอนิเตอร์ภาพสด
│   ├── css/style.css        # Dashboard CCTV Theme
│   └── js/
│       ├── webrtc-view.js   # รับภาพ WebRTC, สัญญาณเตือน Motion & DataChannel
│       └── app.js           # ตัวประสานงานหลักของ Viewer & Settings Controller
└── shared/                  # โมดูลที่ใช้ร่วมกัน
    ├── config.js            # STUN Servers, MQTT Brokers, ค่ายูทิลิตี้
    └── signaling.js         # P2P Signaling ผ่าน Free Public MQTT WSS
```

---

## 🚀 วิธีการใช้งาน

### 1. ติดตั้งและเปิดใช้งานบนมือถือ (เครื่องกล้อง)
* นำไฟล์ **`IPCam.apk`** ไปติดตั้งบนโทรศัพท์ Android
* เปิดแอป **IP Camera** ➔ กดยอมรับสิทธิ์กล้องและไมโครโฟน
* แอปจะแสดงรหัสห้อง (เช่น `cam-7138`) และสตรีมภาพพร้อมตรวจจับความเคลื่อนไหวทันที

### 2. เปิดหน้าจอมอนิเตอร์ (เครื่องดู)
* **บนคอมพิวเตอร์ในวง Wi-Fi เดียวกัน**:
  1. รัน `python server.py`
  2. เปิดเบราว์เซอร์ไปที่ `https://localhost:8443/viewer/index.html?room=cam-XXXX`
* **ข้ามอินเทอร์เน็ต (4G/5G)**:
  * นำโฟลเดอร์เว็บขึ้นโฮสต์ฟรี เช่น **GitHub Pages**, **Cloudflare Pages**, หรือ **Vercel** เพื่อเปิดดูได้จากทุกที่ทั่วโลกตลอด 24 ชม.

---

## 🛠️ วิธีการ Rebuild APK (หากมีการแก้ไขโค้ดในอนาคต)

```bash
# 1. ซิงค์โค้ดเว็บจาก www ไปยังโปรเจกต์ Android
npx cap sync android

# 2. เปิด Android Studio เพื่อ Build APK (หรือรันคำสั่ง gradle)
npx cap open android
```

---

## 🔒 ความปลอดภัยและความเป็นส่วนตัว (Privacy & Security)

* **End-to-End Encryption**: สัญญาณวิดีโอและเสียงวิ่งตรงระหว่างเครื่องด้วยโปรโตคอล **DTLS-SRTP** ไม่ผ่านเซิร์ฟเวอร์คนกลาง
* **100% Local Storage**: ข้อมูลคลิปวิดีโอทั้งหมดถูกบันทึกเก็บไว้ในหน่วยความจำของมือถือเครื่องกล้องเท่านั้น ปลอดภัยจากการรั่วไหลบนคลาวด์
