import os
import sys
import webbrowser
import http.server
import socketserver

PORT = 8000
os.chdir(os.path.dirname(os.path.abspath(__file__)))

viewer_url = f"http://localhost:{PORT}/viewer/"

print("=" * 60)
print("  [IP Camera] - ระบบมอนิเตอร์หน้าจอ (Viewer Node)")
print("=" * 60)
print(f"  กำลังเปิดเบราว์เซอร์อัตโนมัติไปที่: {viewer_url}")
print(f"  (กรุณาใส่รหัสห้อง เช่น cam-xxxx ที่ขึ้นบนจอมือถือลงในหน้าต่างดู)")
print("=" * 60)
print("  กด Ctrl+C ในหน้าต่างนี้เพื่อหยุดการทำงาน\n")

webbrowser.open(viewer_url)

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        if len(args) > 0 and ('.js' in str(args[0]) or '.css' in str(args[0]) or '.svg' in str(args[0])):
            return
        super().log_message(format, *args)

socketserver.TCPServer.allow_reuse_address = True

try:
    with socketserver.TCPServer(("", PORT), QuietHandler) as httpd:
        httpd.serve_forever()
except KeyboardInterrupt:
    print("\n[OK] ปิดระบบเรียบร้อย")
    sys.exit(0)
except Exception as e:
    print(f"\n[!] เกิดข้อผิดพลาด: {e}")
    sys.exit(1)
