Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c launch-desktop.bat", 0, False
Set WshShell = Nothing
