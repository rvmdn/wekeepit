using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace WeKeepIt;

public partial class Form1 : Form
{
    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

    private const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
    private const int DWMWA_CAPTION_COLOR = 35;
    private const int DWMWA_TEXT_COLOR = 36;
    private const int DWMWA_SYSTEMBACKDROP_TYPE = 38;

    private WebView2 webView = null!;
    private NotifyIcon notifyIcon = null!;
    private ContextMenuStrip trayMenu = null!;
    private bool reallyExit = false;
    private readonly string htmlPath;
    private readonly string exeDir;
    private Process? serverProcess = null;

    public Form1()
    {
        InitializeComponent();

        exeDir = AppDomain.CurrentDomain.BaseDirectory;
        var assetsDir = Path.Combine(exeDir, "assets");

        if (Directory.Exists(assetsDir) && File.Exists(Path.Combine(assetsDir, "index.html")))
        {
            htmlPath = assetsDir;
        }
        else if (File.Exists(Path.Combine(exeDir, "index.html")))
        {
            htmlPath = exeDir;
        }
        else
        {
            var parentDir = Path.GetFullPath(Path.Combine(exeDir, "..", "..", "..", ".."));
            if (File.Exists(Path.Combine(parentDir, "index.html")))
            {
                htmlPath = parentDir;
            }
            else
            {
                htmlPath = exeDir;
            }
        }

        StartBackgroundServerIfAvailable();
        SetupWindow();
        SetupSystemTray();
    }

