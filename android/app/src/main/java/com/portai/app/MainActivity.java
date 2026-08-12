package com.portai.app;

import android.location.Location;
import android.location.LocationManager;
import android.os.Build;
import android.view.View;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import java.util.Locale;

public class MainActivity extends BridgeActivity {

    private boolean hapticBridgeRegistered = false;
    private boolean nativeLongPressDisabled = false;
    private boolean inputStateBridgeRegistered = false;
    private boolean clipboardBridgeRegistered = false;
    private boolean locationBridgeRegistered = false;
    /** 当前聚焦输入框的 type（由前端 JS 桥同步）："password" 表示密码框 */
    private volatile String focusedInputType = null;
    /** 定位权限是否已授予 */
    private volatile boolean locationPermissionGranted = false;
    /** 定位权限弹窗是否已弹过（用户拒绝后不再重复弹，由前端降级 IP 定位） */
    private volatile boolean locationPermissionAsked = false;
    /** 权限弹窗期间挂起的 JS 定位回调名 */
    private volatile String pendingLocationCallback = null;

    /** 定位权限请求（ComponentActivity 字段初始化注册，onCreate 前可用） */
    private final androidx.activity.result.ActivityResultLauncher<String[]> locationPermissionLauncher =
        registerForActivityResult(
            new androidx.activity.result.contract.ActivityResultContracts.RequestMultiplePermissions(),
            result -> {
                boolean granted = Boolean.TRUE.equals(result.get(android.Manifest.permission.ACCESS_COARSE_LOCATION))
                    || Boolean.TRUE.equals(result.get(android.Manifest.permission.ACCESS_FINE_LOCATION));
                locationPermissionGranted = granted;
                locationPermissionAsked = true;
                String cb = pendingLocationCallback;
                pendingLocationCallback = null;
                if (cb != null) {
                    if (granted) {
                        startLocationRequest(cb);
                    } else {
                        callbackLocationError(cb);
                    }
                }
            });

    /**
     * 系统级触感桥：让 WebView 里的 JS 触发 Android 原生 HapticFeedback。
     * 与 @capacitor/haptics 的 VibrationEffect 波形不同，performHapticFeedback
     * 是键盘按键同款系统触感（由系统“触感反馈”设置统一控制），清脆有质感。
     */
    private class HapticBridge {
        private final View view;

        HapticBridge(View view) {
            this.view = view;
        }

        @android.webkit.JavascriptInterface
        public void tap() {
            view.performHapticFeedback(android.view.HapticFeedbackConstants.KEYBOARD_TAP);
        }

        /**
         * 单次短促强触感（CONTEXT_CLICK）：长按菜单弹出、AI 开始回答等关键反馈。
         * 比 KEYBOARD_TAP 明显，但保持短促，不像 LONG_PRESS 那样拖长。
         */
        @android.webkit.JavascriptInterface
        public void singleStrongTap() {
            view.performHapticFeedback(android.view.HapticFeedbackConstants.CONTEXT_CLICK);
        }
    }

    /**
     * 输入框状态桥：前端在输入框 focus/blur 时同步 type。
     * HitTestResult 只能区分"输入框 vs 非输入框"，区分不了 type=password，
     * 密码框的长按菜单分流需要前端告知（见 setOnLongClickListener）。
     */
    private class InputStateBridge {
        @android.webkit.JavascriptInterface
        public void setFocusedInputType(String type) {
            focusedInputType = type;
        }
    }

    /**
     * 剪贴板桥：原生读取系统剪贴板并回传 JS。
     * WebView 的 navigator.clipboard.readText() 需要 clipboard-read 权限，且
     * 在部分设备/WebView 版本上不稳定（NotAllowedError）；原生 ClipboardManager
     * 读取则始终可靠。addJavascriptInterface 不支持同步返回值，用回调方式：
     * JS 传入挂在 window 上的回调名，这里读完后 evaluateJavascript 回传。
     */
    private class ClipboardBridge {
        @android.webkit.JavascriptInterface
        public void readText(String callbackName) {
            String text = "";
            try {
                android.content.ClipboardManager cm = (android.content.ClipboardManager)
                    getSystemService(android.content.Context.CLIPBOARD_SERVICE);
                if (cm != null && cm.hasPrimaryClip() && cm.getPrimaryClip() != null
                        && cm.getPrimaryClip().getItemCount() > 0) {
                    CharSequence cs = cm.getPrimaryClip().getItemAt(0).coerceToText(MainActivity.this);
                    text = cs != null ? cs.toString() : "";
                }
            } catch (Exception ignored) {
                // 读取失败按空剪贴板处理
            }
            final String payload = text;
            WebView wv = getBridge().getWebView();
            if (wv == null) return;
            // addJavascriptInterface 的回调跑在 WebView 的 JS 线程，evaluateJavascript 需回到主线程
            wv.post(() -> {
                String js = String.format(
                    Locale.US,
                    "%s(%s)",
                    callbackName,
                    new org.json.JSONObject().quote(payload));
                wv.evaluateJavascript(js, null);
            });
        }
    }

