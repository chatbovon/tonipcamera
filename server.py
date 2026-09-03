"""
Local HTTPS & HTTP Development Server for P2P IP Camera
Enables mobile browser camera access (getUserMedia requires HTTPS or localhost)
Includes built-in local signaling relay (/api/signal) for 100% reliable LAN WebRTC pairing
"""

import os
import sys
import ssl
import json
import socket
import datetime
import ipaddress
import urllib.parse
from collections import defaultdict
from http.server import HTTPServer, SimpleHTTPRequestHandler

# Ensure UTF-8 output on Windows consoles
if sys.platform.startswith('win'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)
        sys.stderr.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)
    except Exception:
        pass

PORT = 8443
CERT_FILE = "cert.pem"
KEY_FILE = "key.pem"

# In-memory signaling message queue: room -> { 'camera': [...], 'viewer': [...] }
SIGNAL_QUEUES = defaultdict(lambda: {'camera': [], 'viewer': []})
# Local clips store: "room_id" -> (mime_type, bytes)
CLIPS_STORE = {}

class P2PRequestHandler(SimpleHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == '/api/signal':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            try:
                data = json.loads(body.decode('utf-8'))
                room = data.get('room', '').strip().lower().replace(' ', '-')
                role = data.get('role')  # 'camera' or 'viewer'
                if room and role:
                    # Target is the opposite peer
                    target_role = 'viewer' if role == 'camera' else 'camera'
                    SIGNAL_QUEUES[room][target_role].append(data)
                    # Limit queue size per room
                    if len(SIGNAL_QUEUES[room][target_role]) > 50:
                        SIGNAL_QUEUES[room][target_role] = SIGNAL_QUEUES[room][target_role][-30:]

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(b'{"status":"ok"}')
                return
            except Exception as e:
                self.send_response(400)
                self.end_headers()
                return

        if parsed.path == '/api/clip':
            query = urllib.parse.parse_qs(parsed.query)
            room = query.get('room', [''])[0].strip().lower().replace(' ', '-')
            clip_id = query.get('id', [''])[0].strip()
            content_type = self.headers.get('Content-Type', 'video/webm')
            content_length = int(self.headers.get('Content-Length', 0))

            if room and clip_id and content_length > 0:
                body = self.rfile.read(content_length)
                CLIPS_STORE[f"{room}_{clip_id}"] = (content_type, body)
                print(f"[Server] Stored clip #{clip_id} for room {room} ({len(body)} bytes)")

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(b'{"status":"uploaded"}')
                return
            else:
                self.send_response(400)
                self.end_headers()
                return

        return super().do_POST()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == '/api/signal':
            query = urllib.parse.parse_qs(parsed.query)
            room = query.get('room', [''])[0].strip().lower().replace(' ', '-')
            role = query.get('role', [''])[0].strip()

            messages = []
            if room and role in ('camera', 'viewer'):
                messages = SIGNAL_QUEUES[room][role]
                SIGNAL_QUEUES[room][role] = []  # Pop all

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.end_headers()
            self.wfile.write(json.dumps(messages).encode('utf-8'))
            return

        if parsed.path == '/api/clip':
            query = urllib.parse.parse_qs(parsed.query)
            room = query.get('room', [''])[0].strip().lower().replace(' ', '-')
            clip_id = query.get('id', [''])[0].strip()
            is_dl = query.get('dl', ['0'])[0] == '1'

            key = f"{room}_{clip_id}"
            if key in CLIPS_STORE:
                content_type, body = CLIPS_STORE[key]
                self.send_response(200)
                self.send_header('Content-Type', content_type)
                self.send_header('Content-Length', str(len(body)))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Accept-Ranges', 'bytes')
                if is_dl:
                    self.send_header('Content-Disposition', f'attachment; filename="clip_{clip_id}.webm"')
                else:
                    self.send_header('Content-Disposition', f'inline; filename="clip_{clip_id}.webm"')
                self.end_headers()
                self.wfile.write(body)
                return
            else:
                self.send_response(404)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(b'Clip not found')
                return

        return super().do_GET()

    def log_message(self, format, *args):
        # Suppress routine GET /api/signal spam in terminal
        if len(args) > 0 and '/api/signal' in str(args[0]):
            return
        super().log_message(format, *args)

def get_local_ip():
    """Detect local LAN IPv4 address"""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip

def ensure_ssl_certificates(local_ip):
    """Generate self-signed certificate for localhost and local LAN IP if not present"""
    if os.path.exists(CERT_FILE) and os.path.exists(KEY_FILE):
        return

    print("[*] Generating self-signed SSL certificate for local testing...")
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.primitives import serialization

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "P2P IP Camera Dev"),
        x509.NameAttribute(NameOID.COMMON_NAME, "localhost")
    ])

    san_list = [
        x509.DNSName("localhost"),
        x509.IPAddress(ipaddress.IPv4Address("127.0.0.1"))
    ]

    try:
        san_list.append(x509.IPAddress(ipaddress.IPv4Address(local_ip)))
    except Exception:
        pass

    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.datetime.now(datetime.timezone.utc))
        .not_valid_after(datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=365))
        .add_extension(x509.SubjectAlternativeName(san_list), critical=False)
        .sign(key, hashes.SHA256())
    )

    with open(KEY_FILE, "wb") as f:
        f.write(key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption()
        ))

    with open(CERT_FILE, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))

    print("[OK] SSL Certificates created successfully (cert.pem, key.pem)")

def run():
    local_ip = get_local_ip()
    ensure_ssl_certificates(local_ip)

    # Change working directory to current script directory
    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    server_address = ('0.0.0.0', PORT)
    httpd = HTTPServer(server_address, P2PRequestHandler)

    # Wrap in SSL
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certfile=CERT_FILE, keyfile=KEY_FILE)
    httpd.socket = context.wrap_socket(httpd.socket, server_side=True)

    print("\n" + "=" * 60)
    print(" [P2P IP CAMERA - LOCAL HTTPS DEV SERVER]")
    print("=" * 60)
    print(f" [PC / Localhost]:")
    print(f"    https://localhost:{PORT}")
    print(f"")
    print(f" [Phone / Wi-Fi]:")
    print(f"    https://{local_ip}:{PORT}")
    print("=" * 60)
    print(" [คำแนะนำสำหรับการเปิดบนมือถือ]:")
    print(" 1. เมื่อเบราว์เซอร์แจ้งเตือนว่า 'การเชื่อมต่อของคุณไม่เป็นส่วนตัว'")
    print(" 2. ให้กด 'ขั้นสูง' (Advanced) -> 'ไปยัง ... ต่อไป' (Proceed to site)")
    print(" 3. กดยอมรับการเข้าถึงกล้องและไมโครโฟน")
    print("=" * 60)
    print(" กด Ctrl+C เพื่อหยุดการทำงาน\n")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[!] Server stopped.")
        sys.exit(0)

if __name__ == "__main__":
    run()
