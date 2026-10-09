namespace WeKeepIt;

static class Program
{
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
    }    
}