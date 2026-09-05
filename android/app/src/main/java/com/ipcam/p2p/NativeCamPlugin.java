package com.ipcam.p2p;

import android.content.Context;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.view.WindowManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativeCam")
public class NativeCamPlugin extends Plugin {

    private boolean isTorchOn = false;

    @PluginMethod
    public void setScreenBrightness(PluginCall call) {
        Double b = call.getDouble("brightness", 0.001);
        final float brightness = b != null ? b.floatValue() : 0.001f;
        getActivity().runOnUiThread(() -> {
            try {
                WindowManager.LayoutParams lp = getActivity().getWindow().getAttributes();
                lp.screenBrightness = brightness;
                getActivity().getWindow().setAttributes(lp);
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    @PluginMethod
    public void restoreScreenBrightness(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                WindowManager.LayoutParams lp = getActivity().getWindow().getAttributes();
                lp.screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE;
                getActivity().getWindow().setAttributes(lp);
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    @PluginMethod
    public void toggleTorch(PluginCall call) {
        try {
            CameraManager cm = (CameraManager) getContext().getSystemService(Context.CAMERA_SERVICE);
            if (cm != null) {
                String[] ids = cm.getCameraIdList();
                for (String id : ids) {
                    CameraCharacteristics chars = cm.getCameraCharacteristics(id);
                    Boolean flash = chars.get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
                    Integer facing = chars.get(CameraCharacteristics.LENS_FACING);
                    if (flash != null && flash && facing != null && facing == CameraCharacteristics.LENS_FACING_BACK) {
                        isTorchOn = !isTorchOn;
                        cm.setTorchMode(id, isTorchOn);
                        JSObject ret = new JSObject();
                        ret.put("isTorchOn", isTorchOn);
                        call.resolve(ret);
                        return;
                    }
                }
            }
            call.reject("Flash not available");
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void startNativeFeed(PluginCall call) {
        call.resolve();
    }

    @PluginMethod
    public void getLatestFrame(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("frame", (String) null);
        call.resolve(ret);
    }

    @PluginMethod
    public void switchCamera(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("facing", "flipped");
        call.resolve(ret);
    }

    @PluginMethod
    public void getStreamInfo(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("status", "ok");
        call.resolve(ret);
    }

    @PluginMethod
    public void setMotionSettings(PluginCall call) {
        call.resolve();
    }
}