    /**
     * 定位桥：Android 壳用原生 LocationManager（GPS/基站）定位，经纬度回调给 JS，
     * 由 JS 侧逆地理编码成城市名。比 IP 定位准（国外 IP 库常把佛山判成深圳这类问题）。
     * 权限流程：首次调用弹系统权限框，授权后定位；用户拒绝后不再重复弹，前端降级 IP。
     */
    private class LocationBridge {
        @android.webkit.JavascriptInterface
        public void getCurrentPosition(String callbackName) {
            WebView wv = getBridge().getWebView();
            if (wv == null) return;
            wv.post(() -> {
                if (checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION)
                        == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    locationPermissionGranted = true;
                    startLocationRequest(callbackName);
                } else if (!locationPermissionAsked) {
                    locationPermissionAsked = true;
                    pendingLocationCallback = callbackName;
                    locationPermissionLauncher.launch(new String[]{
                        android.Manifest.permission.ACCESS_COARSE_LOCATION,
                        android.Manifest.permission.ACCESS_FINE_LOCATION});
                } else {
                    // 已拒绝过：不再弹，直接失败让前端回退 IP 定位
                    callbackLocationError(callbackName);
                }
            });
        }
    }

    /** 定位：优先用 10 分钟内的缓存位置（秒回），否则请求一次新鲜位置（API 30+） */
    private void startLocationRequest(String callbackName) {
        LocationManager lm = (LocationManager) getSystemService(LOCATION_SERVICE);
        if (lm == null) {
            callbackLocationError(callbackName);
            return;
        }
        Location last = null;
        try {
            last = lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
            if (last == null) last = lm.getLastKnownLocation(LocationManager.GPS_PROVIDER);
        } catch (Exception ignored) {
            // 提供者不可用等
        }
        if (last != null && System.currentTimeMillis() - last.getTime() < 10 * 60 * 1000L) {
            callbackLocation(last, callbackName);
            return;
        }
        // API 30+：请求一次新鲜定位（网络定位对城市级足够，快于 GPS 冷启动）；
        // 失败回退缓存位置，再无则报错让前端走 IP 兜底
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            final Location fallback = last;
            try {
                lm.getCurrentLocation(LocationManager.NETWORK_PROVIDER, null, getMainExecutor(), loc -> {
                    if (loc != null) {
                        callbackLocation(loc, callbackName);
                    } else if (fallback != null) {
                        callbackLocation(fallback, callbackName);
                    } else {
                        callbackLocationError(callbackName);
                    }
                });
                return;
            } catch (Exception ignored) {
                // 提供者不可用等，走下方兜底
            }
        }
        if (last != null) {
            callbackLocation(last, callbackName);
        } else {
            callbackLocationError(callbackName);
        }
    }

    private void callbackLocation(Location loc, String callbackName) {
        String js = String.format(Locale.US, "%s(%f, %f)", callbackName, loc.getLatitude(), loc.getLongitude());
        WebView wv = getBridge().getWebView();
        if (wv != null) wv.post(() -> wv.evaluateJavascript(js, null));
    }

    private void callbackLocationError(String callbackName) {
        String js = String.format(Locale.US, "%s(null)", callbackName);
        WebView wv = getBridge().getWebView();
        if (wv != null) wv.post(() -> wv.evaluateJavascript(js, null));
    }

    private void setupWebViewInterfaces() {
        WebView webView = getBridge().getWebView();
        if (webView == null) return;

        if (!hapticBridgeRegistered) {
            webView.addJavascriptInterface(new HapticBridge(getWindow().getDecorView()), "AndroidHaptics");
            hapticBridgeRegistered = true;
        }

        if (!inputStateBridgeRegistered) {
            webView.addJavascriptInterface(new InputStateBridge(), "AndroidInputState");
            inputStateBridgeRegistered = true;
        }

        if (!clipboardBridgeRegistered) {
            webView.addJavascriptInterface(new ClipboardBridge(), "AndroidClipboard");
            clipboardBridgeRegistered = true;
        }

        if (!locationBridgeRegistered) {
            webView.addJavascriptInterface(new LocationBridge(), "AndroidLocation");
            locationBridgeRegistered = true;
        }

        if (!nativeLongPressDisabled) {
            // 长按一律交给前端自实现上下文菜单（Sidebar/MessageBubble/FavoritesPanel
            // 的 pointer 计时检测，与原生层无关）。拦截 WebView 原生长按，避免弹出原生
            // 上下文菜单/文本选择/图片保存，以及系统自动触感（与我们的桥打架）。
            // 例外：输入框（EDIT_TEXT）内长按放行，保留系统文本选择手柄（选择/复制/粘贴）。
            // 再例外：密码框（type=password）。Chromium WebView 的密码框编辑菜单只有
            // "自动填充"、没有"粘贴"项（原生限制），拦截掉无用菜单，由前端长按弹
            // 自定义粘贴菜单（PasswordInput 组件）。
            webView.setOnLongClickListener(v -> {
                WebView.HitTestResult hit = webView.getHitTestResult();
                if (hit != null && hit.getType() == WebView.HitTestResult.EDIT_TEXT_TYPE) {
                    if ("password".equals(focusedInputType)) {
                        return true;
                    }
                    return false;
                }
                return true;
            });
            // 关键：View.performLongClick 在 listener 返回 true 时会自动补发一次
            // LONG_PRESS 触感（小米的 LONG_PRESS 波形本身是多脉冲密集连续），与我们的
            // 桥叠加就变成“密集多下”。这里禁用 WebView 自身的 haptic；
            // 我们的桥用 decorView 触发，不受影响。
            webView.setHapticFeedbackEnabled(false);
            nativeLongPressDisabled = true;
        }
    }

    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 触感桥 + 原生长按拦截：必须在页面加载前注册，否则当前页面 JS 看不到
        // 注入的接口（addJavascriptInterface 的接口在下次导航后才对已加载页面可见）
        setupWebViewInterfaces();
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public void onPageStarted(WebView view) {
                super.onPageStarted(view);
                // 兜底：onCreate 时 WebView 尚未创建则由这里补上（幂等）
                setupWebViewInterfaces();
            }
        });
        // Capacitor 8 在 Android 15+/16 上（insetsHandling=disable 前）会裁剪 WebView 视口，
        // 且 env(safe-area-inset-*) 恒为 0；关闭其自动处理后由这里提供可靠的安全区数据，
        // 前端布局统一使用 var(--native-inset-top/bottom, ...) 避让。
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public void onPageLoaded(WebView view) {
                super.onPageLoaded(view);
                injectSystemBarInsets();
            }
        });

        // 键盘（IME）insets 实时注入：edge-to-edge 下 WebView 视口不随键盘收缩，
        // 前端需用 --native-ime-inset-bottom（键盘高度）把输入框顶到键盘上方。
        // 不消费 insets：继续向子视图分发，保留 Chromium 自身的滚动行为。
        ViewCompat.setOnApplyWindowInsetsListener(getWindow().getDecorView(), (v, insets) -> {
            boolean keyboardVisible = insets.isVisible(WindowInsetsCompat.Type.ime());
            int imeBottom = keyboardVisible
                ? insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
                : 0;
            injectCssVar("--native-ime-inset-bottom", imeBottom);
            return insets;
        });
    }

    private void injectSystemBarInsets() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return;
        View decor = getWindow().getDecorView();
        WindowInsetsCompat rootInsets = ViewCompat.getRootWindowInsets(decor);
        if (rootInsets == null) return;
        Insets bars = rootInsets.getInsets(
            WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
        injectCssVar("--native-inset-top", bars.top);
        injectCssVar("--native-inset-bottom", bars.bottom);
    }

    private void injectCssVar(String name, int valuePx) {
        if (getBridge().getWebView() == null) return;
        float density = getResources().getDisplayMetrics().density;
        int valueDp = Math.round(valuePx / density);
        String js = String.format(
            Locale.US,
            "try { document.documentElement.style.setProperty('%s', '%dpx'); } catch (e) {}",
            name,
            valueDp);
        getBridge().getWebView().evaluateJavascript(js, null);
    }
}
