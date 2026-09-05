package com.ipcam.p2p;

import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativeCam")
public class NativeCamPlugin extends Plugin {

    @PluginMethod
    public void startNativeFeed(PluginCall call) {
        try {
            NativeCameraEngine engine = NativeCameraEngine.getInstance(getContext());
            if (!engine.isRunning()) {
                engine.start(640, 480, 20);
            }

            engine.setFrameCallback(jpegData -> {
                try {
                    String b64 = Base64.encodeToString(jpegData, Base64.NO_WRAP);
                    JSObject ret = new JSObject();
                    ret.put("frame", b64);
                    notifyListeners("onNativeFrame", ret);
                } catch (Exception ignored) {}
            });

            engine.setMotionCallback(score -> {
                try {
                    JSObject ret = new JSObject();
                    ret.put("score", score);
                    notifyListeners("onNativeMotion", ret);
                } catch (Exception ignored) {}
            });

            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void getLatestFrame(PluginCall call) {
        NativeCameraEngine engine = NativeCameraEngine.getInstance(getContext());
        byte[] frame = engine.getLatestJpegFrame();
        JSObject ret = new JSObject();
        if (frame != null) {
            ret.put("frame", Base64.encodeToString(frame, Base64.NO_WRAP));
        } else {
            ret.put("frame", (String) null);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void toggleTorch(PluginCall call) {
        NativeCameraEngine engine = NativeCameraEngine.getInstance(getContext());
        boolean current = engine.isTorchOn();
        engine.toggleTorch(!current);
        JSObject ret = new JSObject();
        ret.put("isTorchOn", !current);
        call.resolve(ret);
    }

    @PluginMethod
    public void switchCamera(PluginCall call) {
        NativeCameraEngine engine = NativeCameraEngine.getInstance(getContext());
        engine.switchCamera();
        JSObject ret = new JSObject();
        ret.put("facing", engine.getCurrentFacing());
        call.resolve(ret);
    }

    @PluginMethod
    public void getStreamInfo(PluginCall call) {
        String ip = EmbeddedStreamServer.getLocalIpAddress(getContext());
        int port = EmbeddedStreamServer.DEFAULT_PORT;
        JSObject ret = new JSObject();
        ret.put("ip", ip);
        ret.put("port", port);
        ret.put("streamUrl", "http://" + ip + ":" + port + "/live");
        ret.put("snapshotUrl", "http://" + ip + ":" + port + "/snapshot");
        call.resolve(ret);
    }

    @PluginMethod
    public void setMotionSettings(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled", true);
        Integer sensitivity = call.getInt("sensitivity", 25);
        NativeCameraEngine engine = NativeCameraEngine.getInstance(getContext());
        if (enabled != null) engine.setMotionEnabled(enabled);
        if (sensitivity != null) engine.setMotionSensitivity(sensitivity);
        call.resolve();
    }
}