    protected override async void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        ApplyDarkTranslucentTheme(true);
        await InitializeWebViewAsync();
    }

    public void ApplyDarkTranslucentTheme(bool acrylic = true)
    {
        try
        {
            // 1. Force native Windows Dark Mode on Title Bar (DWMWA_USE_IMMERSIVE_DARK_MODE)
            int darkMode = 1;
            DwmSetWindowAttribute(this.Handle, DWMWA_USE_IMMERSIVE_DARK_MODE, ref darkMode, sizeof(int));

            // 2. Set Title Bar background color to seamlessly match header (#161b22)
            // COLORREF format is 0x00BBGGRR: #161b22 -> R=0x16, G=0x1B, B=0x22 -> 0x00221B16
            int captionColor = 0x00221B16;
            DwmSetWindowAttribute(this.Handle, DWMWA_CAPTION_COLOR, ref captionColor, sizeof(int));

            // 3. Set Title Bar text color (#f0f6fc)
            int textColor = 0x00FCF6F0;
            DwmSetWindowAttribute(this.Handle, DWMWA_TEXT_COLOR, ref textColor, sizeof(int));

            // 4. In Windows 11 22H2/23H2/24H2: Enable Mica or Acrylic backdrop
            if (acrylic)
            {
                // 3 = Acrylic (translucent desktop blur), 2 = Mica
                int backdrop = 3;
                DwmSetWindowAttribute(this.Handle, DWMWA_SYSTEMBACKDROP_TYPE, ref backdrop, sizeof(int));
            }
            else
            {
                int backdrop = 1; // Default
                DwmSetWindowAttribute(this.Handle, DWMWA_SYSTEMBACKDROP_TYPE, ref backdrop, sizeof(int));
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"DWM Theme error: {ex.Message}");
        }
    }

    private void SetupWindow()
    {
        this.Text = "WeKeepIt v2.0 - Desktop Card Notepad & Document Vault";

        // Base resolution 1366x768, adapted dynamically to display working area
        var workingArea = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1366, 768);
        int targetWidth = Math.Min(1366, workingArea.Width);
        int targetHeight = Math.Min(768, workingArea.Height);

        this.Size = new Size(targetWidth, targetHeight);
        this.MinimumSize = new Size(600, 420);
        this.StartPosition = FormStartPosition.CenterScreen;
        this.BackColor = Color.FromArgb(14, 17, 23);

        var iconPath = Path.Combine(htmlPath, "app.ico");
        if (File.Exists(iconPath))
        {
            try { this.Icon = new Icon(iconPath); } catch { }
        }
    }

    private void SetupSystemTray()
    {
        trayMenu = new ContextMenuStrip();
        
        var openItem = new ToolStripMenuItem("📌 Buka WeKeepIt Board", null, (s, e) => ShowAndRestore());
        openItem.Font = new Font(openItem.Font, FontStyle.Bold);

        var newCardItem = new ToolStripMenuItem("➕ Catatan Baru", null, async (s, e) =>
        {
            ShowAndRestore();
            if (webView?.CoreWebView2 != null)
            {
                await webView.CoreWebView2.ExecuteScriptAsync("document.getElementById('newCardBtn')?.click();");
            }
        });

        var widgetItem = new ToolStripMenuItem("🪟 Toggle Mode Widget", null, async (s, e) =>
        {
            ShowAndRestore();
            if (webView?.CoreWebView2 != null)
            {
                await webView.CoreWebView2.ExecuteScriptAsync("document.getElementById('widgetModeBtn')?.click();");
            }
        });

        var exitItem = new ToolStripMenuItem("❌ Keluar Sepenuhnya", null, (s, e) =>
        {
            reallyExit = true;
            notifyIcon.Visible = false;
            Application.Exit();
        });

        trayMenu.Items.Add(openItem);
        trayMenu.Items.Add(newCardItem);
        trayMenu.Items.Add(widgetItem);
        trayMenu.Items.Add(new ToolStripSeparator());
        trayMenu.Items.Add(exitItem);

        notifyIcon = new NotifyIcon
        {
            Text = "WeKeepIt v2.0 - Card Notepad & Vault",
            Icon = this.Icon ?? SystemIcons.Application,
            ContextMenuStrip = trayMenu,
            Visible = true
        };

        notifyIcon.DoubleClick += (s, e) => ShowAndRestore();
    }

    private void ShowAndRestore()
    {
        this.Show();
        if (this.WindowState == FormWindowState.Minimized)
        {
            this.WindowState = FormWindowState.Normal;
        }
        this.BringToFront();
        this.Activate();
    }

    private async Task InitializeWebViewAsync()
    {
        webView = new WebView2
        {
            Dock = DockStyle.Fill,
            DefaultBackgroundColor = Color.Transparent
        };
        this.Controls.Add(webView);

        try
        {
            var envOptions = new CoreWebView2EnvironmentOptions();
            var userDataFolder = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "WeKeepIt",
                "WebView2Profile"
            );
            Directory.CreateDirectory(userDataFolder);

            var env = await CoreWebView2Environment.CreateAsync(null, userDataFolder, envOptions);
            await webView.EnsureCoreWebView2Async(env);

            webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
            webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
            webView.CoreWebView2.Settings.AreDevToolsEnabled = true;

            // Map local directory to virtual domain wekeepit.local as offline fallback
            webView.CoreWebView2.SetVirtualHostNameToFolderMapping(
                "wekeepit.local",
                htmlPath,
                CoreWebView2HostResourceAccessKind.Allow
            );

            webView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
            webView.CoreWebView2.NavigationCompleted += OnNavigationCompleted;

            // Check if backend server is available on port 4321
            bool serverOnline = false;
            for (int i = 0; i < 6; i++)
            {
                try
                {
                    using var client = new HttpClient { Timeout = TimeSpan.FromMilliseconds(500) };
                    var res = await client.GetAsync("http://127.0.0.1:4321/api/ping");
                    if (res.IsSuccessStatusCode)
                    {
                        serverOnline = true;
                        break;
                    }
                }
                catch
                {
                    await Task.Delay(250);
                }
            }

            if (serverOnline)
            {
                webView.CoreWebView2.Navigate("http://127.0.0.1:4321/index.html");
            }
            else
            {
                webView.CoreWebView2.Navigate("http://wekeepit.local/index.html");
            }
        }
        catch (Exception ex)
        {
            File.AppendAllText(Path.Combine(exeDir, "startup_error.log"), $"[WebView2InitError] {ex}\n\n");
            MessageBox.Show(
                $"Gagal menginisialisasi WebView2: {ex.Message}\nPastikan Microsoft Edge WebView2 Runtime terinstal.",
                "WeKeepIt Error",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
        }
    }

    private void OnNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        if (e.IsSuccess)
        {
            SendInitialDataToWebView();
        }
    }

    private string ReadBestDataFile(string filename)
    {
        // 1. Check htmlPath (assets)
        var p1 = Path.Combine(htmlPath, filename);
        if (File.Exists(p1))
        {
            var text = File.ReadAllText(p1).Trim();
            if (text.Length > 2 && text != "[]") return text;
        }

        // 2. Check exeDir
        var p2 = Path.Combine(exeDir, filename);
        if (File.Exists(p2))
        {
            var text = File.ReadAllText(p2).Trim();
            if (text.Length > 2 && text != "[]") return text;
        }

        // 3. Check parent directory (root workspace)
        var p3 = Path.GetFullPath(Path.Combine(exeDir, "..", filename));
        if (File.Exists(p3))
        {
            var text = File.ReadAllText(p3).Trim();
            if (text.Length > 2 && text != "[]") return text;
        }

        if (File.Exists(p1)) return File.ReadAllText(p1);
        if (File.Exists(p2)) return File.ReadAllText(p2);
        if (File.Exists(p3)) return File.ReadAllText(p3);

        return "[]";
    }

    private void SaveDataToAllLocations(string filename, string content)
    {
        try
        {
            // 1. htmlPath (assets)
            var p1 = Path.Combine(htmlPath, filename);
            File.WriteAllText(p1, content);

            // 2. exeDir
            var p2 = Path.Combine(exeDir, filename);
            File.WriteAllText(p2, content);

            // 3. parent directory (if workspace root)
            var p3 = Path.GetFullPath(Path.Combine(exeDir, "..", filename));
            if (File.Exists(p3) || Directory.Exists(Path.GetDirectoryName(p3)!))
            {
                File.WriteAllText(p3, content);
            }
        }
        catch (Exception ex)
        {
            File.AppendAllText(Path.Combine(exeDir, "save_error.log"), $"[SaveError] {ex}\n\n");
        }
    }

    private void SendInitialDataToWebView()
    {
        try
        {
            var cardsJson = ReadBestDataFile("wekeepit-data.json");
            var schemaJson = ReadBestDataFile("metadata-schema.json");

            var payload = JsonSerializer.Serialize(new
            {
                type = "INIT_DATA_RESPONSE",
                cardsJson = cardsJson,
                schemaJson = schemaJson
            });

            webView.CoreWebView2.PostWebMessageAsString(payload);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error sending initial data: {ex.Message}");
        }
    }

    private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            var raw = e.TryGetWebMessageAsString();
            if (string.IsNullOrEmpty(raw)) return;

            using var doc = JsonDocument.Parse(raw);
            var root = doc.RootElement;
            if (!root.TryGetProperty("type", out var typeProp)) return;

            var type = typeProp.GetString();

            if (type == "REQUEST_INIT_DATA")
            {
                SendInitialDataToWebView();
            }
            else if (type == "SAVE_CARDS")
            {
                if (root.TryGetProperty("data", out var dataProp))
                {
                    var json = dataProp.GetRawText();
                    SaveDataToAllLocations("wekeepit-data.json", json);
                }
            }
            else if (type == "SAVE_SCHEMA")
            {
                if (root.TryGetProperty("data", out var dataProp))
                {
                    var json = dataProp.GetRawText();
                    SaveDataToAllLocations("metadata-schema.json", json);
                }
            }
            else if (type == "SET_THEME")
            {
                bool isTransparent = root.TryGetProperty("transparent", out var transProp) && transProp.GetBoolean();
                ApplyDarkTranslucentTheme(isTransparent);
            }
            else if (type == "NATIVE_NOTIFY")
            {
                var title = root.TryGetProperty("title", out var t) ? (t.GetString() ?? "WeKeepIt") : "WeKeepIt";
                var body = root.TryGetProperty("body", out var b) ? (b.GetString() ?? "") : "";
                notifyIcon.ShowBalloonTip(4000, title, body, ToolTipIcon.Info);
            }
            else if (type == "PICK_FOLDER")
            {
                this.BeginInvoke(new Action(() =>
                {
                    try
                    {
                        using var dialog = new FolderBrowserDialog
                        {
                            Description = "Pilih Folder Dokumen untuk Diindeks",
                            UseDescriptionForTitle = true,
                            ShowNewFolderButton = true
                        };
                        if (dialog.ShowDialog(this) == DialogResult.OK)
                        {
                            var payload = JsonSerializer.Serialize(new
                            {
                                type = "FOLDER_PICKED",
                                path = dialog.SelectedPath
                            });
                            webView.CoreWebView2.PostWebMessageAsString(payload);
                        }
                    }
                    catch (Exception fex)
                    {
                        Console.WriteLine($"Folder picker error: {fex.Message}");
                    }
                }));
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error handling web message: {ex.Message}");
        }
    }

    private void StartBackgroundServerIfAvailable()
    {
        try
        {
            // Check if server is already running on port 4321
            using var client = new HttpClient { Timeout = TimeSpan.FromMilliseconds(800) };
            var response = client.GetAsync("http://127.0.0.1:4321/api/ping").GetAwaiter().GetResult();
            if (response.IsSuccessStatusCode)
            {
                return; // Server is already running
            }
        }
        catch { }

        try
        {
            var serverJs = Path.Combine(exeDir, "server.js");
            if (!File.Exists(serverJs))
            {
                var parentServerJs = Path.GetFullPath(Path.Combine(exeDir, "..", "server.js"));
                if (File.Exists(parentServerJs)) serverJs = parentServerJs;
            }

            if (File.Exists(serverJs))
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "node",
                    Arguments = $"\"{serverJs}\"",
                    WorkingDirectory = Path.GetDirectoryName(serverJs)!,
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                serverProcess = Process.Start(psi);
                AppDomain.CurrentDomain.ProcessExit += (s, e) => StopBackgroundServer();
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Background server start error: {ex.Message}");
        }
    }

    private void StopBackgroundServer()
    {
        if (serverProcess != null && !serverProcess.HasExited)
        {
            try
            {
                serverProcess.Kill(true);
                serverProcess.Dispose();
                serverProcess = null;
            }
            catch { }
        }
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (!reallyExit)
        {
            e.Cancel = true;
            this.Hide();
            notifyIcon.ShowBalloonTip(
                2000,
                "WeKeepIt Tetap Aktif",
                "Aplikasi berjalan di latar belakang (System Tray) untuk pengingat & aktivitas harian.",
                ToolTipIcon.None
            );
        }
        else
        {
            StopBackgroundServer();
            notifyIcon.Visible = false;
            base.OnFormClosing(e);
        }
    }
}
