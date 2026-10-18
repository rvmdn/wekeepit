using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace WeKeepIt;

static class Program
{
    private const string MutexName = "WeKeepIt_Desktop_App_Mutex_v2";
    private static Mutex? appMutex;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr FindWindow(string? lpClassName, string lpWindowName);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    private const int SW_RESTORE = 9;

    /// <summary>
    ///  The main entry point for the application.
    /// </summary>
    [STAThread]
    static void Main()
    {
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (s, e) =>
        {
            File.AppendAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "startup_error.log"), $"[ThreadException] {DateTime.Now}: {e.Exception}\n\n");
        };
        AppDomain.CurrentDomain.UnhandledException += (s, e) =>
        {
            File.AppendAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "startup_error.log"), $"[UnhandledException] {DateTime.Now}: {e.ExceptionObject}\n\n");
        };

        appMutex = new Mutex(true, MutexName, out bool createdNew);
        if (!createdNew)
        {
            try
            {
                var hWnd = FindWindow(null, "WeKeepIt v2.0 - Desktop Card Notepad & Document Vault");
                if (hWnd != IntPtr.Zero)
                {
                    ShowWindow(hWnd, SW_RESTORE);
                    SetForegroundWindow(hWnd);
                }
            }
            catch { }
            return;
        }

        try
        {
            ApplicationConfiguration.Initialize();
            Application.Run(new Form1());
        }
        catch (Exception ex)
        {
            File.AppendAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "startup_error.log"), $"[MainException] {DateTime.Now}: {ex}\n\n");
            MessageBox.Show(ex.ToString(), "WeKeepIt Startup Error");
        }
        finally
        {
            try
            {
                appMutex?.ReleaseMutex();
                appMutex?.Dispose();
            }
            catch { }
        }
    }    
}