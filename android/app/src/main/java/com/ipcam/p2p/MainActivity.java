package com.ipcam.p2p;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {
    private static final int PERM_REQUEST_CODE = 1001;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeCamPlugin.class);
        super.onCreate(savedInstanceState);

        // Keep screen on hardware-level when app is in foreground
        getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // Allow app to stay alive & visible behind/over Lock Screen when user presses power button
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }
        getWindow().addFlags(
            android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
            | android.view.WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
            | android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
        );

        // Request runtime permissions (Camera, Mic, Notifications on Android 13+)
        checkAndRequestPermissions();

        // Request Ignore Battery Optimization so OS doesn't sleep the process on screen lock
        requestIgnoreBatteryOptimizations();

        // Start Foreground Service to keep CPU & Camera stream alive during screen lock
        startCameraForegroundService();

        // Configure WebView for background media streaming & WebRTC
        configureWebView();
    }

    private void checkAndRequestPermissions() {
        List<String> list = new ArrayList<>();
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            list.add(Manifest.permission.CAMERA);
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            list.add(Manifest.permission.RECORD_AUDIO);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                list.add(Manifest.permission.POST_NOTIFICATIONS);
            }
        }
        if (!list.isEmpty()) {
            ActivityCompat.requestPermissions(this, list.toArray(new String[0]), PERM_REQUEST_CODE);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERM_REQUEST_CODE) {
            boolean hasCamera = ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
            if (hasCamera) {
                runOnUiThread(() -> {
                    try {
                        WebView webView = this.getBridge().getWebView();
                        if (webView != null) {
                            webView.evaluateJavascript("window.dispatchEvent(new Event('cameraPermissionGranted'));", null);
                        }
                    } catch (Exception ignored) {}
                });
            }
        }
    }

    private void requestIgnoreBatteryOptimizations() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                    Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    intent.setData(Uri.parse("package:" + getPackageName()));
                    startActivity(intent);
                }
            } catch (Exception ignored) {}
        }
    }

    private void startCameraForegroundService() {
        try {
            Intent serviceIntent = new Intent(this, CameraForegroundService.class);
            serviceIntent.setAction(CameraForegroundService.ACTION_START);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent);
            } else {
                startService(serviceIntent);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private android.content.BroadcastReceiver screenReceiver;
    private PowerManager.WakeLock screenWakeLock;

    private void configureWebView() {
        try {
            WebView webView = this.getBridge().getWebView();
            if (webView != null) {
                WebSettings settings = webView.getSettings();
                settings.setMediaPlaybackRequiresUserGesture(false);
                settings.setJavaScriptEnabled(true);
                settings.setDomStorageEnabled(true);
                settings.setDatabaseEnabled(true);
                settings.setAllowFileAccess(true);
            }
        } catch (Exception ignored) {}

        registerScreenStateReceiver();
    }

    private void registerScreenStateReceiver() {
        if (screenReceiver != null) return;
        screenReceiver = new android.content.BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (intent == null || intent.getAction() == null) return;
                String action = intent.getAction();
                if (Intent.ACTION_SCREEN_OFF.equals(action)) {
                    // Power button pressed or screen turned off!
                    // Immediately wake CPU and ensure WebView + WebRTC keeps streaming
                    acquireScreenWakeLock();
                    runOnUiThread(() -> {
                        try {
                            WebView webView = getBridge().getWebView();
                            if (webView != null) {
                                webView.resumeTimers();
                                // Trigger OLED blackout overlay in web UI so phone uses zero screen power
                                webView.evaluateJavascript("if (typeof activateOledMode === 'function') { activateOledMode(); }", null);
                            }
                        } catch (Exception ignored) {}
                    });
                } else if (Intent.ACTION_SCREEN_ON.equals(action)) {
                    runOnUiThread(() -> {
                        try {
                            WebView webView = getBridge().getWebView();
                            if (webView != null) {
                                webView.resumeTimers();
                            }
                        } catch (Exception ignored) {}
                    });
                }
            }
        };

        android.content.IntentFilter filter = new android.content.IntentFilter();
        filter.addAction(Intent.ACTION_SCREEN_OFF);
        filter.addAction(Intent.ACTION_SCREEN_ON);
        filter.addAction(Intent.ACTION_USER_PRESENT);
        registerReceiver(screenReceiver, filter);
    }

    private void acquireScreenWakeLock() {
        try {
            if (screenWakeLock == null) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    screenWakeLock = pm.newWakeLock(
                        PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP,
                        "IPCam::ScreenKeepAlive"
                    );
                    screenWakeLock.setReferenceCounted(false);
                }
            }
            if (screenWakeLock != null && !screenWakeLock.isHeld()) {
                // Wake up screen instantly for 3 seconds then release so screen stays awake with FLAG_KEEP_SCREEN_ON
                screenWakeLock.acquire(3000);
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onPause() {
        super.onPause();
        // Keep timers and WebRTC heartbeat running when activity is paused (e.g. screen off)
        try {
            WebView webView = this.getBridge().getWebView();
            if (webView != null) {
                webView.resumeTimers();
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onResume() {
        super.onResume();
        try {
            WebView webView = this.getBridge().getWebView();
            if (webView != null) {
                webView.resumeTimers();
            }
        } catch (Exception ignored) {}
        startCameraForegroundService();
    }

    @Override
    public void onDestroy() {
        if (screenReceiver != null) {
            try {
                unregisterReceiver(screenReceiver);
                screenReceiver = null;
            } catch (Exception ignored) {}
        }
        if (screenWakeLock != null && screenWakeLock.isHeld()) {
            try {
                screenWakeLock.release();
                screenWakeLock = null;
            } catch (Exception ignored) {}
        }
        super.onDestroy();
    }
}