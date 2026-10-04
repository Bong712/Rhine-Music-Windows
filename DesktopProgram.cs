using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using System.Reflection;
using System.Windows.Forms;
using System.Drawing;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Web.WebView2.Core;

[assembly: AssemblyTitle("Rhine Music Desktop")]
[assembly: AssemblyProduct("Rhine Music")]
[assembly: AssemblyDescription("Rhine Music independent Windows desktop player")]
[assembly: AssemblyVersion("0.6.0.57")]
[assembly: AssemblyFileVersion("0.6.0.57")]
[assembly: AssemblyInformationalVersion("0.6.0-dev.57")]
[assembly: AssemblyCopyright("Copyright (c) 2026 Bong712")]

internal static class Program
{
    private const string ProductName = "Rhine Music";
    private const string AppVersion = "0.6.0-dev.57";
    private static int startedProcessId;
    private const uint CreateNoWindow = 0x08000000;
    private const uint StartfUseShowWindow = 0x00000001;
    private const uint StartfUseStdHandles = 0x00000100;
    private const ushort SwHide = 0;
    private const uint GenericRead = 0x80000000;
    private const uint FileAppendData = 0x00000004;
    private const uint FileShareRead = 0x00000001;
    private const uint FileShareWrite = 0x00000002;
    private const uint OpenAlways = 4;
    private const uint OpenExisting = 3;
    private const uint FileAttributeNormal = 0x00000080;

    private static readonly string ProductRoot = GetProductRoot();
    private static readonly string AppRoot = Path.Combine(ProductRoot, "app-v" + AppVersion);
    private static readonly string DataRoot = Path.Combine(ProductRoot, "music-data-v3");

