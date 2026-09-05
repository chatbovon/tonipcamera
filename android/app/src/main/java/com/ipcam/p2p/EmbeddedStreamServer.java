package com.ipcam.p2p;

import android.content.Context;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.util.Log;
import java.io.BufferedOutputStream;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * EmbeddedStreamServer: High performance embedded HTTP server running on port 8888.
 * Provides MJPEG streaming (/live), single frame snapshot (/snapshot), and status API (/status).
 * Works 100% in background service, unaffected by screen lock or power button.
 */
public class EmbeddedStreamServer {
    private static final String TAG = "EmbeddedStreamServer";
    public static final int DEFAULT_PORT = 8888;

    private final int port;
    private ServerSocket serverSocket;
    private boolean isRunning = false;
    private final ExecutorService clientThreadPool = Executors.newCachedThreadPool();
    private final List<Socket> activeClients = new CopyOnWriteArrayList<>();

    private final NativeCameraEngine cameraEngine;

    public EmbeddedStreamServer(NativeCameraEngine engine) {
        this(engine, DEFAULT_PORT);
    }

    public EmbeddedStreamServer(NativeCameraEngine engine, int port) {
        this.cameraEngine = engine;
        this.port = port;
    }

    public synchronized void start() {
        if (isRunning) return;
        isRunning = true;

        new Thread(() -> {
            try {
                serverSocket = new ServerSocket(port);
                Log.i(TAG, "Embedded HTTP Streaming Server started on port " + port);

                while (isRunning && !serverSocket.isClosed()) {
                    try {
                        Socket socket = serverSocket.accept();
                        activeClients.add(socket);
                        clientThreadPool.submit(() -> handleClient(socket));
                    } catch (IOException e) {
                        if (!isRunning) break;
                    }
                }
            } catch (IOException e) {
                Log.e(TAG, "Could not start server on port " + port, e);
            }
        }, "EmbeddedStreamServerThread").start();
    }

    private void handleClient(Socket socket) {
        try {
            socket.setSoTimeout(15000);
            BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
            String line = reader.readLine();
            if (line == null) {
                socket.close();
                activeClients.remove(socket);
                return;
            }

            String[] parts = line.split(" ");
            String method = parts.length > 0 ? parts[0] : "";
            String path = parts.length > 1 ? parts[1] : "/";

            OutputStream rawOut = socket.getOutputStream();
            BufferedOutputStream out = new BufferedOutputStream(rawOut);

            if (path.startsWith("/live") || path.startsWith("/stream") || path.startsWith("/video")) {
                handleMjpegStream(socket, out);
            } else if (path.startsWith("/snapshot")) {
                handleSnapshot(out);
            } else {
                handleStatus(out);
            }
        } catch (Exception ignored) {
        } finally {
            try {
                socket.close();
            } catch (Exception ignored) {}
            activeClients.remove(socket);
        }
    }

    private void handleMjpegStream(Socket socket, BufferedOutputStream out) throws IOException {
        String header = "HTTP/1.1 200 OK\r\n"
                + "Content-Type: multipart/x-mixed-replace; boundary=frame\r\n"
                + "Access-Control-Allow-Origin: *\r\n"
                + "Cache-Control: no-cache, no-store, must-revalidate\r\n"
                + "Pragma: no-cache\r\n"
                + "Connection: close\r\n\r\n";
        out.write(header.getBytes(StandardCharsets.UTF_8));
        out.flush();

        byte[] lastSentFrame = null;
        while (isRunning && !socket.isClosed() && socket.isConnected()) {
            byte[] frame = cameraEngine.getLatestJpegFrame();
            if (frame != null && frame != lastSentFrame) {
                lastSentFrame = frame;
                String partHeader = "--frame\r\n"
                        + "Content-Type: image/jpeg\r\n"
                        + "Content-Length: " + frame.length + "\r\n\r\n";
                out.write(partHeader.getBytes(StandardCharsets.UTF_8));
                out.write(frame);
                out.write("\r\n".getBytes(StandardCharsets.UTF_8));
                out.flush();
            }

            try {
                Thread.sleep(40); // ~25 FPS max
            } catch (InterruptedException e) {
                break;
            }
        }
    }

    private void handleSnapshot(BufferedOutputStream out) throws IOException {
        byte[] frame = cameraEngine.getLatestJpegFrame();
        if (frame != null) {
            String header = "HTTP/1.1 200 OK\r\n"
                    + "Content-Type: image/jpeg\r\n"
                    + "Content-Length: " + frame.length + "\r\n"
                    + "Access-Control-Allow-Origin: *\r\n"
                    + "Connection: close\r\n\r\n";
            out.write(header.getBytes(StandardCharsets.UTF_8));
            out.write(frame);
            out.flush();
        } else {
            String notFound = "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n";
            out.write(notFound.getBytes(StandardCharsets.UTF_8));
            out.flush();
        }
    }

    private void handleStatus(BufferedOutputStream out) throws IOException {
        String json = "{\"status\":\"ok\",\"streaming\":" + cameraEngine.isRunning() + ",\"port\":" + port + "}";
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        String header = "HTTP/1.1 200 OK\r\n"
                + "Content-Type: application/json\r\n"
                + "Content-Length: " + bytes.length + "\r\n"
                + "Access-Control-Allow-Origin: *\r\n"
                + "Connection: close\r\n\r\n";
        out.write(header.getBytes(StandardCharsets.UTF_8));
        out.write(bytes);
        out.flush();
    }

    public synchronized void stop() {
        if (!isRunning) return;
        isRunning = false;

        for (Socket s : activeClients) {
            try { s.close(); } catch (Exception ignored) {}
        }
        activeClients.clear();

        if (serverSocket != null) {
            try {
                serverSocket.close();
                serverSocket = null;
            } catch (Exception ignored) {}
        }
        Log.i(TAG, "Embedded HTTP Streaming Server stopped");
    }

    public static String getLocalIpAddress(Context context) {
        try {
            WifiManager wm = (WifiManager) context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                WifiInfo winfo = wm.getConnectionInfo();
                int ipAddress = winfo.getIpAddress();
                if (ipAddress != 0) {
                    return String.format("%d.%d.%d.%d",
                            (ipAddress & 0xff),
                            (ipAddress >> 8 & 0xff),
                            (ipAddress >> 16 & 0xff),
                            (ipAddress >> 24 & 0xff));
                }
            }
            List<NetworkInterface> interfaces = Collections.list(NetworkInterface.getNetworkInterfaces());
            for (NetworkInterface intf : interfaces) {
                List<InetAddress> addrs = Collections.list(intf.getInetAddresses());
                for (InetAddress addr : addrs) {
                    if (!addr.isLoopbackAddress() && addr.getAddress().length == 4) {
                        return addr.getHostAddress();
                    }
                }
            }
        } catch (Exception ignored) {}
        return "127.0.0.1";
    }
}
