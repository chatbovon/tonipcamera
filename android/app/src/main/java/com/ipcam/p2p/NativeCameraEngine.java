package com.ipcam.p2p;

import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.ImageFormat;
import android.graphics.Rect;
import android.graphics.YuvImage;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.media.Image;
import android.media.ImageReader;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Log;
import androidx.annotation.NonNull;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.util.Collections;

/**
 * NativeCameraEngine: Opens Android hardware camera via Camera2 API
 * and feeds frames into an offscreen ImageReader in RAM.
 * Runs completely independent of Activity UI and survives screen lock / power off.
 * Includes native motion detection, torch control, and camera switching.
 */
public class NativeCameraEngine {
    private static final String TAG = "NativeCameraEngine";
    private static NativeCameraEngine instance;

    private final Context context;
    private final CameraManager cameraManager;
    private CameraDevice cameraDevice;
    private CameraCaptureSession captureSession;
    private CaptureRequest.Builder captureRequestBuilder;
    private ImageReader imageReader;
    private HandlerThread backgroundThread;
    private Handler backgroundHandler;

    private boolean isRunning = false;
    private int currentFacing = CameraCharacteristics.LENS_FACING_BACK;
    private boolean isTorchOn = false;
    private int targetWidth = 640;
    private int targetHeight = 480;
    private int targetFps = 20;

    private volatile byte[] latestJpegFrame = null;
    private long lastFrameTime = 0;
    private final long minFrameIntervalMs = 50; // Max 20 fps

    // Motion Detection state
    private boolean motionEnabled = true;
    private int motionSensitivity = 25; // 1 - 100
    private byte[] prevLumaGrid = null;
    private static final int GRID_COLS = 32;
    private static final int GRID_ROWS = 24;

    private FrameCallback frameCallback;
    private MotionCallback motionCallback;

    public interface FrameCallback {
        void onFrameCaptured(byte[] jpegData);
    }

    public interface MotionCallback {
        void onMotionDetected(float score);
    }

    public static synchronized NativeCameraEngine getInstance(Context context) {
        if (instance == null) {
            instance = new NativeCameraEngine(context.getApplicationContext());
        }
        return instance;
    }

    private NativeCameraEngine(Context context) {
        this.context = context;
        this.cameraManager = (CameraManager) context.getSystemService(Context.CAMERA_SERVICE);
    }

    public void setFrameCallback(FrameCallback callback) {
        this.frameCallback = callback;
    }

    public void setMotionCallback(MotionCallback callback) {
        this.motionCallback = callback;
    }

    public void setMotionSensitivity(int sensitivity) {
        this.motionSensitivity = Math.max(5, Math.min(95, sensitivity));
    }

    public void setMotionEnabled(boolean enabled) {
        this.motionEnabled = enabled;
    }

    public byte[] getLatestJpegFrame() {
        return latestJpegFrame;
    }

    public boolean isRunning() {
        return isRunning;
    }

    public boolean isTorchOn() {
        return isTorchOn;
    }

    public int getCurrentFacing() {
        return currentFacing;
    }

    public synchronized void start(int width, int height, int fps) {
        if (isRunning) return;
        this.targetWidth = width > 0 ? width : 640;
        this.targetHeight = height > 0 ? height : 480;
        this.targetFps = fps > 0 ? fps : 20;
        this.isRunning = true;

        Log.i(TAG, "Starting NativeCameraEngine (" + targetWidth + "x" + targetHeight + " @" + targetFps + "fps)");
        startBackgroundThread();

        try {
            String cameraId = chooseCameraId(currentFacing);
            if (cameraId == null) {
                Log.e(TAG, "No suitable camera found for facing: " + currentFacing);
                isRunning = false;
                return;
            }

            imageReader = ImageReader.newInstance(targetWidth, targetHeight, ImageFormat.YUV_420_888, 2);
            imageReader.setOnImageAvailableListener(reader -> {
                Image image = null;
                try {
                    image = reader.acquireLatestImage();
                    if (image != null) {
                        processImage(image);
                    }
                } catch (Exception e) {
                    Log.e(TAG, "Error acquiring frame: " + e.getMessage());
                } finally {
                    if (image != null) {
                        image.close();
                    }
                }
            }, backgroundHandler);

            openCamera(cameraId);
        } catch (Exception e) {
            Log.e(TAG, "Failed to start camera engine", e);
            isRunning = false;
        }
    }