    private static string GetProductRoot()
    {
        var overridePath = Environment.GetEnvironmentVariable("RHINE_HOME");
        return string.IsNullOrWhiteSpace(overridePath)
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), ProductName)
            : Path.GetFullPath(overridePath);
    }

    [STAThread]
    private static int Main()
    {
        AppDomain.CurrentDomain.AssemblyResolve += ResolveWebViewAssembly;
        ConfigureDpiAwareness();
        try
        {
            Run();
            return 0;
        }
        catch (Exception exception)
        {
            ShowMessage(exception.Message, ProductName + " 启动失败");
            return 1;
        }
    }

    private static Assembly ResolveWebViewAssembly(object sender, ResolveEventArgs args)
    {
        var name = new AssemblyName(args.Name).Name;
        if (!name.StartsWith("Microsoft.Web.WebView2.", StringComparison.Ordinal)) return null;
        var file = Path.Combine(AppRoot, name + ".dll");
        return File.Exists(file) ? Assembly.LoadFrom(file) : null;
    }

    private static void Run()
    {
        Directory.CreateDirectory(ProductRoot);
        using (var launchMutex = new System.Threading.Mutex(false, @"Local\RhineMusicDesktop-v0.6.0"))
        {
            bool ownsMutex;
            try
            {
                ownsMutex = launchMutex.WaitOne(TimeSpan.Zero);
            }
            catch (System.Threading.AbandonedMutexException)
            {
                ownsMutex = true;
            }

            if (!ownsMutex)
            {
                throw new InvalidOperationException("播放器正在启动，请等几秒后再试。");
            }

            try
            {
                EnsurePayloadExtracted();
                Directory.CreateDirectory(DataRoot);
                SetDllDirectoryW(AppRoot);

                var ports = new[] { 5175, 5176, 5177, 5178, 5179, 5180, 5181, 5182, 5183, 5184, 5173 };
                var states = new ProbeState[ports.Length];
                for (var index = 0; index < ports.Length; index++)
                {
                    states[index] = Probe(ports[index]);
                }

                var running = Array.IndexOf(states, ProbeState.Own);
                if (running >= 0)
                {
                    OpenDesktop(ports[running]);
                    return;
                }

                var free = Array.IndexOf(states, ProbeState.Free);
                if (free < 0)
                {
                    throw new InvalidOperationException("没有可用的本机端口（5175–5184、5173）。请关闭占用这些端口的程序后再启动。");
                }

                var port = ports[free];
                StartMusicService(port);
                for (var attempt = 0; attempt < 120; attempt++)
                {
                    ThreadSleep(250);
                    if (Probe(port) == ProbeState.Own)
                    {
                        OpenDesktop(port);
                        return;
                    }
                }

                var logPath = Path.Combine(DataRoot, "player-service.log");
                throw new InvalidOperationException("播放器服务未能在 30 秒内就绪。日志位置：" + logPath
                    + Environment.NewLine + ReadLogTail(logPath));
            }
            finally
            {
                launchMutex.ReleaseMutex();
            }
        }
    }

    private static void EnsurePayloadExtracted()
    {
        var markerPath = Path.Combine(AppRoot, ".payload-ready");
        if (File.Exists(markerPath)
            && File.Exists(Path.Combine(AppRoot, "node.exe"))
            && File.Exists(Path.Combine(AppRoot, "scripts", "music-server.mjs"))
            && File.Exists(Path.Combine(AppRoot, "dist", "index.html"))
            && File.Exists(Path.Combine(AppRoot, "Microsoft.Web.WebView2.WinForms.dll"))
            && File.Exists(Path.Combine(AppRoot, "WebView2Loader.dll")))
        {
            return;
        }

        Directory.CreateDirectory(AppRoot);
        using (var resource = typeof(Program).Assembly.GetManifestResourceStream("RhineMusicPayload.zip"))
        {
            if (resource == null)
            {
                throw new InvalidOperationException("安装包缺少内置播放器资源。");
            }

            using (var buffer = new MemoryStream())
            {
                resource.CopyTo(buffer);
                buffer.Position = 0;
                using (var archive = new ZipArchive(buffer, ZipArchiveMode.Read))
                {
                    var root = Path.GetFullPath(AppRoot).TrimEnd(Path.DirectorySeparatorChar)
                        + Path.DirectorySeparatorChar;
                    foreach (var entry in archive.Entries)
                    {
                        var relative = entry.FullName.Replace('/', Path.DirectorySeparatorChar);
                        var destination = Path.GetFullPath(Path.Combine(AppRoot, relative));
                        if (!destination.StartsWith(root, StringComparison.OrdinalIgnoreCase))
                        {
                            throw new InvalidDataException("播放器资源包含无效路径。");
                        }

                        if (entry.FullName.EndsWith("/", StringComparison.Ordinal))
                        {
                            Directory.CreateDirectory(destination);
                            continue;
                        }

                        Directory.CreateDirectory(Path.GetDirectoryName(destination));
                        using (var input = entry.Open())
                        using (var output = new FileStream(destination, FileMode.Create, FileAccess.Write, FileShare.None))
                        {
                            input.CopyTo(output);
                        }
                    }
                }
            }
        }

        File.WriteAllText(markerPath, AppVersion, Encoding.UTF8);
    }

    private enum ProbeState
    {
        Free,
        Busy,
        Own,
    }

    private static ProbeState Probe(int port)
    {
        if (IsPortFree(port))
        {
            return ProbeState.Free;
        }

        try
        {
            var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/api/health");
            request.Proxy = null;
            request.Timeout = 800;
            request.ReadWriteTimeout = 800;
            using (var response = (HttpWebResponse)request.GetResponse())
            {
                if (response.StatusCode != HttpStatusCode.OK)
                {
                    return ProbeState.Busy;
                }

                string body;
                using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                {
                    body = reader.ReadToEnd();
                }

                var health = new JavaScriptSerializer().DeserializeObject(body) as Dictionary<string, object>;
                if (health == null || !health.ContainsKey("service") || !health.ContainsKey("projectDir")
                    || !health.ContainsKey("pid"))
                {
                    return ProbeState.Busy;
                }

                var service = Convert.ToString(health["service"]);
                var project = Convert.ToString(health["projectDir"]);
                var pid = Convert.ToInt64(health["pid"]);
                return service == "rhine-local-music" && PathsEqual(project, AppRoot) && pid > 0
                    ? ProbeState.Own : ProbeState.Busy;
            }
        }
        catch (WebException)
        {
            return ProbeState.Busy;
        }
        catch
        {
            return ProbeState.Busy;
        }
    }

    private static bool IsPortFree(int port)
    {
        var listener = new TcpListener(IPAddress.Loopback, port);
        try
        {
            listener.Start(1);
            return true;
        }
        catch (SocketException)
        {
            return false;
        }
        finally
        {
            listener.Stop();
        }
    }

    private static bool PathsEqual(string left, string right)
    {
        try
        {
            var normalizedLeft = Path.GetFullPath(left).TrimEnd(Path.DirectorySeparatorChar);
            var normalizedRight = Path.GetFullPath(right).TrimEnd(Path.DirectorySeparatorChar);
            return string.Equals(normalizedLeft, normalizedRight, StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    private static void StartMusicService(int port)
    {
        var nodePath = Path.Combine(AppRoot, "node.exe");
        var scriptPath = Path.Combine(AppRoot, "scripts", "music-server.mjs");
        var logPath = Path.Combine(DataRoot, "player-service.log");
        var security = new SecurityAttributes
        {
            Length = Marshal.SizeOf(typeof(SecurityAttributes)),
            InheritHandle = true,
        };

        var logHandle = CreateFileW(logPath, FileAppendData, FileShareRead | FileShareWrite,
            ref security, OpenAlways, FileAttributeNormal, IntPtr.Zero);
        if (logHandle == new IntPtr(-1))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "无法打开播放器服务日志。");
        }

        var nullHandle = CreateFileW("NUL", GenericRead, FileShareRead | FileShareWrite,
            ref security, OpenExisting, FileAttributeNormal, IntPtr.Zero);
        if (nullHandle == new IntPtr(-1))
        {
            CloseHandle(logHandle);
            throw new Win32Exception(Marshal.GetLastWin32Error(), "无法初始化播放器服务输入流。");
        }

        var previousDataDir = Environment.GetEnvironmentVariable("MUSIC_DATA_DIR");
        try
        {
            var startup = new StartupInfo
            {
                Size = Marshal.SizeOf(typeof(StartupInfo)),
                Flags = StartfUseShowWindow | StartfUseStdHandles,
                ShowWindow = SwHide,
                StandardInput = nullHandle,
                StandardOutput = logHandle,
                StandardError = logHandle,
            };
            var commandLine = new StringBuilder(
                QuoteArgument(nodePath) + " " + QuoteArgument(scriptPath) + " --port " + port);

            Environment.SetEnvironmentVariable("MUSIC_DATA_DIR", DataRoot);
            ProcessInformation processInformation;
            if (!CreateProcessW(nodePath, commandLine, IntPtr.Zero, IntPtr.Zero, true,
                    CreateNoWindow, IntPtr.Zero, AppRoot, ref startup,
                    out processInformation))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "无法启动内置音乐服务。");
            }

            CloseHandle(processInformation.Thread);
            startedProcessId = checked((int)processInformation.ProcessId);
            CloseHandle(processInformation.Process);
        }
        finally
        {
            Environment.SetEnvironmentVariable("MUSIC_DATA_DIR", previousDataDir);
            CloseHandle(nullHandle);
            CloseHandle(logHandle);
        }
    }

    private static string QuoteArgument(string argument)
    {
        if (argument.Length > 0 && argument.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0)
        {
            return argument;
        }

        var result = new StringBuilder("\"");
        var backslashes = 0;
        foreach (var character in argument)
        {
            if (character == '\\')
            {
                backslashes++;
                continue;
            }

            if (character == '"')
            {
                result.Append('\\', backslashes * 2 + 1).Append('"');
                backslashes = 0;
                continue;
            }

            result.Append('\\', backslashes).Append(character);
            backslashes = 0;
        }

        result.Append('\\', backslashes * 2).Append('"');
        return result.ToString();
    }

    private static void OpenDesktop(int port)
    {
        try
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            var debugProfile = Environment.GetEnvironmentVariable("RHINE_PROFILE") == "1"
                || Environment.GetEnvironmentVariable("RHINE_PROFILE_CAPTURE") == "1";
            var address = "http://127.0.0.1:" + port + "/?desktop=1";
            if (debugProfile)
            {
                address += "&profile=1&scene=archive";
                int stressCount;
                if (int.TryParse(Environment.GetEnvironmentVariable("RHINE_STRESS_LIBRARY"), out stressCount)
                    && stressCount >= 3 && stressCount <= 500)
                {
                    address += "&stress=" + stressCount;
                }
            }
            Application.Run(new DesktopWindow(address, Path.Combine(DataRoot, "webview-profile")));
        }
        finally
        {
            if (startedProcessId > 0)
            {
                try { Process.GetProcessById(startedProcessId).Kill(); }
                catch (ArgumentException) { }
                catch (InvalidOperationException) { }
            }
        }
    }

    private static void ConfigureDpiAwareness()
    {
        try
        {
            if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return;
        }
        catch (EntryPointNotFoundException) { }
        catch (DllNotFoundException) { }
        try { SetProcessDPIAware(); }
        catch (EntryPointNotFoundException) { }
        catch (DllNotFoundException) { }
    }

    private static string ReadLogTail(string path)
    {
        try
        {
            var text = File.ReadAllText(path, Encoding.UTF8);
            return text.Length <= 5000 ? text : text.Substring(text.Length - 5000);
        }
        catch
        {
            return "尚无服务日志。";
        }
    }

    private static void ThreadSleep(int milliseconds)
    {
        System.Threading.Thread.Sleep(milliseconds);
    }

    private static void ShowMessage(string message, string title)
    {
        MessageBoxW(IntPtr.Zero, message, title, 0x00000010 | 0x00040000);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SecurityAttributes
    {
        public int Length;
        public IntPtr SecurityDescriptor;
        [MarshalAs(UnmanagedType.Bool)] public bool InheritHandle;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public int Size;
        public string Reserved;
        public string Desktop;
        public string Title;
        public int X;
        public int Y;
        public int XSize;
        public int YSize;
        public int XCountChars;
        public int YCountChars;
        public int FillAttribute;
        public uint Flags;
        public ushort ShowWindow;
        public ushort Reserved2Count;
        public IntPtr Reserved2;
        public IntPtr StandardInput;
        public IntPtr StandardOutput;
        public IntPtr StandardError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation
    {
        public IntPtr Process;
        public IntPtr Thread;
        public uint ProcessId;
        public uint ThreadId;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateFileW(string fileName, uint desiredAccess, uint shareMode,
        ref SecurityAttributes securityAttributes, uint creationDisposition, uint flagsAndAttributes,
        IntPtr templateFile);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateProcessW(string applicationName, StringBuilder commandLine,
        IntPtr processAttributes, IntPtr threadAttributes, [MarshalAs(UnmanagedType.Bool)] bool inheritHandles,
        uint creationFlags, IntPtr environment, string currentDirectory, ref StartupInfo startupInfo,
        out ProcessInformation processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetDllDirectoryW(string path);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int MessageBoxW(IntPtr window, string text, string caption, uint type);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetProcessDPIAware();
}

internal sealed class DesktopWindow : Form
{
    private readonly WebView2 browser;
    private readonly string address;
    private readonly string profile;
    private readonly bool profileCapture;
    private readonly string profileCapturePath;
    private bool profileCaptureStarted;
    private int responseDiagnosticsCount;
    private Rectangle windowedBounds;
    private FormBorderStyle windowedBorderStyle;
    private FormWindowState windowedState;
    private bool fullscreen;

    public DesktopWindow(string address, string profile)
    {
        this.address = address;
        this.profile = profile;
        profileCapture = Environment.GetEnvironmentVariable("RHINE_PROFILE_CAPTURE") == "1";
        profileCapturePath = Path.Combine(profile, "profile-capture.jsonl");
        Text = "Rhine Music";
        StartPosition = FormStartPosition.CenterScreen;
        if (profileCapture && Environment.GetEnvironmentVariable("RHINE_PROFILE_WINDOWED") == "1")
        {
            var requestedWidth = ReadProfileDimension("RHINE_PROFILE_WIDTH", 1280, 480, 3840);
            var requestedHeight = ReadProfileDimension("RHINE_PROFILE_HEIGHT", 800, 360, 2160);
            MinimumSize = new Size(320, 240);
            ClientSize = new Size(requestedWidth, requestedHeight);
            WindowState = FormWindowState.Normal;
        }
        else
        {
            MinimumSize = new Size(960, 640);
            Size = new Size(1440, 900);
            WindowState = FormWindowState.Maximized;
        }
        KeyPreview = true;
        KeyDown += (sender, args) =>
        {
            if (args.KeyCode != Keys.F11) return;
            args.Handled = true;
            ToggleFullscreen();
        };
        BackColor = Color.FromArgb(234, 229, 225);
        browser = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(234, 229, 225) };
        Controls.Add(browser);
        Shown += async (sender, args) =>
        {
            if (Environment.GetEnvironmentVariable("RHINE_FULLSCREEN") == "1") ToggleFullscreen();
            try
            {
                Directory.CreateDirectory(profile);
                var environmentOptions = new CoreWebView2EnvironmentOptions();
                var diagnosticArguments = Environment.GetEnvironmentVariable("RHINE_WEBVIEW2_DIAGNOSTIC_ARGUMENTS");
                if (profileCapture && !string.IsNullOrWhiteSpace(diagnosticArguments))
                    environmentOptions.AdditionalBrowserArguments = diagnosticArguments;
                var environment = await CoreWebView2Environment.CreateAsync(null, profile, environmentOptions);
                await browser.EnsureCoreWebView2Async(environment);
                browser.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
                browser.CoreWebView2.Settings.AreDevToolsEnabled = false;
                if (profileCapture)
                {
                    WriteProfileCapture("webview-initialized", new Dictionary<string, object>
                    {
                        { "browserVersion", browser.CoreWebView2.Environment.BrowserVersionString },
                        { "diagnosticArguments", diagnosticArguments ?? "" },
                        { "windowedProfile", Environment.GetEnvironmentVariable("RHINE_PROFILE_WINDOWED") == "1" }
                    });
                    browser.CoreWebView2.NavigationStarting += (source, navigation) =>
                    {
                        WriteProfileCapture("navigation-starting", new Dictionary<string, object>
                        {
                            { "uri", navigation.Uri },
                            { "isRedirected", navigation.IsRedirected },
                            { "navigationKind", navigation.NavigationKind.ToString() }
                        });
                    };
                    browser.CoreWebView2.WebResourceResponseReceived += (source, resource) =>
                    {
                        if (responseDiagnosticsCount >= 40 ||
                            !resource.Request.Uri.StartsWith(new Uri(address).GetLeftPart(UriPartial.Authority), StringComparison.OrdinalIgnoreCase)) return;
                        responseDiagnosticsCount++;
                        WriteProfileCapture("resource-response", new Dictionary<string, object>
                        {
                            { "uri", resource.Request.Uri },
                            { "statusCode", resource.Response.StatusCode },
                            { "reason", resource.Response.ReasonPhrase }
                        });
                    };
                    browser.CoreWebView2.ProcessFailed += (source, failure) =>
                    {
                        WriteProfileCapture("webview-process-failed", new Dictionary<string, object>
                        {
                            { "kind", failure.ProcessFailedKind.ToString() },
                            { "reason", failure.Reason.ToString() },
                            { "exitCode", failure.ExitCode },
                            { "failureSourceModulePath", failure.FailureSourceModulePath },
                            { "processDescription", failure.ProcessDescription }
                        });
                    };
                    browser.CoreWebView2.NavigationCompleted += async (source, navigation) =>
                    {
                        WriteProfileCapture("navigation-completed", new Dictionary<string, object>
                        {
                            { "isSuccess", navigation.IsSuccess },
                            { "webErrorStatus", navigation.WebErrorStatus.ToString() },
                            { "httpStatusCode", navigation.HttpStatusCode },
                            { "navigationId", navigation.NavigationId },
                            { "source", browser.Source == null ? null : browser.Source.AbsoluteUri }
                        });
                        if (profileCaptureStarted || !navigation.IsSuccess) return;
                        profileCaptureStarted = true;
                        await CaptureProfileAsync();
                    };
                }
                browser.CoreWebView2.NewWindowRequested += (source, request) =>
                {
                    request.Handled = true;
                    Uri uri;
                    if (Uri.TryCreate(request.Uri, UriKind.Absolute, out uri)
                        && (uri.Scheme == "http" || uri.Scheme == "https"))
                    {
                        if (uri.GetLeftPart(UriPartial.Authority) == new Uri(address).GetLeftPart(UriPartial.Authority))
                            browser.Source = uri;
                        else
                            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
                    }
                };
                browser.Source = new Uri(address);
            }
            catch (Exception error)
            {
                MessageBox.Show(this, "无法启动桌面渲染窗口。请安装 Microsoft Edge WebView2 Runtime。\n\n" + error.Message,
                    "Rhine Music", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
            }
        };
    }

    private async System.Threading.Tasks.Task CaptureProfileAsync()
    {
        try
        {
            Directory.CreateDirectory(profile);
            WriteProfileCapture("capture-started", null);
            var rendererReady = false;
            for (var attempt = 0; attempt < 120; attempt++)
            {
                var response = await EvaluateProfileAsync(
                    "Boolean(window.rhineMusic && window.rhineMusic.stats && window.rhineMusic.stats()?.loaded)");
                rendererReady = ReadScriptValue(response) as bool? == true;
                if (rendererReady) break;
                await System.Threading.Tasks.Task.Delay(250);
            }

            if (rendererReady)
            {
                var activateDemo = await EvaluateProfileAsync(
                    "(function(){if(window.rhineMusic&&window.rhineMusic.selectedAlbum)return true;" +
                    "var button=document.querySelector('#music-empty [data-action=\"demo\"]');" +
                    "if(!button)return false;button.click();return true;})()");
                WriteProfileCapture("demo-activation", activateDemo);
                rendererReady = ReadScriptValue(activateDemo) as bool? == true;
            }

            var musicSceneReady = false;
            for (var attempt = 0; attempt < 120 && rendererReady; attempt++)
            {
                var response = await EvaluateProfileAsync(
                    "Boolean(window.rhineMusic && window.rhineMusic.selectedAlbum && " +
                    "window.rhineMusic.presentation && window.rhineMusic.presentation.archiveReady)");
                musicSceneReady = ReadScriptValue(response) as bool? == true;
                if (musicSceneReady) break;
                await System.Threading.Tasks.Task.Delay(500);
            }
            rendererReady = musicSceneReady;

            var requestedTheme = Environment.GetEnvironmentVariable("RHINE_PROFILE_THEME");
            if (profileCapture && (requestedTheme == "day" || requestedTheme == "dusk" || requestedTheme == "night"))
            {
                var serializedTheme = new JavaScriptSerializer().Serialize(requestedTheme);
                var themeApplied = await EvaluateProfileAsync(
                    "(function(){const theme=" + serializedTheme + ";" +
                    "const button=document.querySelector('button[data-theme=\"'+theme+'\"]');" +
                    "if(!button)return false;button.click();return true;})()");
                WriteProfileCapture("theme-selected", new Dictionary<string, object>
                {
                    { "theme", requestedTheme },
                    { "applied", ReadScriptValue(themeApplied) as bool? == true }
                });
                await System.Threading.Tasks.Task.Delay(750);
            }

            const string snapshot = "JSON.stringify((function() { " +
                "const host=document.querySelector('#three-scene'); const canvas=host&&host.querySelector('canvas'); " +
                "const app=window.rhineMusic&&window.rhineMusic.profile?window.rhineMusic.profile():{}; " +
                "const profile=app.renderer||{}; const scene=app.scene||{}; " +
                "const view=window.rhineMusic&&window.rhineMusic.presentation||{}; " +
                "return {timestamp:new Date().toISOString(),ready:Boolean(window.rhineMusic&&window.rhineMusic.stats&&window.rhineMusic.stats()?.loaded), " +
                "appVersion:app.version||null, album:window.rhineMusic&&window.rhineMusic.selectedAlbum?window.rhineMusic.selectedAlbum.id:null, " +
                "libraryAlbums:window.rhineMusic&&window.rhineMusic.library?window.rhineMusic.library.albums.map(a=>({id:a.id,title:a.title,coverUrl:a.coverUrl,tracks:a.tracks.length})):[], " +
                "presentation:{phase:view.phase||null,archiveReady:view.archiveReady===true,canvasCount:host?host.querySelectorAll('canvas').length:0}, " +
                "viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio,screenWidth:screen.width,screenHeight:screen.height, " +
                "estimatedPhysicalWidth:Math.round(screen.width*devicePixelRatio),estimatedPhysicalHeight:Math.round(screen.height*devicePixelRatio)}, " +
                "canvas:canvas?{width:canvas.width,height:canvas.height,cssWidth:canvas.clientWidth,cssHeight:canvas.clientHeight,quality:host.dataset.renderQuality||null}:null, " +
                "gpu:app.gpuCapability||null, profile:{note:profile.note||null,viewport:profile.viewport||null,gpuTimer:profile.gpuTimer||null,gpuPasses:profile.gpuPasses||{},scenePhases:profile.scenePhases||{}, " +
                "mainThread:profile.mainThread||null,albumSwitches:(profile.albumSwitches||[]).slice(-1)}, " +
                "scene:{loaded:scene.loaded,drawCalls:scene.drawCalls,triangles:scene.triangles,renderer:scene.renderer||null}}; })())";
            WriteProfileCapture("startup", await EvaluateProfileAsync(snapshot));

            var warmupMilliseconds = 5000;
            int requestedWarmupMilliseconds;
            if (int.TryParse(Environment.GetEnvironmentVariable("RHINE_PROFILE_WARMUP_MS"), out requestedWarmupMilliseconds)
                && requestedWarmupMilliseconds >= 0 && requestedWarmupMilliseconds <= 30000)
            {
                warmupMilliseconds = requestedWarmupMilliseconds;
            }
            await System.Threading.Tasks.Task.Delay(warmupMilliseconds);
            WriteProfileCapture("warm-baseline", await EvaluateProfileAsync(snapshot));
            WriteProfileCapture("cover-atlas", await EvaluateProfileAsync(
                "JSON.stringify(window.rhineMusic&&window.rhineMusic.coverDiagnostics?window.rhineMusic.coverDiagnostics():null)"));
            await CapturePreviewAsync("cover-startup.png");

            var switchCount = 6;
            int requestedSwitchCount;
            if (int.TryParse(Environment.GetEnvironmentVariable("RHINE_PROFILE_SWITCHES"), out requestedSwitchCount)
                && requestedSwitchCount >= 1 && requestedSwitchCount <= 6)
            {
                switchCount = requestedSwitchCount;
            }
            for (var index = 0; index < switchCount && rendererReady; index++)
            {
                var click = await EvaluateProfileAsync(
                    "(function(){var button=document.querySelector('.album-stepper [data-action=\"next\"]');" +
                    "if(!button)return false;button.click();return true;})()");
                if (!(ReadScriptValue(click) as bool? == true))
                {
                    WriteProfileCapture("album-switch-control-unavailable", click);
                    break;
                }
                WriteProfileCapture("album-switch-start-" + (index + 1), click);
                await System.Threading.Tasks.Task.Delay(2200);
                WriteProfileCapture("album-switch-" + (index + 1), await EvaluateProfileAsync(snapshot));
                await CapturePreviewAsync("cover-album-" + (index + 1) + ".png");
                await CaptureCoverCpuPreviewAsync("cover-album-" + (index + 1) + "-cpu.png");
            }

            // Capture the actual selected print at the large detail presentation
            // size as well as in the shelf. This makes visual atlas regressions
            // distinguishable from small, distant shelf artwork.
            var openDetail = await EvaluateProfileAsync(
                "(function(){var button=document.querySelector('.open-album');" +
                "if(!button)return false;button.click();return true;})()");
            WriteProfileCapture("cover-detail-open", openDetail);
            if (ReadScriptValue(openDetail) as bool? == true)
            {
                for (var attempt = 0; attempt < 40; attempt++)
                {
                    var detailReady = await EvaluateProfileAsync(
                        "Boolean(window.rhineMusic&&window.rhineMusic.presentation&&" +
                        "window.rhineMusic.presentation.phase==='detail'&&" +
                        "window.rhineMusic.presentation.cameraReady)");
                    if (ReadScriptValue(detailReady) as bool? == true) break;
                    await System.Threading.Tasks.Task.Delay(100);
                }
                await System.Threading.Tasks.Task.Delay(250);
                WriteProfileCapture("cover-detail", await EvaluateProfileAsync(snapshot));
                await CapturePreviewAsync("cover-detail.png");
                var closeDetail = await EvaluateProfileAsync(
                    "(function(){var button=document.querySelector('.music-back');" +
                    "if(!button)return false;button.click();return true;})()");
                WriteProfileCapture("cover-detail-close", closeDetail);
                await System.Threading.Tasks.Task.Delay(1200);
            }
            await CaptureLyricsProfileAsync();
            WriteProfileCapture("capture-complete", null);
        }
        catch (Exception error)
        {
            var record = new Dictionary<string, object>();
            record.Add("capturedAtUtc", DateTime.UtcNow.ToString("o"));
            record.Add("error", error.ToString());
            File.AppendAllText(profileCapturePath, new JavaScriptSerializer().Serialize(record) + Environment.NewLine, Encoding.UTF8);
        }
    }

    private async System.Threading.Tasks.Task<object> EvaluateProfileAsync(string expression)
    {
        var serializer = new JavaScriptSerializer();
        var response = await browser.ExecuteScriptAsync(expression);
        return serializer.DeserializeObject(response);
    }

    private async System.Threading.Tasks.Task CapturePreviewAsync(string fileName)
    {
        try
        {
            var path = Path.Combine(profile, fileName);
            using (var stream = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.Read))
            {
                await browser.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
            }
            WriteProfileCapture("preview-captured", new Dictionary<string, object>
            {
                { "file", path },
                { "width", browser.ClientSize.Width },
                { "height", browser.ClientSize.Height },
            });
        }
        catch (Exception error)
        {
            WriteProfileCapture("preview-capture-failed", error.Message);
        }
    }

    private async System.Threading.Tasks.Task CaptureCoverCpuPreviewAsync(string fileName)
    {
        try
        {
            var response = await EvaluateProfileAsync(
                "window.rhineMusic&&window.rhineMusic.coverPreviewDataUrl?" +
                "window.rhineMusic.coverPreviewDataUrl():null");
            var dataUrl = ReadScriptValue(response) as string;
            var comma = dataUrl == null ? -1 : dataUrl.IndexOf(',');
            if (comma < 0) throw new InvalidOperationException("The selected atlas cover preview is unavailable.");
            var bytes = Convert.FromBase64String(dataUrl.Substring(comma + 1));
            var path = Path.Combine(profile, fileName);
            File.WriteAllBytes(path, bytes);
            WriteProfileCapture("cover-cpu-preview-captured", new Dictionary<string, object>
            {
                { "file", path },
                { "bytes", bytes.Length },
            });
        }
        catch (Exception error)
        {
            WriteProfileCapture("cover-cpu-preview-failed", error.Message);
        }
    }

    private async System.Threading.Tasks.Task CaptureLyricsProfileAsync()
    {
        try
        {
            const string lyricSnapshot = "JSON.stringify((function(){const app=window.rhineMusic||{};const state=app.player||{};" +
                "const stage=document.querySelector('#stage');const dock=document.querySelector('#music-lyric-dock');" +
                "const rect=el=>{if(!el)return null;const r=el.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};" +
                "const current=document.querySelector('#music-lyric-current');const next=document.querySelector('#music-lyric-next');" +
                "const active=Array.from(document.querySelectorAll('.lyric-line')).find(row=>row.getAttribute('aria-current')==='true')||null;" +
                "const transportStatus=document.querySelector('#transport-lyric-status');" +
                "return {appVersion:app.profile?app.profile().version:null,track:state.currentTrack?state.currentTrack.title:null," +
                "playing:state.playing,currentTime:state.currentTime,playbackTime:app.playbackTime,transport:state.transport||null," +
                "theme:stage?.dataset.theme||null,layout:stage?.dataset.layout||null,dockHidden:dock?.hidden??true,dockRect:rect(dock)," +
                "transportStatusHidden:transportStatus?.hidden??true,transportStatus:transportStatus?.textContent||'',current:current?.textContent||'',next:next?.textContent||''," +
                "panelActive:active?.textContent||null,panelActiveIndex:active?.dataset.lyricIndex??null," +
                "status:document.querySelector('#lyrics-status')?.textContent||null};})())";

            var selectAlbum = await EvaluateProfileAsync(
                "(function(){const app=window.rhineMusic;const albums=app&&app.library?app.library.albums:[];" +
                "const album=albums.find(a=>a.title==='日光留声')||albums[0];if(!album)return false;" +
                "const index=albums.indexOf(album);const tick=document.querySelector('#album-ticks [data-select=\\\"'+index+'\\\"]');" +
                "if(!tick)return false;tick.click();return album.id;})()");
            var expectedAlbumId = ReadScriptValue(selectAlbum) as string;
            var albumSelected = false;
            if (!string.IsNullOrEmpty(expectedAlbumId))
            {
                var serializedAlbumId = new JavaScriptSerializer().Serialize(expectedAlbumId);
                for (var attempt = 0; attempt < 40; attempt++)
                {
                    var selected = await EvaluateProfileAsync(
                        "(function(){const app=window.rhineMusic;return Boolean(app&&app.selectedAlbum&&" +
                        "app.selectedAlbum.id===" + serializedAlbumId + ");})()");
                    if (ReadScriptValue(selected) as bool? == true)
                    {
                        albumSelected = true;
                        break;
                    }
                    await System.Threading.Tasks.Task.Delay(100);
                }
            }
            WriteProfileCapture("lyrics-album-selected", new Dictionary<string, object>
            {
                { "expectedAlbumId", expectedAlbumId },
                { "selected", albumSelected }
            });
            if (!albumSelected)
            {
                WriteProfileCapture("lyrics-test-skipped", "隔离曲库中没有可选择的本地专辑。");
                return;
            }
            var openAlbum = await EvaluateProfileAsync(
                "(function(){const button=document.querySelector('.open-album');if(!button)return false;button.click();return true;})()");
            if (!(ReadScriptValue(openAlbum) as bool? == true))
            {
                WriteProfileCapture("lyrics-test-skipped", "专辑详情入口不可用。");
                return;
            }
            var trackRowsReady = false;
            for (var attempt = 0; attempt < 60; attempt++)
            {
                var rowsReady = await EvaluateProfileAsync(
                    "(function(){const app=window.rhineMusic;const track=app&&app.selectedAlbum&&app.selectedAlbum.tracks[0];" +
                    "return Boolean(track&&!track.offline&&Array.from(document.querySelectorAll('.track-row')).some(row=>row.dataset.track===track.id));})()");
                if (ReadScriptValue(rowsReady) as bool? == true)
                {
                    trackRowsReady = true;
                    break;
                }
                await System.Threading.Tasks.Task.Delay(100);
            }
            WriteProfileCapture("lyrics-track-rows-ready", trackRowsReady);
            if (!trackRowsReady)
            {
                WriteProfileCapture("lyrics-test-skipped", "专辑详情动画结束后仍未找到可播放的隔离 WAV 曲目行。");
                return;
            }
            var playTrack = await EvaluateProfileAsync(
                "(function(){const app=window.rhineMusic;const track=app.selectedAlbum&&app.selectedAlbum.tracks[0];" +
                "const row=track&&Array.from(document.querySelectorAll('.track-row')).find(item=>item.dataset.track===track.id);" +
                "if(!track||track.offline||!row)return false;row.click();return true;})()");
            if (!(ReadScriptValue(playTrack) as bool? == true))
            {
                WriteProfileCapture("lyrics-test-skipped", "未找到可播放的隔离 WAV 曲目行。");
                return;
            }
            await System.Threading.Tasks.Task.Delay(2700);
            WriteProfileCapture("lyrics-playing", await EvaluateProfileAsync(lyricSnapshot));
            await CapturePreviewAsync("lyrics-playing.png");

            await EvaluateProfileAsync(
                "(function(){const button=document.querySelector('.music-back');if(!button)return false;button.click();return true;})()");
            await System.Threading.Tasks.Task.Delay(1400);
            WriteProfileCapture("lyrics-playing-browse", await EvaluateProfileAsync(lyricSnapshot));
            await CapturePreviewAsync("lyrics-playing-browse.png");

            var reopenAlbum = await EvaluateProfileAsync(
                "(function(){const button=document.querySelector('.open-album');if(!button)return false;button.click();return true;})()");
            if (ReadScriptValue(reopenAlbum) as bool? == true)
            {
                for (var attempt = 0; attempt < 40; attempt++)
                {
                    var detailReady = await EvaluateProfileAsync(
                        "Boolean(window.rhineMusic&&window.rhineMusic.presentation&&" +
                        "window.rhineMusic.presentation.phase==='detail'&&" +
                        "window.rhineMusic.presentation.cameraReady)");
                    if (ReadScriptValue(detailReady) as bool? == true) break;
                    await System.Threading.Tasks.Task.Delay(100);
                }
                await System.Threading.Tasks.Task.Delay(250);
            }
            else
            {
                WriteProfileCapture("lyrics-detail-reopen-failed", reopenAlbum);
                return;
            }

            await EvaluateProfileAsync("(function(){const button=document.querySelector('#play-pause');if(!button)return false;button.click();return true;})()");
            await System.Threading.Tasks.Task.Delay(350);
            WriteProfileCapture("lyrics-paused", await EvaluateProfileAsync(lyricSnapshot));

            await EvaluateProfileAsync("(function(){const button=document.querySelector('#music-lyric-dock [data-action=\\\"lyrics-panel\\\"]');if(!button)return false;button.click();return true;})()");
            await System.Threading.Tasks.Task.Delay(350);
            var seek = await EvaluateProfileAsync(
                "(function(){const input=document.querySelector('#lyrics-seek');if(!input)return false;" +
                "input.value='5.5';input.dispatchEvent(new Event('input',{bubbles:true}));" +
                "input.dispatchEvent(new Event('change',{bubbles:true}));return true;})()");
            WriteProfileCapture("lyrics-seek-control", seek);
            await System.Threading.Tasks.Task.Delay(150);
            WriteProfileCapture("lyrics-seek-panel", await EvaluateProfileAsync(lyricSnapshot));
            await CapturePreviewAsync("lyrics-seek-panel.png");
            await EvaluateProfileAsync("(function(){const button=document.querySelector('[data-action=\\\"close-panel\\\"]');if(button)button.click();return true;})()");
            await System.Threading.Tasks.Task.Delay(350);
            WriteProfileCapture("lyrics-seek-main", await EvaluateProfileAsync(lyricSnapshot));
            await CapturePreviewAsync("lyrics-seek-main.png");

            await EvaluateProfileAsync("(function(){const button=document.querySelector('#stop-playback');if(!button)return false;button.click();return true;})()");
            await System.Threading.Tasks.Task.Delay(350);
            WriteProfileCapture("lyrics-stopped", await EvaluateProfileAsync(lyricSnapshot));
            await CapturePreviewAsync("lyrics-stopped.png");

            var nextTrack = await EvaluateProfileAsync(
                "(function(){const app=window.rhineMusic;const tracks=app.selectedAlbum?app.selectedAlbum.tracks:[];" +
                "const track=tracks.find(item=>item.id!==app.player.currentTrack?.id);" +
                "const row=track&&Array.from(document.querySelectorAll('.track-row')).find(item=>item.dataset.track===track.id);" +
                "if(!track||!row)return false;row.click();return true;})()");
            if (ReadScriptValue(nextTrack) as bool? == true)
            {
                await System.Threading.Tasks.Task.Delay(800);
                WriteProfileCapture("lyrics-no-lrc-track", await EvaluateProfileAsync(lyricSnapshot));
                await CapturePreviewAsync("lyrics-no-lrc-track.png");
            }
        }
        catch (Exception error)
        {
            WriteProfileCapture("lyrics-test-failed", error.ToString());
        }
    }

    private static int ReadProfileDimension(string name, int fallback, int minimum, int maximum)
    {
        int value;
        if (!int.TryParse(Environment.GetEnvironmentVariable(name), out value)) return fallback;
        return Math.Max(minimum, Math.Min(maximum, value));
    }

    private static object ReadScriptValue(object response)
    {
        var root = response as Dictionary<string, object>;
        if (root == null) return response;
        var commandResult = root["result"] as Dictionary<string, object>;
        var remoteObject = commandResult == null ? null : commandResult["result"] as Dictionary<string, object>;
        object value;
        return remoteObject != null && remoteObject.TryGetValue("value", out value) ? value : null;
    }

    private void WriteProfileCapture(string stage, object response)
    {
        var record = new Dictionary<string, object>();
        record.Add("capturedAtUtc", DateTime.UtcNow.ToString("o"));
        record.Add("qpcMilliseconds", Stopwatch.GetTimestamp() * 1000.0 / Stopwatch.Frequency);
        record.Add("stage", stage);
        record.Add("monitorBoundsPx", Screen.FromControl(this).Bounds.ToString());
        record.Add("windowClientPx", browser.ClientSize.ToString());
        record.Add("displayFrameMeasurement", "This log contains WebView2 and WebGL metrics; measure genuinely displayed frames externally with PresentMon or ETW.");
        if (response != null) record.Add("devToolsResponse", response);
        File.AppendAllText(profileCapturePath, new JavaScriptSerializer().Serialize(record) + Environment.NewLine, Encoding.UTF8);
    }

    private void ToggleFullscreen()
    {
        if (!fullscreen)
        {
            windowedBorderStyle = FormBorderStyle;
            windowedBounds = Bounds;
            windowedState = WindowState;
            FormBorderStyle = FormBorderStyle.None;
            WindowState = FormWindowState.Normal;
            Bounds = Screen.FromControl(this).Bounds;
            fullscreen = true;
            return;
        }

        FormBorderStyle = windowedBorderStyle;
        WindowState = FormWindowState.Normal;
        Bounds = windowedBounds;
        WindowState = windowedState;
        fullscreen = false;
    }

}
