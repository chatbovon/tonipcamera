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
            engine.setFrameCallback(jpegData -> {
                try {
                    String b64 = Base64.encodeToString(jpegData, Base64.NO_WRAP);
                    JSObject ret = new JSObject();
                    ret.put("frame", b64);
                    notifyListeners("onNativeFrame", ret);
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
}
