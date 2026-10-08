# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: browser-cpu-diagnostics.spec.js >> native process CPU receipt brackets a real complete export without claiming codec-only usage
- Location: tests/browser/browser-cpu-diagnostics.spec.js:5:1

# Error details

```
Error: browserContext.newPage: Target page, context or browser has been closed
Browser logs:

<launching> /tmp/shot-chromium-wrapper --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --user-data-dir=/tmp/playwright_chromiumdev_profile-IxQFfp --remote-debugging-pipe --no-startup-window
<launched> pid=60
[pid=60][err] [1007/180347.942730:ERROR:../net/base/address_tracker_linux.cc:224] Could not create NETLINK socket: Operation not permitted (1)
[pid=60][err] [1007/180347.944986:ERROR:../ui/gl/angle_platform_impl.cc:37] vk_renderer.cpp:275 (VerifyExtensionsPresent): Extension not supported: VK_EXT_headless_surface
[pid=60][err] ERR: vk_renderer.cpp:275 (VerifyExtensionsPresent): Extension not supported: VK_EXT_headless_surface
[pid=60][err] [1007/180347.945011:ERROR:../ui/gl/angle_platform_impl.cc:37] vk_renderer.cpp:275 (VerifyExtensionsPresent): Extension not supported: VK_KHR_surface
[pid=60][err] ERR: vk_renderer.cpp:275 (VerifyExtensionsPresent): Extension not supported: VK_KHR_surface
[pid=60][err] [1007/180347.945026:ERROR:../ui/gl/angle_platform_impl.cc:37] Display.cpp:1136 (initialize): ANGLE Display::initialize error 0: Internal Vulkan error (-7): A requested extension is not supported, in ../../../third_party/angle/src/libANGLE/renderer/vulkan/vk_renderer.cpp, enableInstanceExtensions:2453.
[pid=60][err] ERR: Display.cpp:1136 (initialize): ANGLE Display::initialize error 0: Internal Vulkan error (-7): A requested extension is not supported, in ../../../third_party/angle/src/libANGLE/renderer/vulkan/vk_renderer.cpp, enableInstanceExtensions:2453.
[pid=60][err] [1007/180347.945044:ERROR:../ui/gl/egl_util.cc:92] EGL Driver message (Critical) eglInitialize: Internal Vulkan error (-7): A requested extension is not supported, in ../../../third_party/angle/src/libANGLE/renderer/vulkan/vk_renderer.cpp, enableInstanceExtensions:2453.
[pid=60][err] [1007/180347.945047:ERROR:../ui/gl/gl_display.cc:630] eglInitialize SwANGLE failed with error EGL_NOT_INITIALIZED
[pid=60][err] [1007/180347.945051:ERROR:../ui/gl/gl_display.cc:665] Initialization of all (1) EGL display types failed.
[pid=60][err] [1007/180347.945054:ERROR:../ui/ozone/common/gl_ozone_egl.cc:26] GLDisplayEGL::Initialize failed.
[pid=60][err] [1007/180347.945526:ERROR:../ui/gl/angle_platform_impl.cc:37] vk_renderer.cpp:275 (VerifyExtensionsPresent): Extension not supported: VK_EXT_headless_surface
[pid=60][err] ERR: vk_renderer.cpp:275 (VerifyExtensionsPresent): Extension not supported: VK_EXT_headless_surface
[pid=60][err] [1007/180347.945545:ERROR:../ui/gl/angle_platform_impl.cc:37] vk_renderer.cpp:275 (VerifyExtensionsPresent): Extension not supported: VK_KHR_surface
[pid=60][err] ERR: vk_renderer.cpp:275 (VerifyExtensionsPresent): Extension not supported: VK_KHR_surface
[pid=60][err] [1007/180347.945552:ERROR:../ui/gl/angle_platform_impl.cc:37] Display.cpp:1136 (initialize): ANGLE Display::initialize error 0: Internal Vulkan error (-7): A requested extension is not supported, in ../../../third_party/angle/src/libANGLE/renderer/vulkan/vk_renderer.cpp, enableInstanceExtensions:2453.
[pid=60][err] ERR: Display.cpp:1136 (initialize): ANGLE Display::initialize error 0: Internal Vulkan error (-7): A requested extension is not supported, in ../../../third_party/angle/src/libANGLE/renderer/vulkan/vk_renderer.cpp, enableInstanceExtensions:2453.
[pid=60][err] [1007/180347.945559:ERROR:../ui/gl/egl_util.cc:92] EGL Driver message (Critical) eglInitialize: Internal Vulkan error (-7): A requested extension is not supported, in ../../../third_party/angle/src/libANGLE/renderer/vulkan/vk_renderer.cpp, enableInstanceExtensions:2453.
[pid=60][err] [1007/180347.945561:ERROR:../ui/gl/gl_display.cc:630] eglInitialize SwANGLE failed with error EGL_NOT_INITIALIZED
[pid=60][err] [1007/180347.945563:ERROR:../ui/gl/gl_display.cc:665] Initialization of all (1) EGL display types failed.
[pid=60][err] [1007/180347.945565:ERROR:../ui/ozone/common/gl_ozone_egl.cc:26] GLDisplayEGL::Initialize failed.
```