    @SuppressLint("MissingPermission")
    private void openCamera(String cameraId) throws CameraAccessException {
        cameraManager.openCamera(cameraId, new CameraDevice.StateCallback() {
            @Override
            public void onOpened(@NonNull CameraDevice camera) {
                Log.i(TAG, "CameraDevice opened successfully: " + camera.getId());
                cameraDevice = camera;
                createCaptureSession();
            }

            @Override
            public void onDisconnected(@NonNull CameraDevice camera) {
                Log.w(TAG, "CameraDevice disconnected");
                camera.close();
                cameraDevice = null;
            }

            @Override
            public void onError(@NonNull CameraDevice camera, int error) {
                Log.e(TAG, "CameraDevice error: " + error);
                camera.close();
                cameraDevice = null;
            }
        }, backgroundHandler);
    }

    private void createCaptureSession() {
        if (cameraDevice == null || imageReader == null) return;

        try {
            captureRequestBuilder = cameraDevice.createCaptureRequest(CameraDevice.TEMPLATE_RECORD);
            captureRequestBuilder.addTarget(imageReader.getSurface());
            captureRequestBuilder.set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO);
            captureRequestBuilder.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_VIDEO);
            applyTorchSetting();

            cameraDevice.createCaptureSession(
                Collections.singletonList(imageReader.getSurface()),
                new CameraCaptureSession.StateCallback() {
                    @Override
                    public void onConfigured(@NonNull CameraCaptureSession session) {
                        if (cameraDevice == null) return;
                        captureSession = session;
                        try {
                            session.setRepeatingRequest(captureRequestBuilder.build(), null, backgroundHandler);
                            Log.i(TAG, "Repeating capture request running in background 24/7");
                        } catch (CameraAccessException e) {
                            Log.e(TAG, "Failed to start repeating request", e);
                        }
                    }

                    @Override
                    public void onConfigureFailed(@NonNull CameraCaptureSession session) {
                        Log.e(TAG, "Camera capture session configuration failed");
                    }
                },
                backgroundHandler
            );
        } catch (Exception e) {
            Log.e(TAG, "Failed to create capture session", e);
        }
    }

    private void processImage(Image image) {
        long now = System.currentTimeMillis();
        if (now - lastFrameTime < minFrameIntervalMs) {
            return;
        }
        lastFrameTime = now;

        try {
            // 1. Native Motion Detection on Luminance plane
            if (motionEnabled) {
                detectMotion(image);
            }

            // 2. Convert to compressed JPEG byte array
            byte[] jpeg = yuv420ToJpeg(image, 50);
            if (jpeg != null && jpeg.length > 0) {
                latestJpegFrame = jpeg;
                if (frameCallback != null) {
                    frameCallback.onFrameCaptured(jpeg);
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error processing frame", e);
        }
    }

    private void detectMotion(Image image) {
        try {
            Image.Plane yPlane = image.getPlanes()[0];
            ByteBuffer buffer = yPlane.getBuffer();
            int width = image.getWidth();
            int height = image.getHeight();
            int rowStride = yPlane.getRowStride();
            int pixelStride = yPlane.getPixelStride();

            byte[] currentGrid = new byte[GRID_COLS * GRID_ROWS];
            int stepX = width / GRID_COLS;
            int stepY = height / GRID_ROWS;

            int gridIdx = 0;
            for (int r = 0; r < GRID_ROWS; r++) {
                int y = r * stepY;
                int rowOffset = y * rowStride;
                for (int c = 0; c < GRID_COLS; c++) {
                    int x = c * stepX;
                    int index = rowOffset + x * pixelStride;
                    if (index < buffer.limit()) {
                        currentGrid[gridIdx++] = buffer.get(index);
                    }
                }
            }

            if (prevLumaGrid != null) {
                int diffCount = 0;
                int totalCells = GRID_COLS * GRID_ROWS;
                int threshold = 25; // Pixel change threshold

                for (int i = 0; i < totalCells; i++) {
                    int diff = Math.abs((currentGrid[i] & 0xFF) - (prevLumaGrid[i] & 0xFF));
                    if (diff > threshold) {
                        diffCount++;
                    }
                }

                float score = ((float) diffCount / totalCells) * 100.0f;
                if (score >= motionSensitivity) {
                    if (motionCallback != null) {
                        motionCallback.onMotionDetected(score);
                    }
                }
            }
            prevLumaGrid = currentGrid;
        } catch (Exception ignored) {}
    }

    private byte[] yuv420ToJpeg(Image image, int quality) {
        int width = image.getWidth();
        int height = image.getHeight();

        Image.Plane yPlane = image.getPlanes()[0];
        Image.Plane uPlane = image.getPlanes()[1];
        Image.Plane vPlane = image.getPlanes()[2];

        ByteBuffer yBuffer = yPlane.getBuffer();
        ByteBuffer uBuffer = uPlane.getBuffer();
        ByteBuffer vBuffer = vPlane.getBuffer();

        int ySize = yBuffer.remaining();
        int uSize = uBuffer.remaining();
        int vSize = vBuffer.remaining();

        byte[] nv21 = new byte[ySize + (width * height / 2)];
        yBuffer.get(nv21, 0, ySize);

        int pixelStride = uPlane.getPixelStride();
        int rowStride = uPlane.getRowStride();
        int offset = ySize;

        for (int row = 0; row < height / 2; row++) {
            for (int col = 0; col < width / 2; col++) {
                int vuIndex = row * rowStride + col * pixelStride;
                if (vuIndex < vSize && vuIndex < uSize && offset + 1 < nv21.length) {
                    nv21[offset++] = vBuffer.get(vuIndex);
                    nv21[offset++] = uBuffer.get(vuIndex);
                }
            }
        }

        YuvImage yuvImage = new YuvImage(nv21, ImageFormat.NV21, width, height, null);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        yuvImage.compressToJpeg(new Rect(0, 0, width, height), quality, out);
        return out.toByteArray();
    }

    public synchronized void toggleTorch(boolean on) {
        this.isTorchOn = on;
        applyTorchSetting();
        if (captureSession != null && captureRequestBuilder != null) {
            try {
                captureSession.setRepeatingRequest(captureRequestBuilder.build(), null, backgroundHandler);
            } catch (Exception e) {
                Log.e(TAG, "Failed to apply torch to active session: " + e.getMessage());
            }
        }
    }

    private void applyTorchSetting() {
        if (captureRequestBuilder != null) {
            if (isTorchOn) {
                captureRequestBuilder.set(CaptureRequest.FLASH_MODE, CaptureRequest.FLASH_MODE_TORCH);
            } else {
                captureRequestBuilder.set(CaptureRequest.FLASH_MODE, CaptureRequest.FLASH_MODE_OFF);
            }
        }
    }

    public synchronized void switchCamera() {
        int nextFacing = (currentFacing == CameraCharacteristics.LENS_FACING_BACK)
            ? CameraCharacteristics.LENS_FACING_FRONT
            : CameraCharacteristics.LENS_FACING_BACK;
        currentFacing = nextFacing;
        if (isRunning) {
            stop();
            start(targetWidth, targetHeight, targetFps);
        }
    }

    private String chooseCameraId(int facing) {
        try {
            for (String id : cameraManager.getCameraIdList()) {
                CameraCharacteristics characteristics = cameraManager.getCameraCharacteristics(id);
                Integer cameraFacing = characteristics.get(CameraCharacteristics.LENS_FACING);
                if (cameraFacing != null && cameraFacing == facing) {
                    return id;
                }
            }
            return cameraManager.getCameraIdList().length > 0 ? cameraManager.getCameraIdList()[0] : null;
        } catch (Exception e) {
            return null;
        }
    }

    public synchronized void stop() {
        if (!isRunning) return;
        isRunning = false;
        Log.i(TAG, "Stopping NativeCameraEngine");

        try {
            if (captureSession != null) {
                captureSession.close();
                captureSession = null;
            }
            if (cameraDevice != null) {
                cameraDevice.close();
                cameraDevice = null;
            }
            if (imageReader != null) {
                imageReader.close();
                imageReader = null;
            }
        } catch (Exception e) {
            Log.e(TAG, "Error closing camera engine: " + e.getMessage());
        }

        stopBackgroundThread();
    }

    private void startBackgroundThread() {
        backgroundThread = new HandlerThread("CameraBackgroundThread");
        backgroundThread.start();
        backgroundHandler = new Handler(backgroundThread.getLooper());
    }

    private void stopBackgroundThread() {
        if (backgroundThread != null) {
            backgroundThread.quitSafely();
            try {
                backgroundThread.join();
                backgroundThread = null;
                backgroundHandler = null;
            } catch (InterruptedException ignored) {}
        }
    }
}
